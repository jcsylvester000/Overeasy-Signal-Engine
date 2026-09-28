import Link from "next/link";
import { admin } from "@/lib/supabase/admin";
import { nowMs } from "@/lib/time";
import { requireTeam } from "@/server/team";
import { Badge, Button, Card, PageHeader, type Tone } from "@/components/ui";
import { Pager, pageNum } from "@/components/pager";
import { markAllRead, markRead } from "../actions";
import { lookups } from "../data";
import { Flash, rel } from "../ui";

export const metadata = { title: "Notifications" };
const PER = 30;
const KIND: Record<string, { label: string; tone: Tone }> = {
  alert: { label: "Alert", tone: "red" },
  milestone: { label: "Milestone", tone: "green" },
  task_assigned: { label: "Task", tone: "blue" },
  task_done: { label: "Task done", tone: "green" },
  task_overdue: { label: "Overdue", tone: "red" },
  task_reminder: { label: "Reminder", tone: "amber" },
  reminder: { label: "Reminder", tone: "amber" },
  assigned: { label: "Assigned", tone: "purple" },
};

export default async function Notifications({ searchParams }: { searchParams: Promise<{ page?: string; filter?: string; kind?: string; notice?: string; error?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireTeam(1);
  const now = nowMs();
  const page = pageNum(sp.page);
  const L = await lookups(ctx);
  let q = admin().from("notifications").select("*", { count: "exact" }).eq("user_id", ctx.user.id);
  if (sp.filter === "unread") q = q.is("read_at", null);
  if (sp.kind && KIND[sp.kind]) q = q.eq("kind", sp.kind);
  const { data, count } = await q.order("created_at", { ascending: false }).range((page - 1) * PER, page * PER - 1);
  const params = { filter: sp.filter, kind: sp.kind };
  const returnTo = `/team/notifications${sp.filter ? `?filter=${sp.filter}` : ""}`;

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Alerts and milestones from your workspaces, task assignments, due dates and reminders."
        actions={
          <form action={markAllRead}>
            <input type="hidden" name="return_to" value={returnTo} />
            <Button variant="secondary">Mark all as read</Button>
          </form>
        }
      />
      <Flash sp={sp} />
      <div className="mb-3 flex flex-wrap gap-2 text-sm">
        {[
          ["", "All"],
          ["unread", "Unread"],
        ].map(([f, label]) => (
          <Link key={f} href={f ? `/team/notifications?filter=${f}` : "/team/notifications"} className={(sp.filter ?? "") === f && !sp.kind ? "rounded-md bg-brand px-3 py-1 text-white" : "rounded-md border border-line px-3 py-1 hover:bg-gray-50"}>
            {label}
          </Link>
        ))}
        {Object.entries(KIND)
          .filter(([k]) => k !== "task_reminder")
          .map(([k, v]) => (
            <Link key={k} href={`/team/notifications?kind=${k}`} className={sp.kind === k ? "rounded-md bg-brand px-3 py-1 text-white" : "rounded-md border border-line px-3 py-1 hover:bg-gray-50"}>
              {v.label}
            </Link>
          ))}
      </div>
      <Card>
        <ul className="divide-y divide-line">
          {(data ?? []).map((n) => {
            const k = KIND[n.kind] ?? { label: n.kind, tone: "gray" as Tone };
            return (
              <li key={n.id} className={`flex flex-wrap items-start justify-between gap-2 py-2.5 ${n.read_at ? "" : "bg-amber-50/40"}`}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={k.tone}>{k.label}</Badge>
                    <Link href={`/team/notifications/${n.id}`} className={n.read_at ? "hover:underline" : "font-semibold hover:underline"}>
                      {n.title}
                    </Link>
                  </div>
                  <div className="mt-0.5 text-xs text-muted">
                    {rel(n.created_at, now)}
                    {n.workspace_id && L.wsName.get(n.workspace_id) ? ` · ${L.wsName.get(n.workspace_id)}` : ""}
                    {n.body ? ` · ${n.body}` : ""}
                  </div>
                </div>
                {!n.read_at && (
                  <form action={markRead.bind(null, n.id)}>
                    <input type="hidden" name="return_to" value={returnTo} />
                    <button className="text-xs text-muted hover:text-ink hover:underline">Mark read</button>
                  </form>
                )}
              </li>
            );
          })}
          {!data?.length && <li className="py-6 text-center text-sm text-muted">No notifications.</li>}
        </ul>
        <Pager path="/team/notifications" params={params} page={page} perPage={PER} total={count ?? 0} />
      </Card>
    </>
  );
}
