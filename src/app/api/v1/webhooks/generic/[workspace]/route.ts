import { admin } from "@/lib/supabase/admin";
import { json, notConfigured, problem, rateLimited } from "@/lib/api/http";
import { decrypt, sha256, verifySignedBody } from "@/lib/crypto";
import { dispatch } from "@/server/dispatch";

export const dynamic = "force-dynamic";

/**
 * POST /v1/webhooks/generic/{workspaceId} — any CRM or call tracker. HMAC-signed with the workspace secret:
 * X-OSE-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, "t.body")>.
 * Body: { event_id, lead_id? | external_ref? | email? | phone? | contact_id?, stage? | (pipeline_id + stage_id), occurred_at?, actual_value?, lost_reason? }
 */
export async function POST(req: Request, ctx: { params: Promise<{ workspace: string }> }) {
  const nc = notConfigured();
  if (nc) return nc;
  const { workspace } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(workspace)) return problem(404, "Not found");
  if (rateLimited(`generic:${workspace}`, 1200)) return problem(429, "Too many requests");
  const raw = await req.text();
  if (raw.length > 64_000) return problem(413, "Too large");

  const db = admin();
  const { data: ws } = await db.from("workspaces").select("id,webhook_secret_enc").eq("id", workspace).maybeSingle();
  if (!ws?.webhook_secret_enc) return problem(404, "Not found");
  if (!verifySignedBody(req.headers.get("x-ose-signature"), raw, decrypt(ws.webhook_secret_enc as string))) return problem(401, "Invalid signature");

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(raw);
  } catch {
    return problem(400, "Invalid JSON");
  }
  const eventId = String(payload.event_id ?? sha256(raw));
  const { data, error } = await db
    .from("webhook_inbox")
    .upsert({ workspace_id: workspace, provider: "generic", webhook_id: `${workspace}:${eventId}`, event_type: String(payload.stage ?? payload.stage_id ?? ""), signature_ok: true, payload: { ...payload, event_id: eventId } }, { onConflict: "provider,webhook_id", ignoreDuplicates: true })
    .select("id")
    .maybeSingle();
  if (error) return problem(500, "Store failed");
  if (data?.id) await dispatch("ose/webhook.received", { inboxId: data.id as string });
  return json({ ok: true, duplicate: !data }, 202);
}
