import { requireTeam } from "@/server/team";
import { toCsv } from "@/core/csv";
import { auditQuery } from "../query";

/** CSV of the filtered audit log (max 10,000 rows). Admins and super-admins only. */
export async function GET(req: Request) {
  const ctx = await requireTeam(2);
  const u = new URL(req.url).searchParams;
  const f = { from: u.get("from") ?? undefined, to: u.get("to") ?? undefined, action: u.get("action") ?? undefined, actor: u.get("actor") ?? undefined, ws: u.get("ws") ?? undefined, q: u.get("q") ?? undefined };
  const { q } = await auditQuery(ctx, f, false);
  const { data } = await q.limit(10_000);
  const head = ["at", "actor_id", "action", "entity", "entity_id", "workspace_id", "org_id", "diff"];
  const rows = (data ?? []).map((r) => [r.at, r.actor_id ?? "", r.action, r.entity ?? "", r.entity_id ?? "", r.workspace_id ?? "", r.org_id ?? "", r.diff ? JSON.stringify(r.diff) : ""]);
  return new Response(toCsv(head, rows), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="audit-log-${new Date().toISOString().slice(0, 10)}.csv"` } });
}
