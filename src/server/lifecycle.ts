import "server-only";
import { admin } from "@/lib/supabase/admin";
import { isCanonicalStage, laterStage, rungIndex, type CanonicalStage } from "@/core/stages";
import { dispatch } from "./dispatch";
import { raiseAlert } from "./alerts";
import { emitEvent } from "./outbound";

/**
 * Record a canonical stage change for a lead (spec §12 step 4). Append-only; the lead's current stage
 * only moves forward (or to lost). Fires the value/delivery job.
 */
export async function recordStage(args: {
  workspaceId: string;
  leadId: string;
  stage: string;
  source: "ghl" | "generic" | "api" | "manual" | "simulator" | "intake";
  occurredAt?: string | null;
  crmStageId?: string | null;
  actualValue?: number | null;
  lostReason?: string | null;
}) {
  if (!isCanonicalStage(args.stage)) throw new Error(`Unknown canonical stage "${args.stage}"`);
  const db = admin();
  const { data: lead } = await db
    .from("leads")
    .select("id,workspace_id,canonical_stage")
    .eq("id", args.leadId)
    .eq("workspace_id", args.workspaceId)
    .maybeSingle<{ id: string; workspace_id: string; canonical_stage: string }>();
  if (!lead) throw new Error("Lead not found in this workspace");

  await db.from("stage_events").insert({
    workspace_id: args.workspaceId,
    lead_id: args.leadId,
    canonical_stage: args.stage,
    crm_stage_id: args.crmStageId ?? null,
    lost_reason: args.lostReason ?? null,
    actual_value: args.actualValue ?? null,
    occurred_at: args.occurredAt ?? new Date().toISOString(),
    source: args.source,
  });

  const next = laterStage(lead.canonical_stage, args.stage) as CanonicalStage;
  await db
    .from("leads")
    .update({ canonical_stage: next, lost_reason: args.stage === "lost" ? (args.lostReason ?? "unspecified") : null })
    .eq("id", args.leadId)
    .eq("workspace_id", args.workspaceId);

  // Stage hygiene: a jump of more than one rung is allowed but flagged (risk: garbage signals).
  const from = rungIndex(lead.canonical_stage);
  const to = rungIndex(args.stage);
  if (from >= 0 && to - from > 2) {
    await raiseAlert(args.workspaceId, {
      type: "stage_anomaly",
      severity: "info",
      title: `Lead skipped ${to - from - 1} stages (${lead.canonical_stage} → ${args.stage})`,
      detail: { leadId: args.leadId },
      dedupeKey: `skip:${args.leadId}:${args.stage}`,
    });
  }

  await dispatch("ose/stage.recorded", { workspaceId: args.workspaceId, leadId: args.leadId, stage: args.stage });
  if ((args.stage === "contract" || args.stage === "funded") && args.source !== "simulator") {
    const { notifyWorkspaceTeam } = await import("./team");
    await notifyWorkspaceTeam(args.workspaceId, {
      kind: "milestone",
      title: args.stage === "funded" ? "A lead was funded" : "A lead reached Contract",
      body: args.actualValue ? `Value ${args.actualValue}` : null,
      link: `/w/${args.workspaceId}/leads/${args.leadId}`,
      dedupeKey: `stage:${args.leadId}:${args.stage}`,
    });
  }
  await emitEvent(args.workspaceId, "lead.stage_changed", { lead_id: args.leadId, stage: args.stage, occurred_at: args.occurredAt ?? new Date().toISOString(), lost_reason: args.lostReason ?? null });
  return { stage: next };
}

/** Map a CRM pipeline stage to a canonical stage; unmapped stages are registered for the mapping screen. */
export async function mapCrmStage(workspaceId: string, provider: string, pipelineId: string, stageId: string, stageName?: string | null) {
  const db = admin();
  const { data } = await db
    .from("stage_maps")
    .select("canonical_stage")
    .eq("workspace_id", workspaceId)
    .eq("provider", provider)
    .eq("pipeline_id", pipelineId)
    .eq("stage_id", stageId)
    .maybeSingle<{ canonical_stage: string }>();
  if (data) return data.canonical_stage;
  await db.from("stage_maps").upsert(
    { workspace_id: workspaceId, provider, pipeline_id: pipelineId, stage_id: stageId, stage_name: stageName ?? null, canonical_stage: "ignore" },
    { onConflict: "workspace_id,provider,pipeline_id,stage_id", ignoreDuplicates: true },
  );
  await raiseAlert(workspaceId, {
    type: "stage_unmapped",
    severity: "warning",
    title: `CRM stage "${stageName ?? stageId}" is not mapped`,
    detail: { provider, pipelineId, stageId },
    dedupeKey: `unmapped:${provider}:${pipelineId}:${stageId}`,
  });
  return "ignore";
}
