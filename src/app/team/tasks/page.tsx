import Link from "next/link";
import { admin } from "@/lib/supabase/admin";
import { nowMs } from "@/lib/time";
import { requireTeam, TASK_PRIORITIES, TASK_STATUSES, TASK_STATUS_LABEL } from "@/server/team";
import { Card, PageHeader } from "@/components/ui";
import { FormDialog } from "@/components/confirm";
import { Pager, pageNum } from "@/components/pager";
import { saveTask } from "../actions";
import { lookups } from "../data";
import { Flash, TaskFields, TaskLine, type TaskRow } from "../ui";

export const metadata = { title: "Tasks" };
const PER = 30;

type SP = { view?: string; mine?: string; ws?: string; assignee?: string; status?: string; priority?: string; from?: string; to?: string; q?: string; page?: string; task?: string; notice?: string; error?: string };

export default async function Tasks({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const ctx = await requireTeam(1);
  const now = nowMs();
  const L = await lookups(ctx);
  const view = sp.view === "board" ? "board" : "list";
  const page = pageNum(sp.page);
  const db = admin();

  // Scope: admins see all team tasks; users see theirs, ones they created, and tasks in their workspaces.
  let q = db.from("team_tasks").select("*", { count: "exact" }).eq("team_org_id", ctx.orgId);
  if (ctx.rank < 2 || sp.mine) {
    const ors = [`assignee_id.eq.${ctx.user.id}`, `created_by.eq.${ctx.user.id}`];
    if (!sp.mine && ctx.assigned.length) ors.push(`workspace_id.in.(${ctx.assigned.join(",")})`);
    q = q.or(ors.join(","));
  }
  if (sp.ws) q = q.eq("workspace_id", sp.ws);
  if (sp.assignee === "none") q = q.is("assignee_id", null);
  else if (sp.assignee) q = q.eq("assignee_id", sp.assignee);
  if (sp.status === "open") q = q.neq("status", "done");
  else if (sp.status && (TASK_STATUSES as readonly string[]).includes(sp.status)) q = q.eq("status", sp.status);
  if (sp.priority && (TASK_PRIORITIES as readonly string[]).includes(sp.priority)) q = q.eq("priority", sp.priority);
  if (sp.from) q = q.gte("due_at", `${sp.from}T00:00:00Z`);
  if (sp.to) q = q.lte("due_at", `${sp.to}T23:59:59Z`);
  if (sp.q) q = q.ilike("title", `%${sp.q.replace(/[%_,()]/g, " ").slice(0, 60)}%`);
  q = q.order("due_at", { ascending: true, nullsFirst: false }).order("created_at", { ascending: false });
  const { data, count } = view === "board" ? await q.limit(400) : await q.range((page - 1) * PER, page * PER - 1);
  const tasks = (data ?? []) as TaskRow[];
  // Deep link from a notification: show that task on top.
  let focus: TaskRow | null = null;
  if (sp.task && /^[0-9a-f-]{36}$/i.test(sp.task)) {
    const { data: t } = await db.from("team_tasks").select("*").eq("id", sp.task).eq("team_org_id", ctx.orgId).maybeSingle<TaskRow>();
    if (t && (ctx.rank >= 2 || t.assignee_id === ctx.user.id || t.created_by === ctx.user.id || (t.workspace_id && ctx.assigned.includes(t.workspace_id)))) focus = t;
  }

  const params: Record<string, string | undefined> = { view: sp.view, mine: sp.mine, ws: sp.ws, assignee: sp.assignee, status: sp.status, priority: sp.priority, from: sp.from, to: sp.to, q: sp.q };
  const self = (extra: Record<string, string | undefined>) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...params, ...extra })) if (v) u.set(k, v);
    return `/team/tasks${u.toString() ? `?${u}` : ""}`;
  };
  const returnTo = self({ page: page > 1 ? String(page) : undefined });
  const line = (t: TaskRow, compact = false) => (
    <TaskLine key={t.id} t={t} now={now} compact={compact} wsName={t.workspace_id ? L.wsName.get(t.workspace_id) : undefined} assignee={t.assignee_id ? L.memberName.get(t.assignee_id) : undefined} workspaces={L.wsOpts} members={L.memberOpts} returnTo={returnTo} canDelete={ctx.rank >= 2 || t.created_by === ctx.user.id} />
  );

  return (
    <>
      <PageHeader
        title="Tasks"
        description="Team tasks across your workspaces. Assignees are notified; due and reminder times send notifications."
        actions={
          <>
            <Link href={self({ view: view === "board" ? undefined : "board", page: undefined })} className="rounded-md border border-line px-3 py-1.5 text-sm hover:bg-gray-50">
              {view === "board" ? "List view" : "Board view"}
            </Link>
            <FormDialog trigger="+ New task" title="New task" action={saveTask} triggerClassName="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:opacity-90" submitLabel="Add task">
              <input type="hidden" name="return_to" value={returnTo} />
              <TaskFields workspaces={L.wsOpts} members={L.memberOpts} defaultWs={sp.ws} defaultAssignee={ctx.user.id} />
            </FormDialog>
          </>
        }
      />
      <Flash sp={sp} />

      {focus && (
        <Card title="Task" className="mb-4">
          <ul>{line(focus)}</ul>
          {focus.description && <p className="mt-2 whitespace-pre-wrap text-sm">{focus.description}</p>}
        </Card>
      )}

      <form className="mb-4 flex flex-wrap items-end gap-2 rounded-lg border border-line bg-panel p-3 text-sm">
        {sp.view && <input type="hidden" name="view" value={sp.view} />}
        <label className="block">
          <span className="text-xs text-muted">Search</span>
          <input name="q" defaultValue={sp.q} placeholder="Title…" className="mt-0.5 block w-40" />
        </label>
        <label className="block">
          <span className="text-xs text-muted">Workspace</span>
          <select name="ws" defaultValue={sp.ws ?? ""} className="mt-0.5 block">
            <option value="">All</option>
            {L.wsOpts.map((w) => (
              <option key={w.id} value={w.id}>
                {w.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs text-muted">Assignee</span>
          <select name="assignee" defaultValue={sp.assignee ?? ""} className="mt-0.5 block">
            <option value="">Anyone</option>
            <option value="none">Unassigned</option>
            {L.memberOpts.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs text-muted">Status</span>
          <select name="status" defaultValue={sp.status ?? ""} className="mt-0.5 block">
            <option value="">Any</option>
            <option value="open">Open (not done)</option>
            {TASK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {TASK_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs text-muted">Priority</span>
          <select name="priority" defaultValue={sp.priority ?? ""} className="mt-0.5 block">
            <option value="">Any</option>
            {TASK_PRIORITIES.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs text-muted">Due from</span>
          <input type="date" name="from" defaultValue={sp.from} className="mt-0.5 block" />
        </label>
        <label className="block">
          <span className="text-xs text-muted">Due to</span>
          <input type="date" name="to" defaultValue={sp.to} className="mt-0.5 block" />
        </label>
        <label className="flex items-center gap-1.5 pb-1.5">
          <input type="checkbox" name="mine" value="1" defaultChecked={Boolean(sp.mine)} /> Only mine
        </label>
        <button className="rounded-md bg-brand px-3 py-1.5 font-medium text-white">Filter</button>
        <Link href={`/team/tasks${sp.view ? `?view=${sp.view}` : ""}`} className="pb-1.5 text-xs text-muted hover:underline">
          Clear
        </Link>
      </form>

      {view === "board" ? (
        <div className="grid gap-4 lg:grid-cols-4">
          {TASK_STATUSES.map((s) => {
            const col = tasks.filter((t) => t.status === s);
            return (
              <section key={s} className="rounded-lg border border-line bg-gray-50/60 p-2">
                <h2 className="mb-2 flex items-center justify-between px-1 text-sm font-semibold">
                  {TASK_STATUS_LABEL[s]} <span className="text-xs font-normal text-muted">{col.length}</span>
                </h2>
                <ul className="space-y-2">{col.map((t) => line(t, true))}</ul>
                {!col.length && <p className="px-1 text-xs text-muted">Empty</p>}
              </section>
            );
          })}
        </div>
      ) : (
        <Card>
          {tasks.length ? <ul className="space-y-2">{tasks.map((t) => line(t))}</ul> : <p className="text-sm text-muted">No tasks match these filters.</p>}
          <Pager path="/team/tasks" params={params} page={page} perPage={PER} total={count ?? 0} />
        </Card>
      )}
    </>
  );
}
