import { admin } from "@/lib/supabase/admin";
import { authApiKey, json, notConfigured, problem } from "@/lib/api/http";

export const dynamic = "force-dynamic";

/** GET /v1/leads/{id} — lead status, value and uploads (read scope). No raw PII is ever returned. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const nc = notConfigured();
  if (nc) return nc;
  const auth = await authApiKey(req, null, "read");
  if (auth instanceof Response) return auth;
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return problem(404, "Not found");
  const db = admin();
  const { data: lead } = await db
    .from("leads")
    .select("id,created_at,form,score,score_version,lead_type,velocity_band,canonical_stage,lost_reason,value_current,currency,click_ts,window_expires_on,is_test")
    .eq("id", id)
    .eq("workspace_id", auth.workspaceId)
    .maybeSingle();
  if (!lead) return problem(404, "Not found");
  const [{ data: stages }, { data: signals }] = await Promise.all([
    db.from("stage_events").select("canonical_stage,occurred_at,source").eq("lead_id", id).order("occurred_at"),
    db.from("signal_jobs").select("platform,canonical_stage,mode,status,value_increment,cumulative_after,sent_at,error").eq("lead_id", id).order("created_at"),
  ]);
  return json({ ...lead, stages, signals });
}
