import "server-only";
import { admin } from "@/lib/supabase/admin";
import { raiseAlert } from "./alerts";

/** Hourly health sweep (HLT-01/03): tag missing, connections in error, leads near the upload window. */
export async function healthSweep() {
  const db = admin();
  const now = Date.now();

  const { data: sites } = await db.from("sites").select("id,workspace_id,domain,last_event_at,created_at,workspaces!inner(archived_at)").is("workspaces.archived_at", null);
  for (const s of sites ?? []) {
    const last = s.last_event_at ? new Date(s.last_event_at).getTime() : null;
    const age = now - (last ?? new Date(s.created_at).getTime());
    if (age > 24 * 3_600_000) {
      await raiseAlert(s.workspace_id, { type: "tag_missing", severity: "warning", title: `No tag events from ${s.domain} in 24 h`, detail: { siteId: s.id }, dedupeKey: `tag:${s.id}` });
    }
  }

  const { data: conns } = await db.from("connections").select("id,workspace_id,provider,status,error").in("status", ["error", "expired"]);
  for (const c of conns ?? []) {
    await raiseAlert(c.workspace_id, { type: "connection_expired", severity: "critical", title: `${c.provider} connection needs attention (${c.status})`, detail: { connectionId: c.id, error: c.error }, dedupeKey: `conn:${c.id}` });
  }

  // Leads whose click window closes within 10 days and have not reached contract yet.
  const soon = new Date(now + 10 * 86_400_000).toISOString().slice(0, 10);
  const today = new Date(now).toISOString().slice(0, 10);
  const { data: expiring } = await db
    .from("leads")
    .select("id,workspace_id,window_expires_on")
    .lte("window_expires_on", soon)
    .gte("window_expires_on", today)
    .in("canonical_stage", ["submitted", "qualified", "opportunity"])
    .eq("is_test", false)
    .limit(1000);
  const perWs = new Map<string, number>();
  for (const l of expiring ?? []) perWs.set(l.workspace_id, (perWs.get(l.workspace_id) ?? 0) + 1);
  for (const [ws, n] of perWs) {
    await raiseAlert(ws, { type: "window_expiry", severity: "warning", title: `${n} lead(s) reach the 90-day upload limit within 10 days`, dedupeKey: `window:${today}` });
  }
}

/** Daily: purge raw PII past its retention date; drop raw webhook payloads older than 30 days. */
export async function retentionSweep() {
  const db = admin();
  const { purgeArchived } = await import("./team");
  await purgeArchived(); // archived workspaces are removed for good after 30 days
  await db.from("lead_pii").delete().lt("purge_after", new Date().toISOString());
  await db.from("webhook_inbox").delete().lt("received_at", new Date(Date.now() - 30 * 86_400_000).toISOString());
  await db.from("idempotency_keys").delete().lt("created_at", new Date(Date.now() - 7 * 86_400_000).toISOString());
}
