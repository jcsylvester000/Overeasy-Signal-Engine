import { z } from "zod";
import { authApiKey, json, notConfigured, problem } from "@/lib/api/http";
import { CANONICAL_STAGES } from "@/core/stages";
import { recordStage } from "@/server/lifecycle";

export const dynamic = "force-dynamic";

const Body = z.object({
  stage: z.enum(CANONICAL_STAGES as [string, ...string[]]),
  occurred_at: z.string().datetime({ offset: true }).optional(),
  actual_value: z.number().nonnegative().optional(),
  lost_reason: z.string().max(200).optional(),
});

/** POST /v1/leads/{id}/stage — generic CRM stage change (LCM-06): any CRM can drive stages with one HTTP call. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const nc = notConfigured();
  if (nc) return nc;
  const raw = await req.text();
  const auth = await authApiKey(req, raw, "ingest");
  if (auth instanceof Response) return auth;
  const { id } = await ctx.params;
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return problem(400, "Invalid JSON");
  }
  const parsed = Body.safeParse(body);
  if (!parsed.success) return json({ error: "Validation failed", issues: parsed.error.issues }, 422);
  try {
    const r = await recordStage({
      workspaceId: auth.workspaceId,
      leadId: id,
      stage: parsed.data.stage,
      source: "api",
      occurredAt: parsed.data.occurred_at,
      actualValue: parsed.data.actual_value,
      lostReason: parsed.data.lost_reason,
    });
    return json({ lead_id: id, canonical_stage: r.stage }, 202);
  } catch (e) {
    return problem(404, e instanceof Error ? e.message : "Not found");
  }
}
