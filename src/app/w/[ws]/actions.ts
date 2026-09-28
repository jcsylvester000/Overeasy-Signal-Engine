"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { admin } from "@/lib/supabase/admin";
import { audit } from "@/lib/audit";
import { encrypt, randomToken, sha256 } from "@/lib/crypto";
import { requireUser, requireWorkspace } from "@/lib/tenancy";
import { ScoringModel } from "@/core/scoring/types";
import { validateForPublish } from "@/core/scoring/evaluate";
import { validateLadder } from "@/core/value/engine";
import { CANONICAL_STAGES, RUNGS } from "@/core/stages";
import { publishedScoring, publishedValue } from "@/server/models";
import { intakeLead } from "@/server/intake";
import { recordStage } from "@/server/lifecycle";
import { deliverPending, resendJob } from "@/server/delivery";
import { installGhl } from "@/server/crm";
import { newSiteKey } from "@/server/provision";
import type { Connection } from "@/connectors/types";

async function ctx(wsId: string, minRank: number) {
  const user = await requireUser();
  const access = await requireWorkspace(wsId, minRank);
  return { user, ...access, db: admin() };
}
const go = (wsId: string, path: string, q?: Record<string, string>) => redirect(`/w/${wsId}${path}${q ? `?${new URLSearchParams(q)}` : ""}`);

// ---------------------------------------------------------------- ① Scoring
function modelFromPointsForm(base: ScoringModel, fd: FormData): ScoringModel {
  const m: ScoringModel = structuredClone(base);
  m.base = Number(fd.get("base") ?? m.base);
  m.clamp = { min: Number(fd.get("clamp_min") ?? m.clamp.min), max: Number(fd.get("clamp_max") ?? m.clamp.max) };
  m.rules = m.rules.map((r, i) => {
    if (r.kind === "map") {
      const map: Record<string, number> = {};
      for (const k of Object.keys(r.map)) {
        const v = fd.get(`r${i}:${k}`);
        map[k] = v === null || v === "" ? r.map[k] : Number(v);
      }
      return { ...r, map };
    }
    return { ...r, ranges: r.ranges.map((x, j) => ({ ...x, points: Number(fd.get(`r${i}:${j}`) ?? x.points) })) };
  });
  return m;
}

export async function saveScoring(wsId: string, fd: FormData) {
  const { user, ws, db } = await ctx(wsId, 3);
  const intent = String(fd.get("intent") ?? "draft");
  let model: unknown;
  if (fd.get("json")) {
    try {
      model = JSON.parse(String(fd.get("json")));
    } catch {
      go(wsId, "/scoring", { error: "The JSON is not valid." });
    }
  } else {
    const current = (await publishedScoring(ws.id))?.model;
    const { data: draft } = await db.from("scoring_models").select("model").eq("workspace_id", ws.id).eq("status", "draft").order("version", { ascending: false }).limit(1).maybeSingle();
    const base = ScoringModel.safeParse(draft?.model ?? current);
    if (!base.success) go(wsId, "/scoring", { error: "No base model to edit." });
    model = modelFromPointsForm(base.data!, fd);
  }

  const check = validateForPublish(model);
  const { data: last } = await db.from("scoring_models").select("version").eq("workspace_id", ws.id).order("version", { ascending: false }).limit(1).maybeSingle();
  const version = (last?.version ?? 0) + 1;

  if (intent === "publish" && !check.ok) {
    await db.from("scoring_models").delete().eq("workspace_id", ws.id).eq("status", "draft");
    await db.from("scoring_models").insert({ workspace_id: ws.id, version, status: "draft", model, notes: "Publish blocked: tests failed" });
    go(wsId, "/scoring", { error: `Publishing blocked: ${check.errors.slice(0, 3).join(" · ")}` });
  }
  await db.from("scoring_models").delete().eq("workspace_id", ws.id).eq("status", "draft");
  if (intent === "publish") {
    await db.from("scoring_models").update({ status: "archived" }).eq("workspace_id", ws.id).eq("status", "published");
    await db.from("scoring_models").insert({ workspace_id: ws.id, version, status: "published", model, published_by: user.id, published_at: new Date().toISOString(), notes: String(fd.get("notes") ?? "") || null });
    await audit({ orgId: ws.org_id, workspaceId: ws.id, actorId: user.id, action: "scoring.publish", entity: "scoring_model", entityId: String(version) });
    revalidatePath(`/w/${wsId}/scoring`);
    go(wsId, "/scoring", { saved: `Version ${version} published. Existing leads keep their stored scores.` });
  }
  await db.from("scoring_models").insert({ workspace_id: ws.id, version, status: "draft", model, notes: check.ok ? null : "Tests failing" });
  await audit({ orgId: ws.org_id, workspaceId: ws.id, actorId: user.id, action: "scoring.draft", entity: "scoring_model", entityId: String(version) });
  revalidatePath(`/w/${wsId}/scoring`);
  go(wsId, "/scoring", check.ok ? { saved: "Draft saved. All tests pass." } : { error: `Draft saved, but tests fail: ${check.errors.slice(0, 3).join(" · ")}` });
}

export async function rollbackScoring(wsId: string, versionId: string) {
  const { user, ws, db } = await ctx(wsId, 3);
  const { data: old } = await db.from("scoring_models").select("model,version").eq("id", versionId).eq("workspace_id", ws.id).maybeSingle();
  if (!old) go(wsId, "/scoring", { error: "Version not found" });
  const { data: last } = await db.from("scoring_models").select("version").eq("workspace_id", ws.id).order("version", { ascending: false }).limit(1).maybeSingle();
  const version = (last?.version ?? 0) + 1;
  await db.from("scoring_models").delete().eq("workspace_id", ws.id).eq("status", "draft");
  await db.from("scoring_models").update({ status: "archived" }).eq("workspace_id", ws.id).eq("status", "published");
  await db.from("scoring_models").insert({ workspace_id: ws.id, version, status: "published", model: old!.model, notes: `Rollback to v${old!.version}`, published_by: user.id, published_at: new Date().toISOString() });
  await audit({ orgId: ws.org_id, workspaceId: ws.id, actorId: user.id, action: "scoring.rollback", entity: "scoring_model", entityId: String(version), diff: { from: old!.version } });
  revalidatePath(`/w/${wsId}/scoring`);
  go(wsId, "/scoring", { saved: `Rolled back: v${old!.version} republished as v${version}.` });
}

// ---------------------------------------------------------------- ⑤ Value ladder
export async function saveValue(wsId: string, fd: FormData) {
  const { user, ws, db } = await ctx(wsId, 3);
  const current = (await publishedValue(ws.id))?.model;
  if (!current) go(wsId, "/value", { error: "No value model" });
  const num = (k: string, d: number | undefined) => {
    const v = fd.get(k);
    return v === null || v === "" ? d : Number(v);
  };
  const types = String(fd.get("types") ?? "").split("|").filter(Boolean);
  const spreads: Record<string, number> = {};
  for (const t of types) {
    if (fd.get(`remove:${t}`)) continue;
    spreads[t] = Number(num(`spread:${t}`, current!.spreads[t] ?? 0));
  }
  const newType = String(fd.get("new_type") ?? "").trim();
  if (newType) spreads[newType] = Number(fd.get("new_spread") ?? 0);
  spreads.default ??= current!.spreads.default;

  const model = {
    ...current!,
    currency: ws.currency,
    stageProbs: Object.fromEntries(RUNGS.map((r) => [r, Number(num(`p:${r}`, current!.stageProbs[r] * 100)) / 100])),
    spreads,
    caps: Object.fromEntries(RUNGS.map((r) => [r, num(`cap:${r}`, undefined)])),
    formRung: { mode: String(fd.get("form_mode") ?? current!.formRung.mode), fixedValue: num("form_fixed", current!.formRung.fixedValue) },
    uploadStages: RUNGS.filter((r) => fd.get(`up:${r}`)),
    trueUpFunded: Boolean(fd.get("true_up")),
  };
  const scoring = await publishedScoring(ws.id);
  const check = validateLadder(model, scoring?.model.clamp.max ?? 0);
  if (!check.ok) go(wsId, "/value", { error: check.issues.filter((i) => i.level === "error").map((i) => i.message).slice(0, 3).join(" · ") });

  const { data: last } = await db.from("value_models").select("version").eq("workspace_id", ws.id).order("version", { ascending: false }).limit(1).maybeSingle();
  const version = (last?.version ?? 0) + 1;
  await db.from("value_models").update({ status: "archived" }).eq("workspace_id", ws.id).eq("status", "published");
  await db.from("value_models").insert({ workspace_id: ws.id, version, status: "published", model: check.model, published_by: user.id, published_at: new Date().toISOString(), notes: String(fd.get("notes") ?? "") || null });
  await audit({ orgId: ws.org_id, workspaceId: ws.id, actorId: user.id, action: "value.publish", entity: "value_model", entityId: String(version), diff: { stageProbs: model.stageProbs, spreads } });
  revalidatePath(`/w/${wsId}/value`);
  go(wsId, "/value", { saved: `Value ladder v${version} published. It applies to the next stage change of each lead.` });
}

// ---------------------------------------------------------------- ② Stages
export async function saveStageMaps(wsId: string, fd: FormData) {
  const { user, ws, db } = await ctx(wsId, 3);
  for (const [k, v] of fd.entries()) {
    if (!k.startsWith("map:")) continue;
    const id = k.slice(4);
    const stage = String(v);
    if (![...CANONICAL_STAGES, "ignore"].includes(stage as never)) continue;
    await db.from("stage_maps").update({ canonical_stage: stage }).eq("id", id).eq("workspace_id", ws.id);
  }
  await db.from("alerts").update({ status: "resolved", resolved_at: new Date().toISOString() }).eq("workspace_id", ws.id).eq("type", "stage_unmapped").neq("status", "resolved");
  await audit({ orgId: ws.org_id, workspaceId: ws.id, actorId: user.id, action: "stages.map", entity: "stage_maps" });
  revalidatePath(`/w/${wsId}/stages`);
  go(wsId, "/stages", { saved: "Stage mapping saved." });
}

export async function addStageMap(wsId: string, fd: FormData) {
  const { user, ws, db } = await ctx(wsId, 3);
  const row = {
    workspace_id: ws.id,
    provider: String(fd.get("provider") ?? "ghl"),
    pipeline_id: String(fd.get("pipeline_id") ?? "").trim(),
    pipeline_name: String(fd.get("pipeline_name") ?? "").trim() || null,
    stage_id: String(fd.get("stage_id") ?? "").trim(),
    stage_name: String(fd.get("stage_name") ?? "").trim() || null,
    canonical_stage: String(fd.get("canonical_stage") ?? "ignore"),
  };
  if (!row.pipeline_id || !row.stage_id) go(wsId, "/stages", { error: "Pipeline ID and stage ID are required." });
  const { error } = await db.from("stage_maps").upsert(row, { onConflict: "workspace_id,provider,pipeline_id,stage_id" });
  if (error) go(wsId, "/stages", { error: error.message });
  await audit({ orgId: ws.org_id, workspaceId: ws.id, actorId: user.id, action: "stages.add", entity: "stage_maps", diff: row });
  revalidatePath(`/w/${wsId}/stages`);
  go(wsId, "/stages", { saved: "Stage added." });
}

// ---------------------------------------------------------------- Connections
export async function saveConnection(wsId: string, connId: string, fd: FormData) {
  const { user, ws, db } = await ctx(wsId, 4);
  const mode = String(fd.get("mode") ?? "dry_run");
  const patch = {
    mode: ["dry_run", "test", "live"].includes(mode) ? mode : "dry_run",
    external_account: String(fd.get("external_account") ?? "").trim() || null,
    login_account: String(fd.get("login_account") ?? "").trim() || null,
    display_name: String(fd.get("display_name") ?? "").trim() || null,
  };
  const { error } = await db.from("connections").update(patch).eq("id", connId).eq("workspace_id", ws.id);
  if (error) go(wsId, "/connections", { error: error.message });
  await audit({ orgId: ws.org_id, workspaceId: ws.id, actorId: user.id, action: "connection.update", entity: "connection", entityId: connId, diff: patch });
  revalidatePath(`/w/${wsId}/connections`);
  go(wsId, "/connections", { saved: "Connection saved." });
}

export async function addConnection(wsId: string, fd: FormData) {
  const { user, ws, db } = await ctx(wsId, 4);
  const provider = String(fd.get("provider") ?? "");
  if (!["google_ads", "microsoft_ads", "ghl"].includes(provider)) go(wsId, "/connections", { error: "Unknown provider" });
  const { error } = await db.from("connections").insert({ workspace_id: ws.id, provider, mode: "dry_run", external_account: `pending-${randomToken(4)}`, display_name: String(fd.get("display_name") ?? "") || null });
  if (error) go(wsId, "/connections", { error: error.message });
  await audit({ orgId: ws.org_id, workspaceId: ws.id, actorId: user.id, action: "connection.add", entity: "connection", diff: { provider } });
  revalidatePath(`/w/${wsId}/connections`);
  go(wsId, "/connections", { saved: "Connection added (dry run)." });
}

export async function removeConnection(wsId: string, connId: string) {
  const { user, ws, db } = await ctx(wsId, 4);
  await db.from("connections").update({ status: "disconnected" }).eq("id", connId).eq("workspace_id", ws.id);
  await audit({ orgId: ws.org_id, workspaceId: ws.id, actorId: user.id, action: "connection.disconnect", entity: "connection", entityId: connId });
  revalidatePath(`/w/${wsId}/connections`);
}

export async function reconnect(wsId: string, connId: string) {
  const { user, ws, db } = await ctx(wsId, 4);
  await db.from("connections").update({ status: "ok", error: null }).eq("id", connId).eq("workspace_id", ws.id);
  await audit({ orgId: ws.org_id, workspaceId: ws.id, actorId: user.id, action: "connection.enable", entity: "connection", entityId: connId });
  revalidatePath(`/w/${wsId}/connections`);
}

export async function saveDestinations(wsId: string, connId: string, fd: FormData) {
  const { user, ws, db } = await ctx(wsId, 4);
  const { data: conn } = await db.from("connections").select("provider").eq("id", connId).eq("workspace_id", ws.id).maybeSingle();
  if (!conn) go(wsId, "/connections", { error: "Connection not found" });
  const platform = conn!.provider === "google_ads" ? "google" : "microsoft";
  for (const r of RUNGS) {
    const val = String(fd.get(`dest:${r}`) ?? "").trim();
    const role = String(fd.get(`role:${r}`) ?? "secondary");
    if (!val) {
      await db.from("conversion_destinations").delete().eq("connection_id", connId).eq("canonical_stage", r);
      continue;
    }
    await db.from("conversion_destinations").upsert(
      { workspace_id: ws.id, connection_id: connId, platform, canonical_stage: r, conversion_action_id: platform === "google" ? val : null, goal_name: platform === "microsoft" ? val : null, role: role === "primary" ? "primary" : "secondary" },
      { onConflict: "connection_id,canonical_stage" },
    );
  }
  await audit({ orgId: ws.org_id, workspaceId: ws.id, actorId: user.id, action: "destinations.save", entity: "connection", entityId: connId });
  revalidatePath(`/w/${wsId}/connections`);
  go(wsId, "/connections", { saved: "Conversion destinations saved." });
}

export async function runGhlInstall(wsId: string, connId: string) {
  const { user, ws, db } = await ctx(wsId, 4);
  const { data: conn } = await db.from("connections").select("*").eq("id", connId).eq("workspace_id", ws.id).maybeSingle<Connection>();
  if (!conn) go(wsId, "/connections", { error: "Connection not found" });
  await installGhl(conn!);
  await audit({ orgId: ws.org_id, workspaceId: ws.id, actorId: user.id, action: "ghl.install_fields", entity: "connection", entityId: connId });
  go(wsId, "/health", { saved: "Custom-field setup ran. See CRM operations below." });
}

// ---------------------------------------------------------------- Sites, API keys, webhook secret
export async function addSite(wsId: string, fd: FormData) {
  const { user, ws, db } = await ctx(wsId, 3);
  const domain = String(fd.get("domain") ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) go(wsId, "/sites", { error: "Enter a valid domain, e.g. example.com" });
  const origins = String(fd.get("origins") ?? "").split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
  const { error } = await db.from("sites").insert({ workspace_id: ws.id, domain, site_key: newSiteKey(), allowed_origins: origins.length ? origins : [`https://${domain}`, `https://www.${domain.replace(/^www\./, "")}`] });
  if (error) go(wsId, "/sites", { error: error.message });
  await audit({ orgId: ws.org_id, workspaceId: ws.id, actorId: user.id, action: "site.add", entity: "site", diff: { domain } });
  revalidatePath(`/w/${wsId}/sites`);
  go(wsId, "/sites", { saved: "Site added. Install the tag below." });
}

export async function updateOrigins(wsId: string, siteId: string, fd: FormData) {
  const { user, ws, db } = await ctx(wsId, 3);
  const origins = String(fd.get("origins") ?? "").split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
  await db.from("sites").update({ allowed_origins: origins }).eq("id", siteId).eq("workspace_id", ws.id);
  await audit({ orgId: ws.org_id, workspaceId: ws.id, actorId: user.id, action: "site.origins", entity: "site", entityId: siteId, diff: { origins } });
  revalidatePath(`/w/${wsId}/sites`);
}

export async function checkSiteInstall(wsId: string, siteId: string) {
  const { ws, db } = await ctx(wsId, 3);
  const { data: site } = await db.from("sites").select("id,domain,site_key").eq("id", siteId).eq("workspace_id", ws.id).maybeSingle();
  if (!site) return go(wsId, "/sites", { error: "Site not found" });
  const { checkInstall } = await import("@/server/install-check");
  const result = await checkInstall(site.domain, site.site_key);
  await db.from("sites").update({ last_check: result }).eq("id", site.id);
  revalidatePath(`/w/${wsId}/sites`);
  go(wsId, "/sites", { site: site.id });
}

export type SecretState = { secret?: string; error?: string } | null;

export async function createApiKey(wsId: string, _prev: SecretState, fd: FormData): Promise<SecretState> {
  const { user, ws, db } = await ctx(wsId, 4);
  const prefix = randomToken(8).toLowerCase().replace(/[^a-z0-9]/g, "").padEnd(8, "0").slice(0, 8);
  const key = `ose_${prefix}_${randomToken(32)}`;
  const scopes = ["ingest", "read"].filter((s) => fd.get(`scope:${s}`));
  const { error } = await db.from("api_keys").insert({ workspace_id: ws.id, name: String(fd.get("name") ?? "API key").slice(0, 60), prefix, hashed_key: sha256(key), scopes: scopes.length ? scopes : ["ingest"], created_by: user.id });
  if (error) return { error: error.message };
  await audit({ orgId: ws.org_id, workspaceId: ws.id, actorId: user.id, action: "api_key.create", entity: "api_key", entityId: prefix });
  revalidatePath(`/w/${wsId}/sites`);
  return { secret: key };
}

export async function revokeApiKey(wsId: string, keyId: string) {
  const { user, ws, db } = await ctx(wsId, 4);
  await db.from("api_keys").update({ revoked_at: new Date().toISOString() }).eq("id", keyId).eq("workspace_id", ws.id);
  await audit({ orgId: ws.org_id, workspaceId: ws.id, actorId: user.id, action: "api_key.revoke", entity: "api_key", entityId: keyId });
  revalidatePath(`/w/${wsId}/sites`);
}

export async function rotateWebhookSecret(wsId: string, _prev: SecretState): Promise<SecretState> {
  void _prev;
  const { user, ws, db } = await ctx(wsId, 4);
  const secret = `whsec_${randomToken(32)}`;
  await db.from("workspaces").update({ webhook_secret_enc: encrypt(secret) }).eq("id", ws.id);
  await audit({ orgId: ws.org_id, workspaceId: ws.id, actorId: user.id, action: "webhook_secret.rotate", entity: "workspace", entityId: ws.id });
  return { secret };
}

// ---------------------------------------------------------------- Simulator + manual stage moves
export async function simulateLead(wsId: string, fd: FormData) {
  const { user, ws, db } = await ctx(wsId, 3);
  const scoring = await publishedScoring(ws.id);
  const answers: Record<string, string> = {};
  for (const f of scoring?.model.fields ?? []) {
    const v = String(fd.get(`a:${f.key}`) ?? "").trim();
    if (v) answers[f.key] = v;
  }
  const platform = String(fd.get("platform") ?? "google");
  const age = Math.max(0, Number(fd.get("click_age_days") ?? 0));
  const clickTs = new Date(Date.now() - age * 86_400_000).toISOString();
  const rid = randomToken(9);
  const { data: site } = await db.from("sites").select("id").eq("workspace_id", ws.id).limit(1).maybeSingle();
  const r = await intakeLead({
    workspaceId: ws.id,
    siteId: site?.id ?? null,
    source: "simulator",
    form: "simulator",
    email: String(fd.get("email") ?? "") || `sim+${rid.slice(0, 6).toLowerCase()}@example.test`,
    phone: String(fd.get("phone") ?? "") || null,
    name: "Simulated Lead",
    answers,
    attribution: {
      ...(platform === "google" || platform === "both" ? { gclid: `SIM-G-${rid}` } : {}),
      ...(platform === "microsoft" || platform === "both" ? { msclkid: `SIM-M-${rid}` } : {}),
      utm_source: platform === "none" ? "organic" : platform === "microsoft" ? "bing" : "google",
      utm_medium: platform === "none" ? "organic" : "cpc",
      utm_campaign: String(fd.get("campaign") ?? "") || "Simulated campaign",
      click_ts: platform === "none" ? undefined : clickTs,
    },
    consent: { ad_user_data: "granted", ad_personalization: "granted" },
    test: true,
  });
  await audit({ orgId: ws.org_id, workspaceId: ws.id, actorId: user.id, action: "simulator.lead", entity: "lead", entityId: r.lead_id });
  redirect(`/w/${wsId}/leads/${r.lead_id}?saved=${encodeURIComponent(`Simulated lead scored ${r.score ?? "—"} (${r.lead_type ?? "no type"}).`)}`);
}

export async function moveStage(wsId: string, leadId: string, fd: FormData) {
  const { user, ws } = await ctx(wsId, 3);
  const stage = String(fd.get("stage") ?? "");
  const actual = fd.get("actual_value") ? Number(fd.get("actual_value")) : null;
  const daysLater = Number(fd.get("days_later") ?? 0);
  try {
    await recordStage({
      workspaceId: ws.id,
      leadId,
      stage,
      source: "manual",
      actualValue: actual,
      lostReason: stage === "lost" ? String(fd.get("lost_reason") ?? "manual") : null,
      occurredAt: daysLater > 0 ? new Date(Date.now() + daysLater * 86_400_000).toISOString() : null,
    });
  } catch (e) {
    redirect(`/w/${wsId}/leads/${leadId}?error=${encodeURIComponent(e instanceof Error ? e.message : "Failed")}`);
  }
  await audit({ orgId: ws.org_id, workspaceId: ws.id, actorId: user.id, action: "lead.stage", entity: "lead", entityId: leadId, diff: { stage, actual } });
  revalidatePath(`/w/${wsId}/leads/${leadId}`);
  redirect(`/w/${wsId}/leads/${leadId}?saved=${encodeURIComponent(`Moved to ${stage}.`)}`);
}

/** Simulate time passing for a test lead (demo of the 90-day window guard). Only test leads. */
export async function ageTestLead(wsId: string, leadId: string, fd: FormData) {
  const { ws, db } = await ctx(wsId, 3);
  const days = Math.max(1, Math.min(365, Number(fd.get("days") ?? 30)));
  const { data: lead } = await db.from("leads").select("click_ts,is_test,attribution").eq("id", leadId).eq("workspace_id", ws.id).maybeSingle();
  if (!lead?.is_test || !lead.click_ts) redirect(`/w/${wsId}/leads/${leadId}?error=Only%20simulated%20leads%20with%20a%20click%20can%20be%20aged`);
  const ts = new Date(new Date(lead!.click_ts).getTime() - days * 86_400_000);
  const expires = new Date(ts.getTime() + 90 * 86_400_000).toISOString().slice(0, 10);
  await db.from("leads").update({ click_ts: ts.toISOString(), window_expires_on: expires, attribution: { ...(lead!.attribution as object), click_ts: ts.toISOString() } }).eq("id", leadId);
  revalidatePath(`/w/${wsId}/leads/${leadId}`);
  redirect(`/w/${wsId}/leads/${leadId}?saved=${encodeURIComponent(`Click moved ${days} days into the past.`)}`);
}

export async function resetTestData(wsId: string) {
  const { user, ws, db } = await ctx(wsId, 4);
  await db.from("leads").delete().eq("workspace_id", ws.id).eq("is_test", true);
  await audit({ orgId: ws.org_id, workspaceId: ws.id, actorId: user.id, action: "simulator.reset", entity: "workspace", entityId: ws.id });
  revalidatePath(`/w/${wsId}`);
  go(wsId, "/simulator", { saved: "Simulated leads removed." });
}

// ---------------------------------------------------------------- Signals + health
export async function resend(wsId: string, jobId: string) {
  const { user, ws } = await ctx(wsId, 3);
  await resendJob(ws.id, jobId);
  await deliverPending(ws.id);
  await audit({ orgId: ws.org_id, workspaceId: ws.id, actorId: user.id, action: "signal.resend", entity: "signal_job", entityId: jobId });
  revalidatePath(`/w/${wsId}/signals`);
}

export async function deliverNow(wsId: string) {
  const { ws } = await ctx(wsId, 3);
  const r = await deliverPending(ws.id);
  revalidatePath(`/w/${wsId}/signals`);
  go(wsId, "/signals", { saved: `Processed ${r.claimed} pending signal(s).` });
}

export async function setAlertStatus(wsId: string, alertId: string, status: "acknowledged" | "resolved") {
  const { user, ws, db } = await ctx(wsId, 2);
  await db.from("alerts").update({ status, resolved_at: status === "resolved" ? new Date().toISOString() : null }).eq("id", alertId).eq("workspace_id", ws.id);
  await audit({ orgId: ws.org_id, workspaceId: ws.id, actorId: user.id, action: `alert.${status}`, entity: "alert", entityId: alertId });
  revalidatePath(`/w/${wsId}/health`);
}

export async function addAutomation(wsId: string, fd: FormData) {
  const { user, ws, db } = await ctx(wsId, 3);
  const row = Object.fromEntries(["name", "system", "owner", "trigger", "updates", "on_failure", "access"].map((k) => [k, String(fd.get(k) ?? "").trim() || null]));
  if (!row.name || !row.system) go(wsId, "/health", { error: "Name and system are required." });
  await db.from("automations").insert({ ...row, workspace_id: ws.id });
  await audit({ orgId: ws.org_id, workspaceId: ws.id, actorId: user.id, action: "automation.add", entity: "automation", diff: row });
  revalidatePath(`/w/${wsId}/health`);
  go(wsId, "/health", { saved: "Automation registered." });
}

export async function removeAutomation(wsId: string, id: string) {
  const { user, ws, db } = await ctx(wsId, 3);
  await db.from("automations").delete().eq("id", id).eq("workspace_id", ws.id);
  await audit({ orgId: ws.org_id, workspaceId: ws.id, actorId: user.id, action: "automation.remove", entity: "automation", entityId: id });
  revalidatePath(`/w/${wsId}/health`);
}

// ---------------------------------------------------------------- Settings
export async function saveSettings(wsId: string, fd: FormData) {
  const { user, ws, db } = await ctx(wsId, 4);
  const retention = Math.max(1, Math.min(365, Number(fd.get("piiRetentionDays") ?? 30)));
  const slack = String(fd.get("slackWebhookUrl") ?? "").trim();
  const settings = {
    ...ws.settings,
    storeRawPii: Boolean(fd.get("storeRawPii")),
    piiRetentionDays: retention,
    phoneCountryCode: String(fd.get("phoneCountryCode") ?? "1").replace(/\D/g, "") || "1",
    slackWebhookUrl: /^https:\/\/hooks\.slack\.com\//.test(slack) ? slack : undefined,
    reportRecipients: String(fd.get("reportRecipients") ?? "").split(/[\s,;]+/).filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)).slice(0, 20).join(", "),
  };
  const patch = { name: String(fd.get("name") ?? ws.name).trim() || ws.name, timezone: String(fd.get("timezone") ?? ws.timezone), currency: String(fd.get("currency") ?? ws.currency).toUpperCase().slice(0, 3), settings };
  const { error } = await db.from("workspaces").update(patch).eq("id", ws.id);
  if (error) go(wsId, "/settings", { error: error.message });
  await audit({ orgId: ws.org_id, workspaceId: ws.id, actorId: user.id, action: "workspace.settings", entity: "workspace", entityId: ws.id, diff: { ...patch, settings: { ...settings, slackWebhookUrl: settings.slackWebhookUrl ? "[set]" : undefined } } });
  revalidatePath(`/w/${wsId}`);
  go(wsId, "/settings", { saved: "Settings saved." });
}
