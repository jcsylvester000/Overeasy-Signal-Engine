import "server-only";
import { randomUUID } from "node:crypto";
import { admin } from "@/lib/supabase/admin";
import { parseCsv } from "@/core/csv";
import { hashEmail, hashEmailMicrosoft, hashPhone } from "@/core/hash";
import { isCanonicalStage, rungIndex, RUNGS } from "@/core/stages";

/**
 * LCM-07: import historical opportunities for reporting and calibration only. Imported leads have source "import"
 * and never create platform uploads (signals.ts skips them), so old data can't distort bidding.
 * Columns: created_at, stage, lead_type, campaign, platform, state, email, phone, funded_value, lost_reason, stage_date
 */
export async function importHistory(workspaceId: string, csv: string) {
  const [head, ...rows] = parseCsv(csv.replace(/^\uFEFF/, ""));
  if (!head) throw new Error("The file is empty.");
  const h = head.map((x) => x.trim().toLowerCase());
  const col = (n: string) => h.indexOf(n);
  if (col("created_at") < 0 || col("stage") < 0) throw new Error('The header row must include "created_at" and "stage".');
  const { data: ws } = await admin().from("workspaces").select("currency").eq("id", workspaceId).single();
  const leads: Record<string, unknown>[] = [];
  const events: Record<string, unknown>[] = [];
  let skipped = 0;
  for (const r of rows.slice(0, 20000)) {
    const get = (n: string) => (col(n) >= 0 ? (r[col(n)] ?? "").trim() : "");
    const created = Date.parse(get("created_at"));
    const stage = get("stage").toLowerCase();
    if (!Number.isFinite(created) || !isCanonicalStage(stage)) {
      skipped++;
      continue;
    }
    const stageAt = Date.parse(get("stage_date")) || created;
    const id = randomUUID();
    const platform = get("platform").toLowerCase();
    const funded = Number(get("funded_value").replace(/[$,]/g, "")) || null;
    leads.push({
      id,
      workspace_id: workspaceId,
      source: "import",
      form: "history-import",
      attribution: { utm_campaign: get("campaign") || undefined, utm_source: platform || undefined },
      email_sha256: hashEmail(get("email")),
      email_sha256_ms: hashEmailMicrosoft(get("email")),
      phone_sha256: hashPhone(get("phone")),
      geo: get("state") || null,
      answers: {},
      lead_type: get("lead_type") || null,
      canonical_stage: stage,
      lost_reason: stage === "lost" ? get("lost_reason") || "imported" : null,
      value_current: stage === "funded" && funded ? funded : 0,
      currency: ws?.currency ?? "USD",
      is_test: false,
      created_at: new Date(created).toISOString(),
    });
    // Record every rung up to the reached stage so funnel and calibration counts are correct.
    const top = stage === "lost" ? 0 : rungIndex(stage);
    for (let i = 0; i <= top; i++) {
      events.push({ workspace_id: workspaceId, lead_id: id, canonical_stage: RUNGS[i], occurred_at: new Date(i === top ? stageAt : created).toISOString(), source: "api", actual_value: RUNGS[i] === "funded" ? funded : null });
    }
    if (stage === "lost") events.push({ workspace_id: workspaceId, lead_id: id, canonical_stage: "lost", occurred_at: new Date(stageAt).toISOString(), source: "api", lost_reason: get("lost_reason") || "imported" });
  }
  for (let i = 0; i < leads.length; i += 400) {
    const { error } = await admin().from("leads").insert(leads.slice(i, i + 400));
    if (error) throw new Error(error.message);
  }
  for (let i = 0; i < events.length; i += 500) {
    const { error } = await admin().from("stage_events").insert(events.slice(i, i + 500));
    if (error) throw new Error(error.message);
  }
  return { imported: leads.length, skipped };
}
