import Link from "next/link";
import { admin } from "@/lib/supabase/admin";
import { nowMs } from "@/lib/time";
import { attentionScore, requireTeam, workspaceMetrics } from "@/server/team";
import { Badge, Card, PageHeader, Stat } from "@/components/ui";
import { ConfirmAction, FormDialog, LocalDateTime } from "@/components/confirm";
import { addReminder, deleteReminder, saveTask } from "./actions";
import { lookups } from "./data";
import { Flash, TaskFields, TaskLine, rel, type TaskRow } from "./ui";

export const metadata = { title: "My board" };

export default async function MyBoard({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string; welcome?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireTeam(1);
  const now = nowMs();
  const db = admin();
  const L = await lookups(ctx);
  const mine = ctx.rank >= 2 && ctx.assigned.length === 0 ? L.wss : L.wss.filter((w) => ctx.assigned.includes(w.id));
  const endOfDay = new Date(now);
  endOfDay.setUTCHours(23, 59, 59, 999);

  const [metrics, { data: tasks }, { data: reminders }, { data: notes }, { count: unread }] = await Promise.all([
    workspaceMetrics(mine.map((w) => w.id)),
    db.from("team_tasks").select("*").eq("team_org_id", ctx.orgId).eq("assignee_id", ctx.user.id).neq("status", "done").order("due_at", { ascending: true, nullsFirst: false }).limit(50),
    db.from("team_reminders").select("id,note,remind_at,workspace_id,sent_at").eq("user_id", ctx.user.id).gte("remind_at", new Date(now - 86_400_000).toISOString()).order("remind_at").limit(10),
    db.from("notifications").select("id,title,link,created_at,read_at,kind").eq("user_id", ctx.user.id).order("created_at", { ascending: false }).limit(6),
    db.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", ctx.user.id).is("read_at", null),
  ]);
  const myTasks = (tasks ?? []) as TaskRow[];
  const overdue = myTasks.filter((t) => t.due_at && new Date(t.due_at).getTime() < now).length;
  const today = myTasks.filter((t) => t.due_at && new Date(t.due_at).getTime() >= now && new Date(t.due_at).getTime() <= endOfDay.getTime()).length;
  const ranked = [...mine].sort((a, b) => attentionScore(metrics.get(b.id), now) - attentionScore(metrics.get(a.id), now));
  const name = L.memberName.get(ctx.user.id) ?? "there";

  return (
    <>
      <PageHeader
        title={`Hi ${name.split(" ")[0]}`}
        description={ctx.rank >= 2 && ctx.assigned.length === 0 ? "You have no assigned workspaces, so the board shows every workspace in the team." : "Your workspaces, tasks and reminders."}
        actions={
          <FormDialog trigger="+ New task" title="New task" action={saveTask} triggerClassName="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:opacity-90" submitLabel="Add task">
            <input type="hidden" name="return_to" value="/team" />
            <TaskFields workspaces={L.wsOpts} members={L.memberOpts} defaultAssignee={ctx.user.id} />
          </FormDialog>
        }
      />
      {sp.welcome && <Flash sp={{ notice: "Password saved. Welcome to the team board." }} />}
      <Flash sp={sp} />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="My open tasks" value={myTasks.length} />
        <Stat label="Due today" value={today} />
        <Stat label="Overdue" value={<span className={overdue ? "text-red-700" : ""}>{overdue}</span>} />
        <Stat label="Unread notifications" value={<Link href="/team/notifications" className="hover:underline">{unread ?? 0}</Link>} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          <Card title="My workspaces" description="Sorted by what needs attention first: critical alerts, failed uploads, overdue tasks, a quiet website tag.">
            {ranked.length ? (
              <ul className="grid gap-3 md:grid-cols-2">
                {ranked.map((w) => {
                  const m = metrics.get(w.id);
                  const score = attentionScore(m, now);
                  const tagQuiet = !m?.last_tag_event || now - new Date(m.last_tag_event).getTime() > 24 * 3_600_000;
                  return (
                    <li key={w.id} className="rounded-md border border-line bg-white p-3">
                      <div className="flex items-start justify-between gap-2">
                        <Link href={`/team/w/${w.id}`} className="font-medium hover:underline">
                          {w.name}
                        </Link>
                        {score >= 40 ? <Badge tone="red">needs attention</Badge> : score >= 15 ? <Badge tone="amber">check</Badge> : <Badge tone="green">healthy</Badge>}
                      </div>
                      <dl className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
                        <div className="rounded bg-gray-50 p-1.5">
                          <dt className="text-muted">Leads 7 d</dt>
                          <dd className="num text-base font-semibold">{m?.leads_7d ?? 0}</dd>
                        </div>
                        <div className="rounded bg-gray-50 p-1.5">
                          <dt className="text-muted">Qualified 7 d</dt>
                          <dd className="num text-base font-semibold">{m?.qualified_7d ?? 0}</dd>
                        </div>
                        <div className="rounded bg-gray-50 p-1.5">
                          <dt className="text-muted">Contracts 30 d</dt>
                          <dd className="num text-base font-semibold">{m?.contracts_30d ?? 0}</dd>
                        </div>
                      </dl>
                      <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                        {!!m?.alerts_open && <Badge tone={m.alerts_critical ? "red" : "amber"}>{m.alerts_open} open alerts</Badge>}
                        {!!m?.failed_30d && <Badge tone="red">{m.failed_30d} failed uploads</Badge>}
                        {!!m?.overdue_tasks && <Badge tone="red">{m.overdue_tasks} overdue tasks</Badge>}
                        {!!m?.open_tasks && <Badge tone="gray">{m.open_tasks} open tasks</Badge>}
                        {tagQuiet ? <Badge tone="amber">tag quiet</Badge> : <Badge tone="green">tag live</Badge>}
                      </div>
                      <div className="mt-2 flex gap-3 text-xs">
                        <Link href={`/team/w/${w.id}`} className="text-brand hover:underline">
                          Team page
                        </Link>
                        <Link href={`/w/${w.id}`} className="text-brand hover:underline">
                          Dashboard
                        </Link>
                        <Link href={`/w/${w.id}/health`} className="text-brand hover:underline">
                          Health
                        </Link>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-muted">No workspaces assigned to you yet. An admin assigns them on Members &amp; access.</p>
            )}
          </Card>

          <Card title="My tasks" description="Open tasks assigned to you, soonest due first." actions={<Link href="/team/tasks?mine=1" className="text-sm text-brand hover:underline">All tasks →</Link>}>
            {myTasks.length ? (
              <ul className="space-y-2">
                {myTasks.slice(0, 12).map((t) => (
                  <TaskLine key={t.id} t={t} now={now} wsName={t.workspace_id ? L.wsName.get(t.workspace_id) : undefined} assignee={t.assignee_id ? L.memberName.get(t.assignee_id) : undefined} workspaces={L.wsOpts} members={L.memberOpts} returnTo="/team" canDelete={ctx.rank >= 2 || t.created_by === ctx.user.id} />
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">Nothing on your plate. </p>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Reminders" description="Only you see these. You get a notification at the time you pick.">
            <ul className="mb-3 space-y-1.5 text-sm">
              {(reminders ?? []).map((r) => (
                <li key={r.id} className="flex items-start justify-between gap-2">
                  <span className={r.sent_at ? "text-muted line-through" : ""}>
                    {r.note}
                    <span className="block text-xs text-muted">
                      {rel(r.remind_at, now)}
                      {r.workspace_id && L.wsName.get(r.workspace_id) ? ` · ${L.wsName.get(r.workspace_id)}` : ""}
                    </span>
                  </span>
                  <ConfirmAction action={deleteReminder.bind(null, r.id)} trigger="✕" title="Remove this reminder?" message={r.note} confirmLabel="Remove" triggerClassName="text-xs text-muted hover:text-red-700" hidden={{ return_to: "/team" }} />
                </li>
              ))}
              {!reminders?.length && <li className="text-muted">No reminders.</li>}
            </ul>
            <form action={addReminder} className="space-y-2 border-t border-line pt-3">
              <input type="hidden" name="return_to" value="/team" />
              <input name="note" required maxLength={300} placeholder="Follow up with client…" className="w-full" />
              <LocalDateTime name="remind_at" className="w-full" />
              <select name="workspace_id" className="w-full" defaultValue="">
                <option value="">— No workspace</option>
                {L.wsOpts.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.label}
                  </option>
                ))}
              </select>
              <button className="rounded-md border border-line px-3 py-1.5 text-sm hover:bg-gray-50">Set reminder</button>
            </form>
          </Card>

          <Card title="Latest notifications" actions={<Link href="/team/notifications" className="text-sm text-brand hover:underline">All →</Link>}>
            <ul className="space-y-2 text-sm">
              {(notes ?? []).map((n) => (
                <li key={n.id}>
                  <Link href={`/team/notifications/${n.id}`} className={n.read_at ? "text-muted hover:underline" : "font-medium hover:underline"}>
                    {n.title}
                  </Link>
                  <span className="block text-xs text-muted">{rel(n.created_at, now)}</span>
                </li>
              ))}
              {!notes?.length && <li className="text-muted">Nothing yet.</li>}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
