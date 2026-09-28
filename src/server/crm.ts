import "server-only";
import { admin } from "@/lib/supabase/admin";
import { decrypt } from "@/lib/crypto";
import { effectiveMode } from "@/lib/env";
import { customFieldsPayload, ghl, ghlCalls, OSE_FIELDS, type GhlCall } from "@/connectors/ghl/client";
import type { Connection } from "@/connectors/types";

async function ghlConnection(workspaceId: string): Promise<Connection | null> {
  const { data } = await admin()
    .from("connections")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("provider", "ghl")
    .neq("status", "disconnected")
    .limit(1)
    .maybeSingle<Connection>();
  return data ?? null;
}

async function logOp(workspaceId: string, leadId: string | null, op: string, mode: string, status: string, request: GhlCall | unknown, response?: unknown, error?: string) {
  await admin().from("crm_ops").insert({ workspace_id: workspaceId, lead_id: leadId, provider: "ghl", op, mode, status, request, response: response ?? null, error: error ?? null });
}

/** Redact raw PII from a logged request (hashes and scores only). */
function redact(call: GhlCall): GhlCall {
  if (!call.body || typeof call.body !== "object") return call;
  const b = { ...(call.body as Record<string, unknown>) };
  for (const k of ["email", "phone", "firstName", "lastName", "name"]) if (b[k]) b[k] = "[redacted]";
  return { ...call, body: b };
}

/** On install: create OSE custom fields and remember their ids (LCM-01/05). */
export async function installGhl(conn: Connection) {
  const mode = effectiveMode(conn.mode);
  const fieldIds: Record<string, string> = { ...((conn.settings.fieldIds as Record<string, string>) ?? {}) };
  for (const f of OSE_FIELDS) {
    if (fieldIds[f.key]) continue;
    const call = ghlCalls.createCustomField(conn.external_account ?? "LOCATION", f);
    try {
      const res = await ghl<{ customField?: { id: string } }>(conn, call, mode);
      if (res.data?.customField?.id) fieldIds[f.key] = res.data.customField.id;
      await logOp(conn.workspace_id, null, "create_fields", mode, mode === "live" ? "ok" : "dry_run", call, res.data);
    } catch (e) {
      await logOp(conn.workspace_id, null, "create_fields", mode, "failed", call, null, String(e));
    }
  }
  await admin().from("connections").update({ settings: { ...conn.settings, fieldIds } }).eq("id", conn.id);
}

/** Spec §12 step 3: upsert the CRM contact with attribution + score fields, and link it to the lead. */
export async function syncLeadToCrm(workspaceId: string, leadId: string) {
  const conn = await ghlConnection(workspaceId);
  if (!conn) return;
  const db = admin();
  const { data: lead } = await db.from("leads").select("*").eq("id", leadId).eq("workspace_id", workspaceId).maybeSingle();
  if (!lead) return;
  const { data: pii } = await db.from("lead_pii").select("enc_email,enc_phone,enc_name").eq("lead_id", leadId).maybeSingle();
  const email = pii?.enc_email ? decrypt(pii.enc_email) : undefined;
  const phone = pii?.enc_phone ? decrypt(pii.enc_phone) : undefined;
  const name = pii?.enc_name ? decrypt(pii.enc_name) : undefined;
  if (!email && !phone) {
    await logOp(workspaceId, leadId, "upsert_contact", conn.mode, "skipped", null, null, "No email/phone stored (raw PII disabled or not provided); waiting for the CRM's own contact webhook to link.");
    return;
  }
  const a = (lead.attribution ?? {}) as Record<string, string>;
  const [firstName, ...rest] = (name ?? "").split(" ");
  const call = ghlCalls.upsertContact(conn.external_account ?? "LOCATION", {
    email,
    phone,
    firstName: firstName || undefined,
    lastName: rest.join(" ") || undefined,
    source: a.utm_source ?? "Signal Engine",
    tags: ["ose", lead.lead_type ? `ose:${String(lead.lead_type).toLowerCase().replace(/\W+/g, "-")}` : "ose"],
    customFields: customFieldsPayload(conn, {
      ose_lead_id: leadId,
      leadvalue_initial: lead.score,
      leadvalue_current: lead.value_current,
      lead_type: lead.lead_type,
      score_version: lead.score_version,
      window_expires_on: lead.window_expires_on,
    }),
  });
  const mode = effectiveMode(conn.mode);
  try {
    const res = await ghl<{ contact?: { id: string } }>(conn, call, mode);
    const contactId = res.data?.contact?.id ?? (mode === "live" ? null : `dryrun-${leadId.slice(0, 8)}`);
    if (contactId) {
      await db.from("crm_links").upsert({ workspace_id: workspaceId, lead_id: leadId, provider: "ghl", contact_id: contactId }, { onConflict: "workspace_id,provider,contact_id", ignoreDuplicates: true });
    }
    await logOp(workspaceId, leadId, "upsert_contact", mode, mode === "live" ? "ok" : "dry_run", redact(call), res.data);
  } catch (e) {
    await logOp(workspaceId, leadId, "upsert_contact", mode, "failed", redact(call), null, String(e));
    throw e;
  }
}

/** Spec §12 step 7: write value, type, sync status and window date back to the CRM contact (LCM-05). */
export async function writeBack(workspaceId: string, leadId: string) {
  const conn = await ghlConnection(workspaceId);
  if (!conn) return;
  const db = admin();
  const { data: link } = await db.from("crm_links").select("contact_id").eq("lead_id", leadId).eq("provider", "ghl").limit(1).maybeSingle();
  if (!link?.contact_id) return;
  const { data: lead } = await db.from("leads").select("value_current,lead_type,window_expires_on").eq("id", leadId).maybeSingle();
  const { data: jobs } = await db.from("signal_jobs").select("platform,canonical_stage,status").eq("lead_id", leadId).order("created_at");
  const status = (jobs ?? []).map((j) => `${j.platform}:${j.canonical_stage}=${j.status}`).join("; ").slice(0, 1000);
  const call = ghlCalls.updateContact(link.contact_id, {
    customFields: customFieldsPayload(conn, { leadvalue_current: lead?.value_current ?? null, lead_type: lead?.lead_type ?? null, ose_sync_status: status, window_expires_on: lead?.window_expires_on ?? null }),
  });
  const mode = effectiveMode(conn.mode);
  try {
    const res = await ghl(conn, call, mode);
    await logOp(workspaceId, leadId, "write_back", mode, mode === "live" ? "ok" : "dry_run", call, res.data);
  } catch (e) {
    await logOp(workspaceId, leadId, "write_back", mode, "failed", call, null, String(e));
  }
}
