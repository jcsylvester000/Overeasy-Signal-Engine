import Link from "next/link";
import { notFound } from "next/navigation";
import { admin } from "@/lib/supabase/admin";
import { nowMs } from "@/lib/time";
import { canSeeWorkspace, requireTeam, workspaceMetrics } from "@/server/team";
import { Badge, Button, Card, PageHeader, Stat, Table, Td } from "@/components/ui";
import { ConfirmAction, FormDialog } from "@/components/confirm";
import { addNote, deleteNote, saveTask, setWorkspaceTeam, togglePin } from "../../actions";
import { lookups } from "../../data";
import { Flash, TaskFields, TaskLine, rel, type TaskRow } from "../../ui";

export const metadata = { title: "Workspace team" };

export default async function WorkspaceTeam({ params, searchParams }: { params: Promise<{ ws: string }>; searchParams: Promise<{ notice?: string; error?: string; done?: string }> }) {
  const { ws: wsId } = await params;
  const sp = await searchParams;
  const ctx = await requireTeam(1);
  if (!/^[0-9a-f-]{36}$/i.test(wsId)) notFound();
  const db = admin();
  const { data: ws } = await db.from("workspaces").select("id,name,org_id,industry_template,currency,timezone,archived_at,organizations(name)").eq("id", wsId).maybeSingle();
  if (!ws || ws.archived_at || !canSeeWorkspace(ctx, ws)) notFound();
  const now = nowMs();
  const L = await lookups(ctx);
  const returnTo = `/team/w/${ws.id}`;
  const [metrics, { data: asg }, { data: tasks }, { data: notes }, { data: activity }, { data: stages }] = await Promise.all([
    workspaceMetrics([ws.id]),
    db.from("workspace_assignments").select("user_id,access,is_lead").eq("workspace_id", ws.id),
    db.from("team_tasks").select("*").eq("workspace_id", ws.id).order("due_at", { ascending: true, nullsFirst: false }).limit(sp.done ? 100 : 50),
    db.from("team_notes").select("*").eq("workspace_id", ws.id).order("pinned", { ascending: false }).order("created_at", { ascending: false }).limit(50),
    db.from("audit_log").select("id,action,actor_id,at,entity").eq("workspace_id", ws.id).order("at", { ascending: false }).limit(15),
    db.from("stage_events").select("lead_id,canonical_stage,occurred_at,source").eq("workspace_id", ws.id).order("occurred_at", { ascending: false }).limit(10),
  ]);
  const m = metrics.get(ws.id);
  const allTasks = (tasks ?? []) as TaskRow[];
  const shown = sp.done ? allTasks : allTasks.filter((t) => t.status !== "done");
  const team = new Map((asg ?? []).map((a) => [a.user_id as string, a]));
  const orgName = (Array.isArray(ws.organizations) ? ws.organizations[0] : ws.organizations)?.name as string | undefined;

  return (
    <>
      <PageHeader
        title={ws.name}
        description={`${orgName ?? ""} · ${ws.industry_template ?? "custom"} · ${ws.currency} · ${ws.timezone}`}
        actions={
          <>
            <Link href={`/w/${ws.id}`} className="rounded-md border border-line px-3 py-1.5 text-sm hover:bg-gray-50">
              Open dashboard
            </Link>
            <FormDialog trigger="+ New task" title={`New task · ${ws.name}`} action={saveTask} triggerClassName="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:opacity-90" submitLabel="Add task">
              <input type="hidden" name="return_to" value={returnTo} />
              <TaskFields workspaces={L.wsOpts} members={L.memberOpts} defaultWs={ws.id} defaultAssignee={ctx.user.id} />
            </FormDialog>
          </>
        }
      />
      <Flash sp={sp} />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Stat label="Leads 7 d" value={m?.leads_7d ?? 0} />
        <Stat label="Leads 30 d" value={m?.leads_30d ?? 0} />
        <Stat label="Qualified 7 d" value={m?.qualified_7d ?? 0} />
        <Stat label="Contracts 30 d" value={m?.contracts_30d ?? 0} />
        <Stat label="Open alerts" value={<span className={m?.alerts_critical ? "text-red-700" : ""}>{m?.alerts_open ?? 0}</span>} />
        <Stat label="Last website event" value={<span className="text-sm">{rel(m?.last_tag_event, now)}</span>} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          <Card
            title="Tasks"
            actions={
              <Link href={sp.done ? returnTo : `${returnTo}?done=1`} className="text-xs text-brand hover:underline">
                {sp.done ? "Hide done" : "Show done"}
              </Link>
            }
          >
            {shown.length ? (
              <ul className="space-y-2">
                {shown.map((t) => (
                  <TaskLine key={t.id} t={t} now={now} assignee={t.assignee_id ? L.memberName.get(t.assignee_id) : undefined} workspaces={L.wsOpts} members={L.memberOpts} returnTo={returnTo} canDelete={ctx.rank >= 2 || t.created_by === ctx.user.id} />
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">No open tasks.</p>
            )}
          </Card>

          <Card title="Notes" description="Internal to the agency team. Clients never see these.">
            <form action={addNote.bind(null, ws.id)} className="mb-4 space-y-2">
              <input type="hidden" name="return_to" value={returnTo} />
              <textarea name="body" required maxLength={4000} rows={3} placeholder="Call notes, decisions, context for the next person…" className="w-full" />
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-1.5 text-xs">
                  <input type="checkbox" name="pinned" /> Pin to top
                </label>
                <Button>Add note</Button>
              </div>
            </form>
            <ul className="space-y-3">
              {(notes ?? []).map((n) => (
                <li key={n.id} className={`rounded-md border p-3 ${n.pinned ? "border-amber-300 bg-amber-50/50" : "border-line bg-white"}`}>
                  <p className="whitespace-pre-wrap text-sm">{n.body}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted">
                    <span>
                      {L.memberName.get(n.author_id) ?? "Someone"} · {rel(n.created_at, now)}
                    </span>
                    <form action={togglePin.bind(null, n.id)}>
                      <input type="hidden" name="return_to" value={returnTo} />
                      <button className="hover:text-ink hover:underline">{n.pinned ? "Unpin" : "Pin"}</button>
                    </form>
                    {(ctx.rank >= 2 || n.author_id === ctx.user.id) && (
                      <ConfirmAction action={deleteNote.bind(null, n.id)} trigger="Delete" title="Delete this note?" message="The note is removed for the whole team." confirmLabel="Delete note" hidden={{ return_to: returnTo }} />
                    )}
                  </div>
                </li>
              ))}
              {!notes?.length && <li className="text-sm text-muted">No notes yet.</li>}
            </ul>
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Team on this workspace">
            <ul className="mb-3 space-y-1 text-sm">
              {[...team.values()].map((a) => (
                <li key={a.user_id} className="flex items-center justify-between">
                  <span>{L.memberName.get(a.user_id) ?? "Member"}</span>
                  <span className="flex gap-1">
                    {a.is_lead && <Badge tone="purple">lead</Badge>}
                    <Badge>{a.access}</Badge>
                  </span>
                </li>
              ))}
              {!team.size && <li className="text-muted">Nobody assigned. Admins get this workspace&apos;s alerts until someone is.</li>}
            </ul>
            {ctx.rank >= 2 && (
              <FormDialog trigger="Edit team" title={`Team · ${ws.name}`} action={setWorkspaceTeam.bind(null, ws.id)} triggerClassName="rounded-md border border-line px-3 py-1.5 text-sm hover:bg-gray-50">
                <input type="hidden" name="return_to" value={returnTo} />
                <p className="text-xs text-muted">Assigned members get this workspace on their board, its alerts and milestones, and manager access to its dashboard.</p>
                <ul className="max-h-72 space-y-1 overflow-y-auto">
                  {L.memberOpts.map((mm) => (
                    <li key={mm.id} className="flex items-center justify-between gap-2 text-sm">
                      <label className="flex items-center gap-2">
                        <input type="checkbox" name="member" value={mm.id} defaultChecked={team.has(mm.id)} /> {mm.label}
                      </label>
                      <label className="flex items-center gap-1 text-xs text-muted">
                        <input type="radio" name="lead" value={mm.id} defaultChecked={Boolean(team.get(mm.id)?.is_lead)} /> lead
                      </label>
                    </li>
                  ))}
                </ul>
              </FormDialog>
            )}
          </Card>

          <Card title="Recent lead movement">
            <ul className="space-y-1 text-sm">
              {(stages ?? []).map((s, i) => (
                <li key={i} className="flex justify-between gap-2">
                  <Link href={`/w/${ws.id}/leads/${s.lead_id}`} className="hover:underline">
                    {s.canonical_stage}
                  </Link>
                  <span className="text-xs text-muted">{rel(s.occurred_at, now)}</span>
                </li>
              ))}
              {!stages?.length && <li className="text-muted">No stage changes yet.</li>}
            </ul>
          </Card>

          <Card title="Activity" description="Latest changes (audit log).">
            <Table head={["What", "Who", "When"]} empty="No activity yet.">
              {(activity ?? []).map((a) => (
                <tr key={a.id}>
                  <Td className="text-xs">{a.action}</Td>
                  <Td className="text-xs">{a.actor_id ? (L.memberName.get(a.actor_id) ?? "user") : "system"}</Td>
                  <Td className="text-xs">{rel(a.at, now)}</Td>
                </tr>
              ))}
            </Table>
          </Card>
        </div>
      </div>
    </>
  );
}
