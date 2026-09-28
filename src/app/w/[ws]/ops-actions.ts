"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { admin } from "@/lib/supabase/admin";
import { audit } from "@/lib/audit";
import { requireUser, requireWorkspace } from "@/lib/tenancy";
import { applyProposal } from "@/core/calibration";
import { validateLadder } from "@/core/value/engine";
import { calibrationFor, createConversionActions, dsarDelete, dsarExport } from "@/server/ops";
import { importSpendCsv, syncSpend } from "@/server/spend";
import { weeklyReports } from "@/server/notify";
import { publishedScoring } from "@/server/models";

async function ctx(wsId: string, minRank: number) {
  const user = await requireUser();
  const access = await requireWorkspace(wsId, minRank);
  return { user, ...access, db: admin() };
}
const go = (wsId: string, path: string, q: Record<string, string>) => redirect(`/w/${wsId}${path}?${new URLSearchParams(q)}`);

// ---------------------------------------------------------------- Spend
export async function uploadSpend(wsId: string, fd: FormData) {
  const { user, ws } = await ctx(wsId, 3);
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) go(wsId, "/spend", { error: "Choose a CSV file." });
  if ((file as File).size > 5_000_000) go(wsId, "/spend", { error: "File is larger than 5 MB." });
  let r: { imported: number; skipped: number } = { imported: 0, skipped: 0 };
  try {
    r = await importSpendCsv(ws.id, await (file as File).text());
  } catch (e) {
    go(wsId, "/spend", { error: e instanceof Error ? e.message : "Import failed" });
  }
  await audit({ orgId: ws.org_id, workspaceId: ws.id, actorId: user.id, action: "spend.import", entity: "ad_spend_daily", diff: r });
  revalidatePath(`/w/${wsId}`);
  go(wsId, "/spend", { saved: `Imported ${r.imported} row(s)${r.skipped ? `, skipped ${r.skipped} invalid row(s)` : ""}.` });
}

export async function syncSpendNow(wsId: string) {
  const { ws } = await ctx(wsId, 3);
  const r = await syncSpend(ws.id, 30);
  const rows = r.reduce((a, x) => a + x.rows, 0);
  const note = r.some((x) => x.skipped) ? " Dry-run connections are skipped." : "";
  go(wsId, "/spend", { saved: `Synced ${rows} row(s) from ${r.length} connection(s).${note}` });
}

// ---------------------------------------------------------------- Calibration
export async function applyCalibration(wsId: string) {
  const { user, ws, db } = await ctx(wsId, 3);
  const c = await calibrationFor(ws.id);
  if (!c) go(wsId, "/calibration", { error: "No value model." });
  const next = applyProposal(c!.value.model, c!.proposal);
  const scoring = await publishedScoring(ws.id);
  const v = validateLadder(next, scoring?.model.clamp.max ?? 0);
  if (!v.ok) go(wsId, "/calibration", { error: v.issues.map((i) => i.message).join(" · ") });
  const { data: last } = await db.from("value_models").select("version").eq("workspace_id", ws.id).order("version", { ascending: false }).limit(1).maybeSingle();
  const version = (last?.version ?? 0) + 1;
  await db.from("value_models").update({ status: "archived" }).eq("workspace_id", ws.id).eq("status", "published");
  await db.from("value_models").insert({ workspace_id: ws.id, version, status: "published", model: v.model, notes: `Calibration from ${c!.proposal.sample} matured leads (human-approved)`, published_by: user.id, published_at: new Date().toISOString() });
  await audit({ orgId: ws.org_id, workspaceId: ws.id, actorId: user.id, action: "value.calibrate", entity: "value_model", entityId: String(version), diff: c!.proposal });
  revalidatePath(`/w/${wsId}/value`);
  go(wsId, "/calibration", { saved: `Calibrated values published as v${version}.` });
}

// ---------------------------------------------------------------- Readiness acknowledgements
export async function setAck(wsId: string, key: "privacy" | "sales", fd: FormData) {
  const { user, ws, db } = await ctx(wsId, 4);
  const settings = { ...ws.settings, acks: { ...((ws.settings as { acks?: Record<string, boolean> }).acks ?? {}), [key]: Boolean(fd.get("value")) } };
  await db.from("workspaces").update({ settings }).eq("id", ws.id);
  await audit({ orgId: ws.org_id, workspaceId: ws.id, actorId: user.id, action: `readiness.ack.${key}`, entity: "workspace", diff: { value: Boolean(fd.get("value")) } });
  revalidatePath(`/w/${wsId}/readiness`);
}

// ---------------------------------------------------------------- Conversion actions
export async function createActions(wsId: string, connId: string, fd: FormData) {
  const { user, ws } = await ctx(wsId, 4);
  const prefix = String(fd.get("prefix") ?? "").trim() || ws.name;
  try {
    const r = await createConversionActions(ws.id, connId, prefix.slice(0, 60));
    await audit({ orgId: ws.org_id, workspaceId: ws.id, actorId: user.id, action: "destinations.create", entity: "connection", entityId: connId, diff: { mode: r.mode, created: r.created } });
    go(wsId, "/connections", { saved: r.mode === "test" ? `Validated ${r.created} conversion action(s) (test mode: nothing created).` : `${r.created} stage conversion action(s) ${r.mode === "dry_run" ? "prepared (dry run)" : "created as secondary"}.` });
  } catch (e) {
    if (e && typeof e === "object" && "digest" in e) throw e; // let redirect() through
    go(wsId, "/connections", { error: e instanceof Error ? e.message : "Create failed" });
  }
}

// ---------------------------------------------------------------- Privacy: DSAR + policy
export type DsarState = { json?: string; message?: string; error?: string } | null;

export async function runDsar(wsId: string, _prev: DsarState, fd: FormData): Promise<DsarState> {
  const { user, ws } = await ctx(wsId, 4);
  const identifier = String(fd.get("identifier") ?? "");
  const kind = String(fd.get("kind") ?? "access");
  try {
    if (kind === "delete") {
      if (String(fd.get("confirm") ?? "") !== "DELETE") return { error: 'Type DELETE to confirm.' };
      const r = await dsarDelete(ws.id, identifier, user.id);
      await audit({ orgId: ws.org_id, workspaceId: ws.id, actorId: user.id, action: "dsar.delete", entity: "dsar", diff: { deleted: r.deleted, retract: r.retract.length } });
      return { message: `Deleted ${r.deleted} lead record(s) and their visits, events, uploads and CRM log. ${r.retract.length ? `${r.retract.length} upload(s) listed in the request log need retraction on the ad platforms.` : ""}` };
    }
    const r = await dsarExport(ws.id, identifier);
    await audit({ orgId: ws.org_id, workspaceId: ws.id, actorId: user.id, action: "dsar.access", entity: "dsar", diff: { matched: r.leads.length } });
    return { json: JSON.stringify(r, null, 2), message: `${r.leads.length} lead record(s) found.` };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Request failed" };
  }
}

export async function savePrivacy(wsId: string, fd: FormData) {
  const { user, ws, db } = await ctx(wsId, 4);
  const settings = {
    ...ws.settings,
    regulatedVertical: Boolean(fd.get("regulatedVertical")),
    optOutPolicy: fd.get("optOutPolicy") === "click_id_only" ? "click_id_only" : "skip_upload",
  };
  await db.from("workspaces").update({ settings }).eq("id", ws.id);
  await audit({ orgId: ws.org_id, workspaceId: ws.id, actorId: user.id, action: "privacy.policy", entity: "workspace", diff: { regulatedVertical: settings.regulatedVertical, optOutPolicy: settings.optOutPolicy, reason: String(fd.get("reason") ?? "") } });
  revalidatePath(`/w/${wsId}/privacy`);
  go(wsId, "/privacy", { saved: "Privacy policy saved." });
}

// ---------------------------------------------------------------- Reports
export async function sendTestReport(wsId: string) {
  const { ws } = await ctx(wsId, 4);
  const [r] = await weeklyReports(ws.id);
  go(wsId, "/settings", r ? (r.sent ? { saved: "Weekly summary sent." } : { error: `Not sent: ${r.reason}` }) : { error: "Add report recipients first." });
}
