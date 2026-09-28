import { admin } from "@/lib/supabase/admin";
import { json, notConfigured, problem, rateLimited } from "@/lib/api/http";
import { safeEqual, sha256 } from "@/lib/crypto";
import { dispatch } from "@/server/dispatch";

export const dynamic = "force-dynamic";

/**
 * POST /v1/webhooks/workflow/{workspaceId} — for CRM workflow tools that can send a fixed header but cannot sign
 * requests (e.g. the GoHighLevel workflow "Custom Webhook" action). Auth: header `X-OSE-Token: <workspace token>`
 * (a `token` query parameter is accepted as a fallback, but headers are preferred because URLs end up in logs).
 * Accepts GHL's workflow payload shape (contact + opportunity fields + customData) or flat JSON.
 */
export async function POST(req: Request, ctx: { params: Promise<{ workspace: string }> }) {
  const nc = notConfigured();
  if (nc) return nc;
  const { workspace } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(workspace)) return problem(404, "Not found");
  if (rateLimited(`workflow:${workspace}`, 1200)) return problem(429, "Too many requests");
  const token = req.headers.get("x-ose-token") ?? new URL(req.url).searchParams.get("token") ?? "";
  if (token.length < 20) return problem(401, "Missing token");

  const db = admin();
  const { data: ws } = await db.from("workspaces").select("id,inbound_token_hash").eq("id", workspace).maybeSingle();
  if (!ws?.inbound_token_hash || !safeEqual(ws.inbound_token_hash as string, sha256(token))) return problem(401, "Invalid token");

  const raw = await req.text();
  if (raw.length > 128_000) return problem(413, "Too large");
  let payload: Record<string, unknown>;
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    // Some tools post form-encoded bodies.
    payload = Object.fromEntries(new URLSearchParams(raw));
  }
  const { data, error } = await db
    .from("webhook_inbox")
    .upsert({ workspace_id: workspace, provider: "workflow", webhook_id: `${workspace}:${sha256(raw)}`, event_type: "workflow", signature_ok: true, payload }, { onConflict: "provider,webhook_id", ignoreDuplicates: true })
    .select("id")
    .maybeSingle();
  if (error) return problem(500, "Store failed");
  if (data?.id) await dispatch("ose/webhook.received", { inboxId: data.id as string });
  return json({ ok: true, duplicate: !data }, 202);
}
