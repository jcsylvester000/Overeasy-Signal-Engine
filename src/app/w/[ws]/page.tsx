import Link from "next/link";
import { requireWorkspace } from "@/lib/tenancy";
import { overview, type Row } from "@/server/reports";
import { STAGE_LABEL } from "@/core/stages";
import { Card, money, Notice, PageHeader, Stat, Status, Table, Td } from "@/components/ui";

export const metadata = { title: "Overview" };

function Breakdown({ rows, currency, spend }: { rows: Row[]; currency: string; spend?: boolean }) {
  return (
    <Table head={["", "Leads", "Qualified", "Contract", "Funded", "Lost", "Avg score", "Days → contract", "Pipeline value", ...(spend ? ["Spend", "Value / spend"] : [])]} empty="No leads in this period.">
      {rows.map((r) => (
        <tr key={r.key}>
          <Td className="font-medium">{r.key}</Td>
          <Td className="num">{r.leads}</Td>
          <Td className="num">{r.qualified}</Td>
          <Td className="num">{r.contract}</Td>
          <Td className="num">{r.funded}</Td>
          <Td className="num">{r.lost}</Td>
          <Td className="num">{r.avgScore === null ? "—" : r.avgScore.toFixed(0)}</Td>
          <Td className="num">{r.medianDaysToContract === null ? "—" : r.medianDaysToContract.toFixed(0)}</Td>
          <Td className="num">{money(r.value, currency)}</Td>
          {spend && <Td className="num">{r.spend ? money(r.spend, currency) : "—"}</Td>}
          {spend && <Td className="num">{r.spend ? `${(r.value / r.spend).toFixed(1)}×` : "—"}</Td>}
        </tr>
      ))}
    </Table>
  );
}

export default async function Overview({ params, searchParams }: { params: Promise<{ ws: string }>; searchParams: Promise<{ days?: string; test?: string; denied?: string }> }) {
  const { ws: wsId } = await params;
  const sp = await searchParams;
  const { ws } = await requireWorkspace(wsId);
  const days = [7, 30, 90, 365].includes(Number(sp.days)) ? Number(sp.days) : 30;
  const includeTest = sp.test !== "0";
  const r = await overview(ws.id, days, includeTest);
  const max = Math.max(1, ...r.funnel.map((f) => f.count));
  const qs = (d: number, t: boolean) => `?days=${d}&test=${t ? 1 : 0}`;

  return (
    <>
      <PageHeader
        title="Spend → leads → deals → value"
        description="Volume, quality, velocity, value and final outcome — not just cost per lead."
        actions={
          <div className="flex flex-wrap items-center gap-1 text-sm">
            {[7, 30, 90, 365].map((d) => (
              <Link key={d} href={qs(d, includeTest)} className={`rounded px-2 py-1 ${d === days ? "bg-brand text-white" : "hover:bg-gray-100"}`}>
                {d}d
              </Link>
            ))}
            <Link href={qs(days, !includeTest)} className="ml-2 rounded border border-line px-2 py-1 hover:bg-gray-50">
              {includeTest ? "Hide simulated" : "Show simulated"}
            </Link>
          </div>
        }
      />
      {sp.denied && <Notice tone="amber">Your role does not allow that page.</Notice>}
      {includeTest && r.testLeads > 0 && <div className="mb-4"><Notice>Includes {r.testLeads} simulated lead(s).</Notice></div>}

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Ad spend" value={r.spendTotal ? money(r.spendTotal, ws.currency) : "—"} hint={r.spendTotal ? undefined : "Spend sync starts after ad-account approval"} />
        <Stat label="Leads" value={r.leads} hint={r.spendTotal && r.leads ? `CPL ${money(r.spendTotal / r.leads, ws.currency)}` : undefined} />
        <Stat label="Contracts" value={r.funnel[3].count} hint={r.spendTotal && r.funnel[3].count ? `Cost / contract ${money(r.spendTotal / r.funnel[3].count, ws.currency)}` : undefined} />
        <Stat label="Pipeline value" value={money(r.totalValue, ws.currency)} hint="Expected value at current stages" />
        <Stat label="Spend on lost leads" value={r.spendTotal ? money(r.deadSpend, ws.currency) : "—"} hint={`${r.lost} lost lead(s)`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Funnel" className="lg:col-span-2">
          <ol className="space-y-2">
            {r.funnel.map((f, i) => (
              <li key={f.stage} className="grid grid-cols-[120px_1fr_90px] items-center gap-3 text-sm">
                <span>{STAGE_LABEL[f.stage]}</span>
                <span className="h-5 rounded bg-gray-100">
                  <span className="block h-5 rounded bg-brand" style={{ width: `${(f.count / max) * 100}%`, opacity: 1 - i * 0.1 }} />
                </span>
                <span className="num text-right">
                  {f.count}
                  {i > 0 && r.funnel[i - 1].count ? <span className="text-xs text-muted"> ({Math.round((f.count / r.funnel[i - 1].count) * 100)}%)</span> : null}
                </span>
              </li>
            ))}
          </ol>
        </Card>
        <Card title="Signals to ad platforms" description={`Last ${days} days`}>
          <ul className="space-y-1.5 text-sm">
            {r.signals.map((s) => (
              <li key={s.status} className="flex items-center justify-between">
                <Status value={s.status} />
                <span className="num">
                  {s.n} · {money(s.value, ws.currency)}
                </span>
              </li>
            ))}
            {!r.signals.length && <li className="text-muted">No signals yet.</li>}
          </ul>
          <p className="mt-3 text-xs text-muted">Score cap hit on {(r.capHitRate * 100).toFixed(0)}% of leads.</p>
        </Card>
      </div>

      <div className="mt-6 space-y-6">
        <Card title="By lead type" description="Quality and speed: which lead types become contracts, and how fast.">
          <Breakdown rows={r.byType} currency={ws.currency} />
        </Card>
        <Card title="By campaign" description="Which campaigns bring deals, not just leads.">
          <Breakdown rows={r.byCampaign} currency={ws.currency} spend />
        </Card>
        <div className="grid gap-6 lg:grid-cols-2">
          <Card title="By platform">
            <Breakdown rows={r.byPlatform} currency={ws.currency} />
          </Card>
          <Card title="By state / location">
            <Breakdown rows={r.byGeo} currency={ws.currency} />
          </Card>
        </div>
      </div>
    </>
  );
}
