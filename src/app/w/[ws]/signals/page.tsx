import Link from "next/link";
import { requireWorkspace } from "@/lib/tenancy";
import { nowMs } from "@/lib/time";
import { userClient } from "@/lib/supabase/server";
import { Button, Card, Json, money, Notice, PageHeader, Status, Table, Td, when } from "@/components/ui";
import { deliverNow, resend } from "../actions";

export const metadata = { title: "Ad signals" };

const FILTERS = ["all", "pending", "sent", "dry_run", "test", "dead", "blocked_window", "no_click_id", "no_destination", "skipped"];

export default async function Signals({ params, searchParams }: { params: Promise<{ ws: string }>; searchParams: Promise<{ status?: string; saved?: string }> }) {
  const { ws: wsId } = await params;
  const sp = await searchParams;
  const { ws, rank } = await requireWorkspace(wsId);
  const sb = await userClient();
  let q = sb.from("signal_jobs").select("*").eq("workspace_id", ws.id).order("created_at", { ascending: false }).limit(200);
  if (sp.status && sp.status !== "all") q = q.eq("status", sp.status);
  const { data: jobs } = await q;

  // Weekly reconciliation (DEL-06): CRM stage changes vs signals created vs accepted.
  const since = new Date(nowMs() - 7 * 86_400_000).toISOString();
  const [{ data: ev }, { data: wk }] = await Promise.all([
    sb.from("stage_events").select("canonical_stage").eq("workspace_id", ws.id).gte("occurred_at", since).neq("canonical_stage", "lost"),
    sb.from("signal_jobs").select("canonical_stage,status").eq("workspace_id", ws.id).gte("created_at", since),
  ]);
  const stages = ["submitted", "qualified", "opportunity", "contract", "sold", "funded"];
  const recon = stages.map((s) => ({
    s,
    events: (ev ?? []).filter((e) => e.canonical_stage === s).length,
    jobs: (wk ?? []).filter((j) => j.canonical_stage === s).length,
    accepted: (wk ?? []).filter((j) => j.canonical_stage === s && ["sent", "dry_run", "test"].includes(j.status)).length,
    blocked: (wk ?? []).filter((j) => j.canonical_stage === s && ["blocked_window", "no_click_id", "no_destination", "dead"].includes(j.status)).length,
  }));

  return (
    <>
      <PageHeader
        title="Signals to ad platforms"
        description="Every upload OSE attempted, with its value, status and the exact payload. Nothing is uploaded by hand."
        actions={
          rank >= 3 && (
            <form action={deliverNow.bind(null, ws.id)}>
              <Button variant="secondary">Process pending now</Button>
            </form>
          )
        }
      />
      {sp.saved && <div className="mb-4"><Notice tone="green">{sp.saved}</Notice></div>}
      <Card title="Reconciliation — last 7 days" description="CRM stage changes vs signals created vs accepted per stage. A gap means something needs attention." className="mb-6">
        <Table head={["Stage", "Stage changes", "Signals", "Accepted / simulated", "Blocked / failed"]}>
          {recon.map((r) => (
            <tr key={r.s}>
              <Td>{r.s}</Td>
              <Td className="num">{r.events}</Td>
              <Td className="num">{r.jobs}</Td>
              <Td className="num">{r.accepted}</Td>
              <Td className="num">{r.blocked}</Td>
            </tr>
          ))}
        </Table>
      </Card>
      <div className="mb-3 flex flex-wrap gap-1 text-sm">
        {FILTERS.map((f) => (
          <Link key={f} href={`?status=${f}`} className={`rounded px-2 py-1 ${(sp.status ?? "all") === f ? "bg-brand text-white" : "hover:bg-gray-100"}`}>
            {f.replace(/_/g, " ")}
          </Link>
        ))}
      </div>
      <Card>
        <Table head={["Created", "Lead", "Platform", "Stage", "Increment", "Cumulative", "Mode", "Status", "Tries", "Payload", ""]} empty="No signals yet.">
          {(jobs ?? []).map((j) => (
            <tr key={j.id}>
              <Td>{when(j.created_at)}</Td>
              <Td>
                <Link className="font-mono text-xs text-brand hover:underline" href={`/w/${ws.id}/leads/${j.lead_id}`}>
                  {String(j.lead_id).slice(0, 8)}
                </Link>
              </Td>
              <Td>{j.platform}</Td>
              <Td>{j.canonical_stage}</Td>
              <Td className="num">{money(j.value_increment, j.currency)}</Td>
              <Td className="num">{money(j.cumulative_after, j.currency)}</Td>
              <Td>{j.mode}</Td>
              <Td>
                <Status value={j.status} />
                {j.error && <div className="mt-1 max-w-64 text-xs text-muted">{j.error}</div>}
              </Td>
              <Td className="num">{j.attempts}</Td>
              <Td>
                <Json value={{ request: j.request, response: j.response }} />
              </Td>
              <Td>
                {rank >= 3 && ["dead", "failed", "no_destination"].includes(j.status) && (
                  <form action={resend.bind(null, ws.id, j.id)}>
                    <button className="text-xs text-brand hover:underline">Re-send</button>
                  </form>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
