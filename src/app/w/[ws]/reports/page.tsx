import Link from "next/link";
import { requireWorkspace } from "@/lib/tenancy";
import { deepReports } from "@/server/reports";
import { Card, money, PageHeader, Table, Td } from "@/components/ui";

export const metadata = { title: "Reports" };

const d = (x: number | null) => (x === null ? "—" : x < 1 ? "< 1" : x.toFixed(0));
const p = (x: number | null) => (x === null ? "—" : `${(x * 100).toFixed(0)}%`);

export default async function Reports({ params, searchParams }: { params: Promise<{ ws: string }>; searchParams: Promise<{ days?: string }> }) {
  const { ws: wsId } = await params;
  const sp = await searchParams;
  const days = [30, 90, 180, 365].includes(Number(sp.days)) ? Number(sp.days) : 90;
  const [{ ws }, r] = await Promise.all([requireWorkspace(wsId, 2), deepReports(wsId, days, true)]);
  const maxBand = Math.max(1, ...r.scoreBands.map((b) => b.leads));
  return (
    <>
      <PageHeader
        title="Reports"
        description="Velocity, score quality and wasted spend."
        actions={
          <div className="flex gap-1 text-sm">
            {[30, 90, 180, 365].map((n) => (
              <Link key={n} href={`?days=${n}`} className={`rounded px-2 py-1 ${n === days ? "bg-brand text-white" : "hover:bg-gray-100"}`}>
                {n}d
              </Link>
            ))}
          </div>
        }
      />
      <div className="space-y-6">
        <Card title="Velocity: days from ad click to each stage" description="Median / 75th percentile by lead type. Slow types (e.g. title or probate) need nurture, and their value must be sent before the 90-day upload limit.">
          <Table head={["Lead type", "Leads", "→ Qualified", "→ Opportunity", "→ Contract", "→ Funded"]} empty="No leads in this period.">
            {r.velocity.map((v) => (
              <tr key={v.type}>
                <Td className="font-medium">{v.type}</Td>
                <Td className="num">{v.leads}</Td>
                {(["qualified", "opportunity", "contract", "funded"] as const).map((s) => (
                  <Td key={s} className="num">
                    {v[s].n ? (
                      <>
                        {d(v[s].median)} / {d(v[s].p75)} <span className="text-xs text-muted">(n={v[s].n})</span>
                      </>
                    ) : (
                      "—"
                    )}
                  </Td>
                ))}
              </tr>
            ))}
          </Table>
        </Card>

        <Card title="Does the score predict outcomes?" description={`Conversion rates by initial score band. Score cap hit on ${(r.capHitRate * 100).toFixed(0)}% of leads — if high, the cap is hiding differences between the best leads.`}>
          <Table head={["Score band", "Leads", "", "Qualified", "Contract", "Funded"]}>
            {r.scoreBands.map((b) => (
              <tr key={b.band}>
                <Td className="font-medium">{b.band}</Td>
                <Td className="num">{b.leads}</Td>
                <Td className="w-40">
                  <span className="block h-2 rounded bg-gray-100">
                    <span className="block h-2 rounded bg-brand" style={{ width: `${(b.leads / maxBand) * 100}%` }} />
                  </span>
                </Td>
                <Td className="num">{p(b.qualifiedRate)}</Td>
                <Td className="num">{p(b.contractRate)}</Td>
                <Td className="num">{p(b.fundedRate)}</Td>
              </tr>
            ))}
          </Table>
        </Card>

        <Card title="Spend on dead leads, by reason" description="Campaign spend allocated evenly to that campaign's leads, summed for leads marked lost.">
          <Table head={["Lost reason", "Leads", "Spend"]} empty="No lost leads with spend in this period.">
            {r.deadByReason.map((x) => (
              <tr key={x.reason}>
                <Td>{x.reason}</Td>
                <Td className="num">{x.leads}</Td>
                <Td className="num">{money(x.spend, ws.currency)}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
    </>
  );
}
