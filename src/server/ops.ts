import "server-only";
import { admin } from "@/lib/supabase/admin";
import { effectiveMode } from "@/lib/env";
import { rungIndex, RUNGS, STAGE_LABEL, type Rung } from "@/core/stages";
import { proposeCalibration, type OutcomeLead } from "@/core/calibration";
import { validateLadder } from "@/core/value/engine";
import { hashEmail, hashEmailMicrosoft, hashPhone, sha256Hex, normalizeEmail, normalizePhone } from "@/core/hash";
import { createGoogleConversionActions } from "@/connectors/google/ads";
import { createMicrosoftGoals } from "@/connectors/microsoft/reporting";
import type { Connection } from "@/connectors/types";
import { publishedScoring, publishedValue } from "./models";
import { ghl, ghlCalls } from "@/connectors/ghl/client";

// ------------------------------------------------------------------ Calibration (VAL-06)
export async function calibrationFor(workspaceId: string, lookbackDays = 365) {
  const db = admin();
  const value = await publishedValue(workspaceId);
  if (!value) return null;
  const since = new Date(Date.now() - lookbackDays * 86_400_000).toISOString();
  const { data: leads } = await db.from("leads").select("id,lead_type,canonical_stage,created_at").eq("workspace_id", workspaceId).eq("is_test", false).gte("created_at", since).limit(20000);
  const ids = (leads ?? []).map((l) => l.id as string);
  const reached = new Map<string, Rung>();
  const fundedValue = new Map<string, number>();
  for (let i = 0; i < ids.length; i += 500) {
    const { data: ev } = await db.from("stage_events").select("lead_id,canonical_stage,actual_value").in("lead_id", ids.slice(i, i + 500));
    for (const e of ev ?? []) {
      if (rungIndex(e.canonical_stage) > rungIndex(reached.get(e.lead_id) ?? "submitted")) reached.set(e.lead_id, e.canonical_stage as Rung);
      if (e.canonical_stage === "funded" && e.actual_value !== null) fundedValue.set(e.lead_id, Number(e.actual_value));
    }
  }
  const outcomes: OutcomeLead[] = (leads ?? []).map((l) => {
    const r = reached.get(l.id) ?? "submitted";
    return {
      leadType: l.lead_type,
      reached: r,
      lost: l.canonical_stage === "lost",
      funded: r === "funded",
      fundedValue: fundedValue.get(l.id) ?? null,
      ageDays: (Date.now() - new Date(l.created_at).getTime()) / 86_400_000,
    };
  });
  return { value, proposal: proposeCalibration(value.model, outcomes), total: outcomes.length };
}

// ------------------------------------------------------------------ Bidding readiness (V-12 / V-15)
export type Check = { key: string; label: string; ok: boolean; detail: string; manual?: boolean };

export async function readiness(workspaceId: string) {
  const db = admin();
  const since30 = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const [{ data: ws }, { data: sites }, { data: conns }, { data: dests }, { data: maps }, { data: jobs }, { data: firstLive }, value, scoring] = await Promise.all([
    db.from("workspaces").select("settings").eq("id", workspaceId).maybeSingle(),
    db.from("sites").select("last_event_at").eq("workspace_id", workspaceId),
    db.from("connections").select("id,provider,mode,status").eq("workspace_id", workspaceId).in("provider", ["google_ads", "microsoft_ads"]).neq("status", "disconnected"),
    db.from("conversion_destinations").select("connection_id,canonical_stage").eq("workspace_id", workspaceId),
    db.from("stage_maps").select("canonical_stage").eq("workspace_id", workspaceId),
    db.from("signal_jobs").select("status,canonical_stage,mode").eq("workspace_id", workspaceId).gte("created_at", since30).in("mode", ["live"]),
    db.from("signal_jobs").select("sent_at").eq("workspace_id", workspaceId).eq("status", "sent").order("sent_at").limit(1).maybeSingle(),
    publishedValue(workspaceId),
    publishedScoring(workspaceId),
  ]);
  const settings = (ws?.settings ?? {}) as { acks?: Record<string, boolean> };
  const acks = settings.acks ?? {};
  const live = (conns ?? []).filter((c) => effectiveMode(c.mode) === "live" && c.status === "ok");
  const uploadStages = value?.model.uploadStages ?? [];
  const missingDest = live.flatMap((c) => uploadStages.filter((s) => !(dests ?? []).some((d) => d.connection_id === c.id && d.canonical_stage === s)).map((s) => `${c.provider}:${s}`));
  const sentLive = (jobs ?? []).filter((j) => j.status === "sent").length;
  const failedLive = (jobs ?? []).filter((j) => ["dead", "failed", "no_destination"].includes(j.status)).length;
  const rate = sentLive + failedLive ? sentLive / (sentLive + failedLive) : 0;
  const perStage = (s: string) => (jobs ?? []).filter((j) => j.status === "sent" && j.canonical_stage === s).length;
  const observedDays = firstLive?.sent_at ? (Date.now() - new Date(firstLive.sent_at).getTime()) / 86_400_000 : 0;
  const ladder = value && scoring ? validateLadder(value.model, scoring.model.clamp.max) : null;

  const checks: Check[] = [
    { key: "tag", label: "Website tag receiving events (last 24 h)", ok: (sites ?? []).some((s) => s.last_event_at && Date.now() - new Date(s.last_event_at).getTime() < 86_400_000), detail: `${(sites ?? []).length} site(s)` },
    { key: "live", label: "At least one ad account connected in live mode", ok: live.length > 0, detail: live.length ? live.map((c) => c.provider).join(", ") : "All connections are dry run / test" },
    { key: "dest", label: "Conversion action / goal mapped for every uploaded stage", ok: live.length > 0 && missingDest.length === 0, detail: missingDest.length ? `Missing: ${missingDest.join(", ")}` : "OK" },
    { key: "stages", label: "Every CRM stage mapped (none left on ignore by accident)", ok: (maps ?? []).length > 0 && (maps ?? []).some((m) => m.canonical_stage === "contract"), detail: `${(maps ?? []).length} CRM stage(s) mapped` },
    { key: "ladder", label: "Value ladder rises at every stage", ok: Boolean(ladder?.ok), detail: ladder?.ok ? "Valid" : "Fix on the Value ladder page" },
    { key: "observe", label: "Observation period ≥ 30 days of live (secondary) uploads", ok: observedDays >= 30, detail: `${Math.floor(observedDays)} day(s)` },
    { key: "success", label: "Upload success ≥ 99% (last 30 days)", ok: sentLive > 0 && rate >= 0.99, detail: sentLive + failedLive ? `${(rate * 100).toFixed(1)}% of ${sentLive + failedLive}` : "No live uploads yet" },
    { key: "volume", label: "≥ 15 Qualified and ≥ 15 Contract conversions in 30 days", ok: perStage("qualified") >= 15 && perStage("contract") >= 15, detail: `Qualified ${perStage("qualified")}, Contract ${perStage("contract")}` },
    { key: "privacy", label: "Client privacy policy discloses sharing with Google/Microsoft", ok: Boolean(acks.privacy), detail: "Confirm manually", manual: true },
    { key: "sales", label: "Sales team trained on stage entry rules", ok: Boolean(acks.sales), detail: "Confirm manually", manual: true },
  ];
  return { checks, ready: checks.every((c) => c.ok) };
}

// ------------------------------------------------------------------ Conversion actions (DEL-03)
export async function createConversionActions(workspaceId: string, connectionId: string, prefix: string) {
  const db = admin();
  const { data: conn } = await db.from("connections").select("*").eq("id", connectionId).eq("workspace_id", workspaceId).maybeSingle<Connection>();
  if (!conn) throw new Error("Connection not found");
  const value = await publishedValue(workspaceId);
  const { data: ws } = await db.from("workspaces").select("currency").eq("id", workspaceId).single();
  const stages = (value?.model.uploadStages ?? RUNGS) as Rung[];
  const names = stages.map((s) => ({ stage: s, name: `${prefix} – ${STAGE_LABEL[s]}`.slice(0, 100) }));
  const mode = effectiveMode(conn.mode);
  const platform = conn.provider === "google_ads" ? "google" : "microsoft";
  let request: unknown;
  let ids: string[] = [];
  if (conn.provider === "google_ads") {
    const r = await createGoogleConversionActions(conn, names, ws?.currency ?? "USD", mode);
    request = r.request;
    ids = r.ids;
  } else {
    request = (await createMicrosoftGoals(conn, names, ws?.currency ?? "USD", mode)).request;
  }
  // test mode validates only: nothing was created, so destinations are not stored.
  if (mode !== "test") {
    for (let i = 0; i < names.length; i++) {
      await db.from("conversion_destinations").upsert(
        {
          workspace_id: workspaceId,
          connection_id: conn.id,
          platform,
          canonical_stage: names[i].stage,
          conversion_action_id: platform === "google" ? ids[i] || null : null,
          goal_name: platform === "microsoft" ? names[i].name : null,
          role: "secondary",
        },
        { onConflict: "connection_id,canonical_stage" },
      );
    }
  }
  return { mode, created: names.length, request };
}

// ------------------------------------------------------------------ Data-subject requests (B3)
export async function findSubject(workspaceId: string, identifier: string) {
  const db = admin();
  const id = identifier.trim();
  const isEmail = id.includes("@");
  const hashes = isEmail ? [hashEmail(id), hashEmailMicrosoft(id)].filter(Boolean) : [hashPhone(id), hashPhone(id, "63")].filter(Boolean);
  if (!hashes.length) throw new Error("Enter a valid email address or phone number.");
  const col = isEmail ? "email_sha256" : "phone_sha256";
  const { data } = await db.from("leads").select("*").eq("workspace_id", workspaceId).in(col, hashes as string[]);
  const subjectHash = sha256Hex((isEmail ? normalizeEmail(id) : normalizePhone(id)) ?? id);
  return { leads: data ?? [], subjectHash };
}

export async function dsarExport(workspaceId: string, identifier: string) {
  const db = admin();
  const { leads, subjectHash } = await findSubject(workspaceId, identifier);
  const ids = leads.map((l) => l.id as string);
  const [ev, jobs, links] = ids.length
    ? await Promise.all([
        db.from("stage_events").select("lead_id,canonical_stage,occurred_at,source").in("lead_id", ids),
        db.from("signal_jobs").select("lead_id,platform,canonical_stage,status,value_increment,sent_at").in("lead_id", ids),
        db.from("crm_links").select("lead_id,provider,contact_id,opportunity_id").in("lead_id", ids),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }];
  await db.from("dsar_requests").insert({ workspace_id: workspaceId, kind: "access", subject_hash: subjectHash, matched_leads: ids.length });
  return { subjectHash, leads, stageEvents: ev.data, platformUploads: jobs.data, crmLinks: links.data };
}

/** Delete everything held about a person in this workspace; list uploads that need retraction on the ad platforms. */
export async function dsarDelete(workspaceId: string, identifier: string, actorId: string) {
  const db = admin();
  const { leads, subjectHash } = await findSubject(workspaceId, identifier);
  const ids = leads.map((l) => l.id as string);
  const visitorIds = leads.map((l) => l.visitor_id).filter(Boolean) as string[];
  let retract: unknown[] = [];
  if (ids.length) {
    const { data: jobs } = await db.from("signal_jobs").select("platform,transaction_id,status").in("lead_id", ids).eq("status", "sent");
    retract = jobs ?? [];
    if (visitorIds.length) await db.from("visits").delete().eq("workspace_id", workspaceId).in("visitor_id", visitorIds);
    await db.from("leads").delete().eq("workspace_id", workspaceId).in("id", ids); // cascades: pii, events, jobs, links, crm_ops
  }
  await db.from("dsar_requests").insert({
    workspace_id: workspaceId,
    kind: "delete",
    subject_hash: subjectHash,
    matched_leads: ids.length,
    requested_by: actorId,
    detail: { retractOnPlatforms: retract, note: "Retract listed transaction IDs via Google conversion adjustments / Microsoft offline conversion adjustments; delete the CRM contact in the client's CRM." },
  });
  return { deleted: ids.length, retract };
}

// ------------------------------------------------------------------ GHL pipelines → stage map (L-06)
const GUESS: [RegExp, string][] = [
  [/fund|closed.?won|paid|closed$/i, "funded"],
  [/assign|sold|resold/i, "sold"],
  [/contract|signed|under/i, "contract"],
  [/offer|opportun|proposal|appoint|quote/i, "opportunity"],
  [/qualif/i, "qualified"],
  [/dead|lost|junk|disqual|not.?interested/i, "lost"],
  [/new|lead|inbound/i, "submitted"],
];

export function guessCanonical(name: string) {
  return GUESS.find(([re]) => re.test(name))?.[1] ?? "ignore";
}

export async function importGhlPipelines(workspaceId: string, connectionId: string) {
  const db = admin();
  const { data: conn } = await db.from("connections").select("*").eq("id", connectionId).eq("workspace_id", workspaceId).maybeSingle<Connection>();
  if (!conn || conn.provider !== "ghl") throw new Error("GoHighLevel connection not found");
  const mode = effectiveMode(conn.mode);
  if (mode !== "live") return { mode, added: 0 };
  const res = await ghl<{ pipelines?: { id: string; name: string; stages?: { id: string; name: string }[] }[] }>(conn, ghlCalls.pipelines(conn.external_account ?? ""), mode);
  let added = 0;
  for (const p of res.data?.pipelines ?? []) {
    for (const s of p.stages ?? []) {
      const { error } = await db.from("stage_maps").upsert(
        { workspace_id: workspaceId, provider: "ghl", pipeline_id: p.id, pipeline_name: p.name, stage_id: s.id, stage_name: s.name, canonical_stage: guessCanonical(s.name) },
        { onConflict: "workspace_id,provider,pipeline_id,stage_id", ignoreDuplicates: true },
      );
      if (!error) added++;
    }
  }
  return { mode, added };
}
