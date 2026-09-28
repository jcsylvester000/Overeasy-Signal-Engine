import Link from "next/link";
import { requireTeam } from "@/server/team";
import { auditQuery, type AuditFilters } from "./query";
import { Card, PageHeader, Table, Td } from "@/components/ui";
import { Pager, pageNum } from "@/components/pager";
import { lookups } from "../data";

export const metadata = { title: "Audit log" };
const PER = 30;

const GROUPS: [string, string][] = [
  ["", "All actions"],
  ["team.member", "Team members & passwords"],
  ["team.assignments", "Assignments"],
  ["team.task", "Tasks"],
  ["team.note", "Notes"],
  ["workspace", "Workspaces (create, edit, archive, delete)"],
  ["user.", "Own account (password change)"],
  ["org.", "Organization settings & branding"],
  ["member.", "Organization invites"],
  ["scoring", "Scoring models"],
  ["value", "Value models"],
  ["connection", "Connections"],
  ["site", "Sites & tag"],
  ["api_key", "API keys"],
];
export default async function Audit({ searchParams }: { searchParams: Promise<AuditFilters & { page?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireTeam(2);
  const page = pageNum(sp.page);
  const L = await lookups(ctx);
  const { q, wss } = await auditQuery(ctx, sp);
  const { data, count } = await q.range((page - 1) * PER, page * PER - 1);
  const wsName = new Map(wss.map((w) => [w.id, w.name + (w.archived_at ? " (archived)" : "")]));
  const params = { from: sp.from, to: sp.to, action: sp.action, actor: sp.actor, ws: sp.ws, q: sp.q };
  const exportQs = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]).toString();

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Every change and sign-in-related action by the team, across the team's organizations and workspaces. Read-only and append-only."
        actions={
          <Link href={`/team/audit/export${exportQs ? `?${exportQs}` : ""}`} className="rounded-md border border-line px-3 py-1.5 text-sm hover:bg-gray-50" prefetch={false}>
            Export CSV
          </Link>
        }
      />
      <form className="mb-4 flex flex-wrap items-end gap-2 rounded-lg border border-line bg-panel p-3 text-sm">
        <label className="block">
          <span className="text-xs text-muted">From</span>
          <input type="date" name="from" defaultValue={sp.from} className="mt-0.5 block" />
        </label>
        <label className="block">
          <span className="text-xs text-muted">To</span>
          <input type="date" name="to" defaultValue={sp.to} className="mt-0.5 block" />
        </label>
        <label className="block">
          <span className="text-xs text-muted">Action type</span>
          <select name="action" defaultValue={sp.action ?? ""} className="mt-0.5 block">
            {GROUPS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs text-muted">Who</span>
          <select name="actor" defaultValue={sp.actor ?? ""} className="mt-0.5 block">
            <option value="">Anyone</option>
            {L.members.map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {L.memberName.get(m.user_id)}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs text-muted">Workspace</span>
          <select name="ws" defaultValue={sp.ws ?? ""} className="mt-0.5 block">
            <option value="">All</option>
            {wss.map((w) => (
              <option key={w.id} value={w.id}>
                {wsName.get(w.id)}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs text-muted">Action contains</span>
          <input name="q" defaultValue={sp.q} placeholder="e.g. delete" className="mt-0.5 block w-32" />
        </label>
        <button className="rounded-md bg-brand px-3 py-1.5 font-medium text-white">Search</button>
        <Link href="/team/audit" className="pb-1.5 text-xs text-muted hover:underline">
          Clear
        </Link>
      </form>
      <Card>
        <Table head={["When (UTC)", "Who", "Action", "Workspace", "Details"]} empty="No entries match.">
          {(data ?? []).map((r) => (
            <tr key={r.id}>
              <Td className="whitespace-nowrap text-xs">{new Date(r.at).toISOString().replace("T", " ").slice(0, 19)}</Td>
              <Td className="text-xs">{r.actor_id ? (L.memberName.get(r.actor_id) ?? L.labels.get(r.actor_id)?.email ?? r.actor_id.slice(0, 8)) : "system"}</Td>
              <Td mono>{r.action}</Td>
              <Td className="text-xs">{r.workspace_id ? (wsName.get(r.workspace_id) ?? "—") : "—"}</Td>
              <Td className="max-w-md truncate text-xs text-muted" >
                <span title={r.diff ? JSON.stringify(r.diff) : ""}>{r.diff ? JSON.stringify(r.diff).slice(0, 140) : (r.entity ?? "")}</span>
              </Td>
            </tr>
          ))}
        </Table>
        <Pager path="/team/audit" params={params} page={page} perPage={PER} total={count ?? 0} />
      </Card>
    </>
  );
}
