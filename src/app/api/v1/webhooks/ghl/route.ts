import { admin } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { json, notConfigured, problem } from "@/lib/api/http";
import { verifyGhlSignature } from "@/connectors/ghl/verify";
import { sha256 } from "@/lib/crypto";
import { dispatch } from "@/server/dispatch";

export const dynamic = "force-dynamic";

/**
 * POST /v1/webhooks/ghl — HighLevel events. Verify Ed25519 signature → store in inbox (dedupe on webhookId)
 * → 200 fast (< 500 ms, to stay clear of GHL's circuit breaker) → process in a background job.
 */
export async function POST(req: Request) {
  const nc = notConfigured();
  if (nc) return nc;
  const raw = await req.text();
  const ok = verifyGhlSignature(raw, req.headers.get("x-ghl-signature"), env.ghlWebhookPublicKey());
  if (!ok) return problem(401, "Invalid signature");

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(raw);
  } catch {
    return problem(400, "Invalid JSON");
  }
  const webhookId = String(payload.webhookId ?? payload.id ?? sha256(raw));
  const { data, error } = await admin()
    .from("webhook_inbox")
    .upsert({ provider: "ghl", webhook_id: webhookId, event_type: String(payload.type ?? ""), signature_ok: true, payload }, { onConflict: "provider,webhook_id", ignoreDuplicates: true })
    .select("id")
    .maybeSingle();
  if (error) return problem(500, "Store failed"); // non-2xx → GHL retries
  if (data?.id) await dispatch("ose/webhook.received", { inboxId: data.id as string });
  return json({ ok: true, duplicate: !data });
}
