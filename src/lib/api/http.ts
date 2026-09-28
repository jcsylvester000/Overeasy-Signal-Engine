import "server-only";
import { NextResponse } from "next/server";
import { admin } from "@/lib/supabase/admin";
import { sha256, verifySignedBody } from "@/lib/crypto";
import { env } from "@/lib/env";

export function json(data: unknown, status = 200, headers?: Record<string, string>) {
  return NextResponse.json(data, { status, headers: { "cache-control": "no-store", ...headers } });
}

export function problem(status: number, message: string, headers?: Record<string, string>) {
  return json({ error: message }, status, headers);
}

export function notConfigured() {
  return env.isConfigured() && process.env.SUPABASE_SERVICE_ROLE_KEY ? null : problem(503, "Service not configured");
}

/** Fixed-window rate limiter per key (per server instance). Good enough for staging; move to Redis at scale. */
const windows = new Map<string, { n: number; reset: number }>();
export function rateLimited(key: string, limit: number, windowMs = 60_000): boolean {
  const now = Date.now();
  const w = windows.get(key);
  if (!w || w.reset < now) {
    windows.set(key, { n: 1, reset: now + windowMs });
    if (windows.size > 10_000) for (const [k, v] of windows) if (v.reset < now) windows.delete(k);
    return false;
  }
  w.n++;
  return w.n > limit;
}

export function clientIp(req: Request): string {
  return (req.headers.get("x-nf-client-connection-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0] ?? "0.0.0.0").trim();
}

export type ApiKeyAuth = { workspaceId: string; keyId: string; scopes: string[] };

/**
 * Server API auth: `Authorization: Bearer ose_<prefix>_<secret>`. For writes, the body must also be signed:
 * `X-OSE-Signature: t=<unix>,v1=<hex HMAC-SHA256(key, "t.body")>` (replay window 5 min).
 */
export async function authApiKey(req: Request, rawBody: string | null, scope: "ingest" | "read"): Promise<ApiKeyAuth | Response> {
  const auth = req.headers.get("authorization") ?? "";
  const key = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const m = /^ose_([a-z0-9]{8})_[A-Za-z0-9_-]{20,}$/.exec(key);
  if (!m) return problem(401, "Missing or malformed API key");
  const { data } = await admin().from("api_keys").select("id,workspace_id,hashed_key,scopes,revoked_at").eq("prefix", m[1]).maybeSingle();
  if (!data || data.revoked_at || data.hashed_key !== sha256(key)) return problem(401, "Invalid API key");
  if (!(data.scopes as string[]).includes(scope)) return problem(403, `API key lacks the "${scope}" scope`);
  if (rawBody !== null && !verifySignedBody(req.headers.get("x-ose-signature"), rawBody, key)) return problem(401, "Invalid or expired X-OSE-Signature");
  await admin().from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", data.id);
  return { workspaceId: data.workspace_id as string, keyId: data.id as string, scopes: data.scopes as string[] };
}
