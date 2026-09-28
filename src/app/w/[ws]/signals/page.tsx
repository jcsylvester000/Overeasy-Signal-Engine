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
  const countPending = (pl: string) => sb.from("signal_jobs").select("id", { count: "exact", head: true }).eq("workspace_id", ws.id).eq("platform", pl).eq("status", "dry_run").gt("value_increment", 0).is("exported_at", null);
  const [gc, mc] = rank >= 3 ? await Promise.all([countPending("google"), countPending("microsoft")]) : [{ count: 0 }, { count: 0 }];
  const pendingExport = { google: gc.count ?? 0, microsoft: mc.count ?? 0 };
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
      {rank >= 3 && (
        <Card
          title="Upload files for Google Ads and Microsoft Advertising (before API approval)"
          description="Download the stage values not yet uploaded, in each platform's offline-conversion format, and upload them in the ad account. Do this weekly. Once the API connection is live, uploads are automatic and these files are no longer needed."
          className="mb-6"
        >
          <div className="grid gap-4 md:grid-cols-2">
            {(["google", "microsoft"] as const).map((pl) => (
              <form key={pl} method="post" action={`/w/${ws.id}/offline/${pl}`} className="space-y-2 rounded-md border border-line p-3 text-sm">
                <div className="font-medium">{pl === "google" ? "Google Ads" : "Microsoft Advertising"}</div>
                <p className="text-xs text-muted">
                  {pendingExport[pl]} value update(s) waiting. {pl === "google" ? "Google Ads → Goals → Conversions → Uploads." : "Microsoft Advertising → Conversions → Offline conversions → Upload."}
                </p>
                <label className="flex flex-col gap-1 text-xs">
                  Conversion name prefix (must match the actions you created)
                  <input name="prefix" defaultValue={ws.name} />
                </label>
                <label className="flex items-center gap-2 text-xs">
                  <input type="checkbox" name="mark" defaultChecked /> Mark as exported (next file only has new rows)
                </label>
                <label className="flex items-center gap-2 text-xs">
                  <input type="checkbox" name="include_exported" /> Include rows already exported
                </label>
                <input type="hidden" name="days" value="90" />
                <Button variant="secondary">Download {pl === "google" ? "Google" : "Microsoft"} file</Button>
              </form>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted">
            Create one offline conversion per stage in each ad account, named <code>{ws.name} – Lead submitted</code>, <code>– Qualified</code>, <code>– Opportunity</code>, <code>– Contract</code>, <code>– Deal funded</code> (secondary to start). Each row carries only the increase in value, so totals never double count. Clicks older than 90 days are left out. Before the first upload, compare the column headers with the platform&apos;s current template.
          </p>
        </Card>
      )}

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
