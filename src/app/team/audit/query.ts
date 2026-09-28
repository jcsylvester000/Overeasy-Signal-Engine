import "server-only";
import { admin } from "@/lib/supabase/admin";
import { scopeWorkspaces, type TeamCtx } from "@/server/team";

export type AuditFilters = { from?: string; to?: string; action?: string; actor?: string; ws?: string; q?: string };
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Builds the scoped + filtered audit query (shared with the CSV export). */
export async function auditQuery(ctx: TeamCtx, f: AuditFilters, withCount = true) {
  const [wss, memberRows] = await Promise.all([scopeWorkspaces(ctx, { includeArchived: true }), admin().from("team_members").select("user_id").eq("org_id", ctx.orgId)]);
  const wsIds = wss.map((w) => w.id);
  const actors = (memberRows.data ?? []).map((m) => m.user_id as string);
  const ors = [`org_id.in.(${ctx.orgIds.join(",")})`];
  if (wsIds.length) ors.push(`workspace_id.in.(${wsIds.join(",")})`);
  if (actors.length) ors.push(`actor_id.in.(${actors.join(",")})`);
  let q = admin().from("audit_log").select("*", withCount ? { count: "exact" } : undefined).or(ors.join(","));
  if (f.from && DATE.test(f.from)) q = q.gte("at", `${f.from}T00:00:00Z`);
  if (f.to && DATE.test(f.to)) q = q.lte("at", `${f.to}T23:59:59.999Z`);
  if (f.action) q = q.like("action", `${f.action.replace(/[%_]/g, "")}%`);
  if (f.actor && /^[0-9a-f-]{36}$/i.test(f.actor)) q = q.eq("actor_id", f.actor);
  if (f.ws && /^[0-9a-f-]{36}$/i.test(f.ws)) q = q.eq("workspace_id", f.ws);
  if (f.q) q = q.ilike("action", `%${f.q.replace(/[%_,()]/g, " ").slice(0, 60)}%`);
  return { q: q.order("at", { ascending: false }), wss };
}

