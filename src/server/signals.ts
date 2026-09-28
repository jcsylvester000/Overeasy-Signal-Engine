import "server-only";
import { admin } from "@/lib/supabase/admin";
import { effectiveMode } from "@/lib/env";
import { rungIndex, type Rung } from "@/core/stages";
import { cumulativeValue, planSignals, type SignalDecision } from "@/core/value/engine";
import type { Platform } from "@/core/value/types";
import type { Connection } from "@/connectors/types";
import { uploadPolicy, type LeadConsent, type PrivacySettings } from "@/core/privacy";
import { publishedScoring, publishedValue } from "./models";
import { dispatch } from "./dispatch";

const PROVIDER_PLATFORM: Record<string, Platform> = { google_ads: "google", microsoft_ads: "microsoft" };
const COUNTS_AS_SENT = ["pending", "sending", "sent", "dry_run", "test"];

type LeadRow = {
  id: string;
  workspace_id: string;
  score: number | null;
  lead_type: string | null;
  attribution: Record<string, string | null>;
  email_sha256: string | null;
  phone_sha256: string | null;
  click_ts: string | null;
  currency: string;
  consent: LeadConsent | null;
};

/**
 * Value step (spec §12 step 5): compute the cumulative value for the highest rung the lead has reached,
 * the increment per platform connection, apply floors/caps/window guard, and enqueue signal_jobs.
 */
export async function planAndEnqueue(workspaceId: string, leadId: string): Promise<SignalDecision[]> {
  const db = admin();
  const { data: lead } = await db.from("leads").select("*").eq("id", leadId).eq("workspace_id", workspaceId).maybeSingle<LeadRow>();
  if (!lead) return [];

  const { data: events } = await db.from("stage_events").select("canonical_stage,actual_value").eq("lead_id", leadId).order("occurred_at");
  let reached: Rung = "submitted";
  let actualValue: number | null = null;
  for (const e of events ?? []) {
    if (rungIndex(e.canonical_stage) > rungIndex(reached)) reached = e.canonical_stage as Rung;
    if (e.canonical_stage === "funded" && e.actual_value !== null) actualValue = Number(e.actual_value);
  }

  const [scoring, value] = await Promise.all([publishedScoring(workspaceId), publishedValue(workspaceId)]);
  if (!value) return [];
  const scoreMax = scoring?.model.clamp.max ?? 0;
  const cumulative = cumulativeValue(value.model, { stage: reached, leadType: lead.lead_type, score: lead.score, scoreMax, actualValue });
  await db.from("leads").update({ value_current: cumulative }).eq("id", leadId);

  const { data: conns } = await db
    .from("connections")
    .select("*")
    .eq("workspace_id", workspaceId)
    .in("provider", ["google_ads", "microsoft_ads"])
    .neq("status", "disconnected");
  const connections = (conns ?? []) as Connection[];
  if (!connections.length) return [];

  const { data: wsRow } = await db.from("workspaces").select("settings").eq("id", workspaceId).maybeSingle<{ settings: PrivacySettings }>();
  const policy = uploadPolicy(lead.consent, wsRow?.settings);

  const { data: prior } = await db.from("signal_jobs").select("connection_id,mode,value_increment,status").eq("lead_id", leadId);
  const decisions: SignalDecision[] = [];

  for (const conn of connections) {
    const platform = PROVIDER_PLATFORM[conn.provider];
    const mode = effectiveMode(conn.mode);
    const sent = (prior ?? [])
      .filter((j) => j.connection_id === conn.id && j.mode === mode && COUNTS_AS_SENT.includes(j.status))
      .reduce((s, j) => s + Number(j.value_increment), 0);

    const [d] = planSignals(value.model, {
      stage: reached,
      leadType: lead.lead_type,
      score: lead.score,
      scoreMax,
      actualValue,
      clickIds: lead.attribution ?? {},
      hasHashedUserData: policy.hashedUserData && Boolean(lead.email_sha256 || lead.phone_sha256),
      clickTs: lead.click_ts ? new Date(lead.click_ts) : null,
      now: new Date(),
      platforms: [{ platform, sent: Math.round(sent * 100) / 100 }],
    });
    if (!policy.upload && d.status === "enqueue") {
      d.status = "skipped";
      d.reason = policy.reason;
    }
    decisions.push(d);

    // "Nothing new to send" is not recorded; everything else leaves an audit row.
    if (d.status === "skipped" && d.increment === 0) continue;
    const status = d.status === "enqueue" ? "pending" : d.status;
    const idem = `${workspaceId}:${leadId}:${reached}:${conn.id}:${mode}${status === "pending" ? "" : `:${status}`}`;
    await db.from("signal_jobs").upsert(
      {
        workspace_id: workspaceId,
        lead_id: leadId,
        connection_id: conn.id,
        platform,
        mode,
        canonical_stage: reached,
        idempotency_key: idem,
        transaction_id: `${leadId}-${reached}`,
        match_type: d.matchType ?? null,
        value_increment: Math.max(0, d.increment),
        cumulative_after: d.cumulative,
        currency: lead.currency,
        status,
        error: d.reason ?? null,
      },
      { onConflict: "idempotency_key", ignoreDuplicates: true },
    );
  }

  if (decisions.some((d) => d.status === "enqueue")) await dispatch("ose/signals.deliver", { workspaceId });
  return decisions;
}
