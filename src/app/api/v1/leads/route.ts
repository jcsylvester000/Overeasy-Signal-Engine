import { z } from "zod";
import { admin } from "@/lib/supabase/admin";
import { authApiKey, json, notConfigured, problem, rateLimited } from "@/lib/api/http";
import { IntakeBody, intakeLead } from "@/server/intake";

export const dynamic = "force-dynamic";

/**
 * POST /v1/leads — server-side lead ingest (CAP-06), e.g. from a site's own form handler.
 * Headers: Authorization: Bearer <key>, X-OSE-Signature, Idempotency-Key (recommended).
 * Body: { site_key?, form, visitor_id?, email?, phone?, name?, geo?, answers, attribution?, consent? }
 */
export async function POST(req: Request) {
  const nc = notConfigured();
  if (nc) return nc;
  const raw = await req.text();
  if (raw.length > 64_000) return problem(413, "Body too large");
  const auth = await authApiKey(req, raw, "ingest");
  if (auth instanceof Response) return auth;
  if (rateLimited(`ingest:${auth.keyId}`, 600)) return problem(429, "Rate limit exceeded", { "retry-after": "60" });

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return problem(400, "Invalid JSON");
  }
  const parsed = IntakeBody.extend({ site_key: z.string().max(100).optional() }).safeParse(body);
  if (!parsed.success) return json({ error: "Validation failed", issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) }, 422);

  const idemKey = req.headers.get("idempotency-key")?.slice(0, 200) ?? null;
  const db = admin();
  if (idemKey) {
    const { data: prior } = await db.from("idempotency_keys").select("response").eq("workspace_id", auth.workspaceId).eq("key", idemKey).maybeSingle();
    if (prior) return json(prior.response, 200, { "idempotent-replay": "true" });
  }

  let siteId: string | null = null;
  if (parsed.data.site_key) {
    const { data: site } = await db.from("sites").select("id").eq("site_key", parsed.data.site_key).eq("workspace_id", auth.workspaceId).maybeSingle();
    siteId = (site?.id as string) ?? null;
  }

  const { site_key, ...rest } = parsed.data;
  void site_key;
  const result = await intakeLead({ ...rest, workspaceId: auth.workspaceId, siteId, source: "api", idempotencyKey: idemKey });
  const response = { lead_id: result.lead_id, score: result.score, lead_type: result.lead_type, score_version: result.score_version };
  if (idemKey) await db.from("idempotency_keys").upsert({ workspace_id: auth.workspaceId, key: idemKey, response }, { onConflict: "workspace_id,key", ignoreDuplicates: true });
  return json(response, result.duplicate ? 200 : 201);
}
