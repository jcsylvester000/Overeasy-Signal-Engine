import Link from "next/link";
import { Badge, Notice, type Tone } from "@/components/ui";
import { ConfirmAction, FormDialog, LocalDateTime } from "@/components/confirm";
import { TASK_PRIORITIES, TASK_STATUSES, TASK_STATUS_LABEL } from "@/server/team";
import { deleteTask, saveTask, setTaskStatus } from "./actions";

/** "in 3 h", "2 d ago" — relative to the request time. */
export function rel(ts: string | null | undefined, now: number) {
  if (!ts) return "—";
  const d = new Date(ts).getTime() - now;
  const a = Math.abs(d);
  const u = a < 3_600_000 ? `${Math.max(1, Math.round(a / 60_000))} min` : a < 86_400_000 ? `${Math.round(a / 3_600_000)} h` : `${Math.round(a / 86_400_000)} d`;
  return d >= 0 ? `in ${u}` : `${u} ago`;
}

export function Flash({ sp }: { sp: { notice?: string; error?: string } }) {
  if (!sp.notice && !sp.error) return null;
  return <div className="mb-4">{sp.error ? <Notice tone="red">{sp.error.slice(0, 300)}</Notice> : <Notice tone="green">{sp.notice!.slice(0, 300)}</Notice>}</div>;
}

const PRI_TONE: Record<string, Tone> = { low: "gray", normal: "blue", high: "amber", urgent: "red" };
const STATUS_TONE: Record<string, Tone> = { todo: "gray", in_progress: "blue", blocked: "red", done: "green" };
export const PriorityBadge = ({ p }: { p: string }) => <Badge tone={PRI_TONE[p] ?? "gray"}>{p}</Badge>;
export const StatusBadge = ({ s }: { s: string }) => <Badge tone={STATUS_TONE[s] ?? "gray"}>{TASK_STATUS_LABEL[s as keyof typeof TASK_STATUS_LABEL] ?? s}</Badge>;

export type TaskRow = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  workspace_id: string | null;
  assignee_id: string | null;
  created_by: string | null;
  due_at: string | null;
  remind_at: string | null;
  completed_at: string | null;
  created_at: string;
};
type Opt = { id: string; label: string };

/** Fields shared by the add and edit task forms. */
export function TaskFields({ t, workspaces, members, defaultWs, defaultAssignee }: { t?: TaskRow; workspaces: Opt[]; members: Opt[]; defaultWs?: string; defaultAssignee?: string }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {t && <input type="hidden" name="id" value={t.id} />}
      <label className="block sm:col-span-2">
        <span className="text-xs font-medium">Title</span>
        <input name="title" required maxLength={200} defaultValue={t?.title} className="mt-1 w-full" placeholder="Call client about Q4 budget" />
      </label>
      <label className="block sm:col-span-2">
        <span className="text-xs font-medium">Details (optional)</span>
        <textarea name="description" rows={2} defaultValue={t?.description ?? ""} className="mt-1 w-full" />
      </label>
      <label className="block">
        <span className="text-xs font-medium">Workspace</span>
        <select name="workspace_id" defaultValue={t?.workspace_id ?? defaultWs ?? ""} className="mt-1 w-full">
          <option value="">— General (no workspace)</option>
          {workspaces.map((w) => (
            <option key={w.id} value={w.id}>
              {w.label}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="text-xs font-medium">Assignee</span>
        <select name="assignee_id" defaultValue={t?.assignee_id ?? defaultAssignee ?? ""} className="mt-1 w-full">
          <option value="">— Unassigned</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="text-xs font-medium">Priority</span>
        <select name="priority" defaultValue={t?.priority ?? "normal"} className="mt-1 w-full">
          {TASK_PRIORITIES.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="text-xs font-medium">Status</span>
        <select name="status" defaultValue={t?.status ?? "todo"} className="mt-1 w-full">
          {TASK_STATUSES.map((s) => (
            <option key={s} value={s}>
              {TASK_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="text-xs font-medium">Due</span>
        <LocalDateTime name="due_at" defaultValue={t?.due_at} className="mt-1 w-full" />
      </label>
      <label className="block">
        <span className="text-xs font-medium">Remind me / assignee at</span>
        <LocalDateTime name="remind_at" defaultValue={t?.remind_at} className="mt-1 w-full" />
      </label>
    </div>
  );
}

/** One task line with quick status change, edit dialog and delete confirmation. */
export function TaskLine({ t, now, wsName, assignee, workspaces, members, returnTo, canDelete, compact }: { t: TaskRow; now: number; wsName?: string; assignee?: string; workspaces: Opt[]; members: Opt[]; returnTo: string; canDelete: boolean; compact?: boolean }) {
  const overdue = t.status !== "done" && t.due_at && new Date(t.due_at).getTime() < now;
  return (
    <li id={`task-${t.id}`} className="flex flex-wrap items-start justify-between gap-2 rounded-md border border-line bg-white p-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className={t.status === "done" ? "text-muted line-through" : "font-medium"}>{t.title}</span>
          <PriorityBadge p={t.priority} />
          {!compact && <StatusBadge s={t.status} />}
        </div>
        <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted">
          {wsName && t.workspace_id && (
            <Link href={`/team/w/${t.workspace_id}`} className="hover:underline">
              {wsName}
            </Link>
          )}
          <span>{assignee ? `→ ${assignee}` : "Unassigned"}</span>
          {t.due_at && <span className={overdue ? "font-medium text-red-700" : ""}>due {rel(t.due_at, now)}</span>}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <form action={setTaskStatus.bind(null, t.id)} className="flex items-center gap-1">
          <input type="hidden" name="return_to" value={returnTo} />
          {t.status !== "done" ? (
            <>
              <input type="hidden" name="status" value="done" />
              <button className="rounded border border-line px-2 py-0.5 text-xs hover:border-green-600 hover:text-green-700" title="Mark done">
                ✓ Done
              </button>
            </>
          ) : (
            <>
              <input type="hidden" name="status" value="todo" />
              <button className="rounded border border-line px-2 py-0.5 text-xs hover:bg-gray-50">Reopen</button>
            </>
          )}
        </form>
        <FormDialog trigger="Edit" title="Edit task" action={saveTask}>
          <input type="hidden" name="return_to" value={returnTo} />
          <TaskFields t={t} workspaces={workspaces} members={members} />
        </FormDialog>
        {canDelete && (
          <ConfirmAction
            action={deleteTask.bind(null, t.id)}
            trigger="Delete"
            title="Delete this task?"
            message={<>“{t.title}” will be removed for everyone. This cannot be undone.</>}
            confirmLabel="Delete task"
            hidden={{ return_to: returnTo }}
          />
        )}
      </div>
    </li>
  );
}
