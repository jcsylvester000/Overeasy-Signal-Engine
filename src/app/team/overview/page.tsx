import Link from "next/link";
import { admin } from "@/lib/supabase/admin";
import { nowMs } from "@/lib/time";
import { attentionScore, requireTeam, TEAM_ROLE_LABEL, workspaceMetrics } from "@/server/team";
import { Badge, Card, PageHeader, Stat, Table, Td } from "@/components/ui";
import { lookups } from "../data";
import { rel } from "../ui";

export const metadata = { title: "Team overview" };

export default async function Overview() {
  const ctx = await requireTeam(2);
  const now = nowMs();
  const db = admin();
  const L = await lookups(ctx);
  const since7 = new Date(now - 7 * 86_400_000).toISOString();
  const [metrics, { data: asg }, { data: open }, { data: done7 }] = await Promise.all([
    workspaceMetrics(L.wss.map((w) => w.id)),
    db.from("workspace_assignments").select("workspace_id,user_id,is_lead").eq("team_org_id", ctx.orgId),
    db.from("team_tasks").select("id,assignee_id,due_at,priority").eq("team_org_id", ctx.orgId).neq("status", "done").limit(5000),
    db.from("team_tasks").select("id,assignee_id").eq("team_org_id", ctx.orgId).eq("status", "done").gte("completed_at", since7).limit(5000),
  ]);
  const assignedWs = new Set((asg ?? []).map((a) => a.workspace_id as string));
  const unassigned = L.wss.filter((w) => !assignedWs.has(w.id));
  const load = L.members.map((m) => {
    const mine = (open ?? []).filter((t) => t.assignee_id === m.user_id);
    return {
      m,
      ws: (asg ?? []).filter((a) => a.user_id === m.user_id).length,
      open: mine.length,
      overdue: mine.filter((t) => t.due_at && new Date(t.due_at).getTime() < now).length,
      urgent: mine.filter((t) => t.priority === "urgent" || t.priority === "high").length,
      done7: (done7 ?? []).filter((t) => t.assignee_id === m.user_id).length,
    };
  });
  const unassignedTasks = (open ?? []).filter((t) => !t.assignee_id).length;
  const overdueAll = (open ?? []).filter((t) => t.due_at && new Date(t.due_at).getTime() < now).length;
  const ranked = [...L.wss].sort((a, b) => attentionScore(metrics.get(b.id), now) - attentionScore(metrics.get(a.id), now));

  return (
    <>
      <PageHeader title="Team overview" description="Workload per member, workspaces without an owner, and which clients need attention first." />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Active members" value={L.members.filter((m) => m.status === "active").length} />
        <Stat label="Workspaces" value={L.wss.length} />
        <Stat label="Unassigned workspaces" value={<span className={unassigned.length ? "text-amber-700" : ""}>{unassigned.length}</span>} />
        <Stat label="Open tasks" value={(open ?? []).length} hint={`${unassignedTasks} unassigned`} />
        <Stat label="Overdue tasks" value={<span className={overdueAll ? "text-red-700" : ""}>{overdueAll}</span>} />
      </div>

      <div className="space-y-6">
        <Card title="Workload" description="Open tasks by assignee (done = completed in the last 7 days).">
          <Table head={["Member", "Role", "Workspaces", "Open", "High/urgent", "Overdue", "Done 7 d", ""]} empty="No members.">
            {load.map((r) => (
              <tr key={r.m.user_id}>
                <Td>
                  {L.memberName.get(r.m.user_id)}
                  {r.m.status !== "active" && (
                    <span className="ml-1">
                      <Badge tone="red">disabled</Badge>
                    </span>
                  )}
                </Td>
                <Td>{TEAM_ROLE_LABEL[r.m.team_role]}</Td>
                <Td className="num">{r.ws}</Td>
                <Td className="num">{r.open}</Td>
                <Td className="num">{r.urgent}</Td>
                <Td className={`num ${r.overdue ? "font-semibold text-red-700" : ""}`}>{r.overdue}</Td>
                <Td className="num">{r.done7}</Td>
                <Td>
                  <Link href={`/team/tasks?assignee=${r.m.user_id}&status=open`} className="text-xs text-brand hover:underline">
                    Tasks →
                  </Link>
                </Td>
              </tr>
            ))}
          </Table>
        </Card>

        {!!unassigned.length && (
          <Card title="Workspaces with nobody assigned" description="Their alerts go to admins until someone is assigned.">
            <ul className="flex flex-wrap gap-2">
              {unassigned.map((w) => (
                <li key={w.id}>
                  <Link href={`/team/w/${w.id}`} className="inline-block rounded-md border border-dashed border-amber-400 px-3 py-1.5 text-sm hover:bg-amber-50">
                    {w.name} → assign
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        )}

        <Card title="Workspace health ranking" description="Highest attention score first: critical alerts, failed uploads, overdue tasks, quiet website tag, no leads this week.">
          <Table head={["Workspace", "Score", "Leads 7 d / 30 d", "Qualified 7 d", "Contracts 30 d", "Alerts", "Failed uploads", "Tasks (overdue)", "Last tag event", "Team"]} empty="No workspaces.">
            {ranked.map((w) => {
              const m = metrics.get(w.id);
              const s = attentionScore(m, now);
              const who = (asg ?? []).filter((a) => a.workspace_id === w.id).map((a) => L.memberName.get(a.user_id)?.split(" ")[0]).filter(Boolean);
              return (
                <tr key={w.id}>
                  <Td>
                    <Link href={`/team/w/${w.id}`} className="text-brand hover:underline">
                      {w.name}
                    </Link>
                  </Td>
                  <Td>
                    <Badge tone={s >= 40 ? "red" : s >= 15 ? "amber" : "green"}>{s}</Badge>
                  </Td>
                  <Td className="num">
                    {m?.leads_7d ?? 0} / {m?.leads_30d ?? 0}
                  </Td>
                  <Td className="num">{m?.qualified_7d ?? 0}</Td>
                  <Td className="num">{m?.contracts_30d ?? 0}</Td>
                  <Td className="num">{m?.alerts_open ?? 0}</Td>
                  <Td className="num">{m?.failed_30d ?? 0}</Td>
                  <Td className="num">
                    {m?.open_tasks ?? 0} ({m?.overdue_tasks ?? 0})
                  </Td>
                  <Td className="text-xs">{rel(m?.last_tag_event, now)}</Td>
                  <Td className="text-xs">{who.join(", ") || "—"}</Td>
                </tr>
              );
            })}
          </Table>
        </Card>
      </div>
    </>
  );
}
