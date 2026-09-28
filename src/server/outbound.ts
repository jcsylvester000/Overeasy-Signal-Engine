import "server-only";
import { randomUUID } from "node:crypto";
import { admin } from "@/lib/supabase/admin";
import { decrypt, hmacHex } from "@/lib/crypto";
import { dispatch } from "./dispatch";

/**
 * Outbound webhooks (spec §17): HMAC-signed events to customer endpoints.
 * Envelope { id, type, created_at, workspace_id, data }; headers X-OSE-Event, X-OSE-Delivery, X-OSE-Signature.
 */
export const OUTBOUND_EVENTS = ["lead.created", "lead.stage_changed", "signal.sent", "signal.failed", "alert.raised"] as const;
export type OutboundEvent = (typeof OUTBOUND_EVENTS)[number];
const MAX_ATTEMPTS = 6;

export async function emitEvent(workspaceId: string, type: OutboundEvent, data: Record<string, unknown>) {
  try {
    const db = admin();
    const { data: hooks } = await db.from("outbound_webhooks").select("id,events").eq("workspace_id", workspaceId).eq("active", true);
    const targets = (hooks ?? []).filter((h) => (h.events as string[]).includes(type));
    if (!targets.length) return;
    const envelope = { id: randomUUID(), type, created_at: new Date().toISOString(), workspace_id: workspaceId, data };
    await db.from("outbound_deliveries").insert(targets.map((h) => ({ webhook_id: h.id, workspace_id: workspaceId, event: type, payload: envelope })));
    await dispatch("ose/webhooks.deliver", { workspaceId });
  } catch (e) {
    console.error("[outbound] emit failed", type, e);
  }
}

export function signPayload(secret: string, body: string, t = Math.floor(Date.now() / 1000)) {
  return `t=${t},v1=${hmacHex(secret, `${t}.${body}`)}`;
}

export async function deliverOutbound(workspaceId?: string, limit = 200) {
  const db = admin();
  let q = db.from("outbound_deliveries").select("*").eq("status", "pending").or(`next_attempt_at.is.null,next_attempt_at.lte.${new Date().toISOString()}`).order("created_at").limit(limit);
  if (workspaceId) q = q.eq("workspace_id", workspaceId);
  const { data: due } = await q;
  let delivered = 0;
  for (const d of due ?? []) {
    const { data: hook } = await db.from("outbound_webhooks").select("*").eq("id", d.webhook_id).maybeSingle();
    if (!hook || !hook.active) {
      await db.from("outbound_deliveries").update({ status: "dead", error: "Endpoint removed or disabled" }).eq("id", d.id);
      continue;
    }
    const body = JSON.stringify(d.payload);
    let code = 0;
    let error: string | null = null;
    try {
      const res = await fetch(hook.url, {
        method: "POST",
        headers: { "content-type": "application/json", "user-agent": "SignalEngine-Webhooks/1.0", "x-ose-event": d.event, "x-ose-delivery": d.id, "x-ose-signature": signPayload(decrypt(hook.secret_enc), body) },
        body,
        signal: AbortSignal.timeout(10_000),
        redirect: "manual",
      });
      code = res.status;
      if (!res.ok) error = `HTTP ${res.status}`;
    } catch (e) {
      error = e instanceof Error ? e.message : "Request failed";
    }
    const attempts = d.attempts + 1;
    if (!error) {
      delivered++;
      await db.from("outbound_deliveries").update({ status: "delivered", attempts, response_code: code, delivered_at: new Date().toISOString(), error: null }).eq("id", d.id);
      await db.from("outbound_webhooks").update({ last_status: code, last_at: new Date().toISOString(), failures: 0 }).eq("id", hook.id);
    } else {
      const dead = attempts >= MAX_ATTEMPTS;
      await db
        .from("outbound_deliveries")
        .update({ status: dead ? "dead" : "pending", attempts, response_code: code || null, error, next_attempt_at: dead ? null : new Date(Date.now() + 60_000 * 2 ** attempts).toISOString() })
        .eq("id", d.id);
      await db.from("outbound_webhooks").update({ last_status: code || null, last_at: new Date().toISOString(), failures: (hook.failures ?? 0) + 1 }).eq("id", hook.id);
    }
  }
  return { attempted: (due ?? []).length, delivered };
}
