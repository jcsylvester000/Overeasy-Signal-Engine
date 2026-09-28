import "server-only";
import { admin } from "@/lib/supabase/admin";
import { effectiveMode } from "@/lib/env";
import { sendGoogle } from "@/connectors/google/datamanager";
import { sendMicrosoft } from "@/connectors/microsoft/offline";
import { markConnection } from "@/connectors/tokens";
import { ConnectorError, type Connection, type OutboundConversion, type SendResult } from "@/connectors/types";
import { raiseAlert } from "./alerts";
import { writeBack } from "./crm";

const MAX_ATTEMPTS = 8;
const backoffMs = (attempt: number) => Math.min(6 * 3_600_000, 60_000 * 2 ** attempt) * (0.75 + Math.random() * 0.5);

type Job = {
  id: string;
  workspace_id: string;
  lead_id: string;
  connection_id: string;
  platform: "google" | "microsoft";
  mode: "dry_run" | "test" | "live";
  canonical_stage: string;
  transaction_id: string;
  value_increment: number;
  currency: string;
  attempts: number;
};

/**
 * Delivery worker (spec §12 step 6). Claims pending jobs (pending → sending) so two workers can never
 * send the same job, batches them per connection + stage, calls the platform, records every response.
 */
export async function deliverPending(workspaceId?: string, limit = 500) {
  const db = admin();
  // Recover jobs stuck in "sending" (worker crashed) after 15 minutes. Google dedupes on transactionId.
  await db
    .from("signal_jobs")
    .update({ status: "pending" })
    .eq("status", "sending")
    .lt("updated_at", new Date(Date.now() - 15 * 60_000).toISOString());

  let q = db
    .from("signal_jobs")
    .select("id")
    .eq("status", "pending")
    .or(`next_attempt_at.is.null,next_attempt_at.lte.${new Date().toISOString()}`)
    .order("created_at")
    .limit(limit);
  if (workspaceId) q = q.eq("workspace_id", workspaceId);
  const { data: candidates } = await q;
  if (!candidates?.length) return { claimed: 0 };

  const { data: claimed } = await db
    .from("signal_jobs")
    .update({ status: "sending" })
    .in("id", candidates.map((c) => c.id))
    .eq("status", "pending")
    .select("*");
  const jobs = (claimed ?? []) as Job[];
  if (!jobs.length) return { claimed: 0 };

  const groups = new Map<string, Job[]>();
  for (const j of jobs) {
    const k = `${j.connection_id}|${j.canonical_stage}|${j.mode}`;
    groups.set(k, [...(groups.get(k) ?? []), j]);
  }

  const touchedLeads = new Set<string>();
  for (const [key, group] of groups) {
    const [connectionId, stage] = key.split("|");
    await deliverGroup(connectionId, stage, group);
    group.forEach((j) => touchedLeads.add(`${j.workspace_id}|${j.lead_id}`));
  }
  for (const k of touchedLeads) {
    const [ws, lead] = k.split("|");
    await writeBack(ws, lead).catch((e) => console.error("[writeBack]", e));
  }
  return { claimed: jobs.length };
}

async function deliverGroup(connectionId: string, stage: string, jobs: Job[]) {
  const db = admin();
  const { data: conn } = await db.from("connections").select("*").eq("id", connectionId).maybeSingle<Connection>();
  if (!conn) return finish(jobs, "failed", "Connection removed");
  const mode = effectiveMode(jobs[0].mode);

  // Destination: conversion action (Google) or goal name (Microsoft) for this stage.
  const { data: dest } = await db
    .from("conversion_destinations")
    .select("conversion_action_id,goal_name")
    .eq("connection_id", connectionId)
    .eq("canonical_stage", stage)
    .maybeSingle<{ conversion_action_id: string | null; goal_name: string | null }>();
  const destination = conn.provider === "google_ads" ? dest?.conversion_action_id : dest?.goal_name;
  if (!destination && mode !== "dry_run") return finish(jobs, "no_destination", `No ${conn.provider === "google_ads" ? "conversion action" : "offline goal"} mapped for stage "${stage}"`);

  const { data: leads } = await db
    .from("leads")
    .select("id,attribution,email_sha256,phone_sha256,consent")
    .in("id", jobs.map((j) => j.lead_id));
  const byId = new Map((leads ?? []).map((l) => [l.id as string, l]));
  const { data: events } = await db
    .from("stage_events")
    .select("lead_id,canonical_stage,occurred_at")
    .in("lead_id", jobs.map((j) => j.lead_id))
    .eq("canonical_stage", stage);
  const when = new Map((events ?? []).map((e) => [e.lead_id as string, e.occurred_at as string]));

  const conversions: OutboundConversion[] = jobs.map((j) => {
    const l = byId.get(j.lead_id);
    const a = (l?.attribution ?? {}) as Record<string, string | null>;
    const c = (l?.consent ?? {}) as Record<string, "granted" | "denied" | "unknown">;
    return {
      jobId: j.id,
      transactionId: j.transaction_id,
      value: Number(j.value_increment),
      currency: j.currency,
      eventTime: when.get(j.lead_id) ?? new Date().toISOString(),
      clickIds: { gclid: a.gclid, gbraid: a.gbraid, wbraid: a.wbraid, msclkid: a.msclkid },
      emailSha256: l?.email_sha256 as string | null,
      phoneSha256: l?.phone_sha256 as string | null,
      consent: { adUserData: c.ad_user_data ?? "unknown", adPersonalization: c.ad_personalization ?? "unknown" },
    };
  });

  let result: SendResult;
  try {
    const target = destination ?? `dry-run:${stage}`;
    result = conn.provider === "google_ads" ? await sendGoogle(conn, target, conversions, mode) : await sendMicrosoft(conn, target, conversions, mode);
    if (mode !== "dry_run") await markConnection(conn.id, "ok");
  } catch (e) {
    const retryable = e instanceof ConnectorError ? e.retryable : true;
    const msg = e instanceof Error ? e.message : String(e);
    if (!retryable) await markConnection(conn.id, "error", msg);
    return retryOrFail(jobs, msg, retryable);
  }

  const now = new Date().toISOString();
  const okStatus = mode === "live" ? "sent" : mode;
  for (const j of jobs) {
    const r = result.results[j.id];
    if (r?.ok) {
      await db.from("signal_jobs").update({ status: okStatus, attempts: j.attempts + 1, sent_at: now, request: result.request, response: result.response, error: null }).eq("id", j.id);
    } else {
      await retryOrFail([j], r?.error ?? "Unknown error", r?.retryable ?? true, result);
    }
  }
}

async function retryOrFail(jobs: Job[], error: string, retryable: boolean, result?: SendResult) {
  const db = admin();
  for (const j of jobs) {
    const attempts = j.attempts + 1;
    const dead = !retryable || attempts >= MAX_ATTEMPTS;
    await db
      .from("signal_jobs")
      .update({
        status: dead ? "dead" : "pending",
        attempts,
        error,
        next_attempt_at: dead ? null : new Date(Date.now() + backoffMs(attempts)).toISOString(),
        request: result?.request ?? null,
        response: result?.response ?? null,
      })
      .eq("id", j.id);
    if (dead) {
      await raiseAlert(j.workspace_id, {
        type: "sync_failure",
        severity: "critical",
        title: `Upload to ${j.platform} failed for a ${j.canonical_stage} signal`,
        detail: { jobId: j.id, error: error.slice(0, 300) },
        dedupeKey: `sync:${j.platform}:${j.canonical_stage}`,
      });
    }
  }
}

async function finish(jobs: Job[], status: string, error: string) {
  await admin().from("signal_jobs").update({ status, error }).in("id", jobs.map((j) => j.id));
  if (status === "no_destination") {
    await raiseAlert(jobs[0].workspace_id, { type: "sync_failure", severity: "warning", title: error, dedupeKey: `nodest:${jobs[0].connection_id}:${jobs[0].canonical_stage}` });
  }
}

/** Manual re-send from the UI (DEL-04): dead/failed → pending. */
export async function resendJob(workspaceId: string, jobId: string) {
  await admin()
    .from("signal_jobs")
    .update({ status: "pending", next_attempt_at: null, error: null })
    .eq("id", jobId)
    .eq("workspace_id", workspaceId)
    .in("status", ["dead", "failed", "no_destination"]);
}
