import { requireWorkspace } from "@/lib/tenancy";
import { calibrationFor } from "@/server/ops";
import { RUNGS, STAGE_LABEL } from "@/core/stages";
import { Button, Card, money, Notice, PageHeader, Table, Td } from "@/components/ui";
import { applyCalibration } from "../ops-actions";

export const metadata = { title: "Calibration" };

export default async function Calibration({ params, searchParams }: { params: Promise<{ ws: string }>; searchParams: Promise<{ saved?: string; error?: string }> }) {
  const { ws: wsId } = await params;
  const sp = await searchParams;
  const { ws } = await requireWorkspace(wsId, 3);
  const c = await calibrationFor(ws.id);
  if (!c) return <Notice tone="red">No value model is published.</Notice>;
  const p = c.proposal;
  const changes = RUNGS.some((r) => p.stageProbs[r].proposed !== null && p.stageProbs[r].proposed !== p.stageProbs[r].current) || Object.values(p.spreads).some((s) => s.proposed !== null && s.proposed !== s.current);
  const pct = (n: number | null) => (n === null ? "—" : `${(n * 100).toFixed(1)}%`);

  return (
    <>
      <PageHeader
        title="Calibration"
        description="Re-estimates each stage's chance of funding and each lead type's average spread from real outcomes (simulated leads excluded). Only values with enough data change, and nothing is applied until you approve it. Recommended quarterly."
      />
      {sp.saved && <div className="mb-4"><Notice tone="green">{sp.saved}</Notice></div>}
      {sp.error && <div className="mb-4"><Notice tone="red">{sp.error}</Notice></div>}
      <p className="mb-4 text-sm text-muted">
        {c.total} real lead(s) in the last 12 months · {p.sample} matured (funded, lost, or older than 120 days).
      </p>
      {p.warnings.map((w) => (
        <div key={w} className="mb-2">
          <Notice tone="amber">{w}</Notice>
        </div>
      ))}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Chance of funding by stage">
          <Table head={["Stage", "Current", "Proposed", "Sample"]}>
            {RUNGS.map((r) => (
              <tr key={r}>
                <Td>{STAGE_LABEL[r]}</Td>
                <Td className="num">{pct(p.stageProbs[r].current)}</Td>
                <Td className="num font-medium">{pct(p.stageProbs[r].proposed)}</Td>
                <Td className="num">{p.stageProbs[r].n}</Td>
              </tr>
            ))}
          </Table>
        </Card>
        <Card title="Average spread by lead type" description="From funded deals with an actual value recorded.">
          <Table head={["Lead type", "Current", "Proposed", "Funded deals"]}>
            {Object.entries(p.spreads).map(([t, s]) => (
              <tr key={t}>
                <Td>{t}</Td>
                <Td className="num">{s.current === null ? "—" : money(s.current, ws.currency)}</Td>
                <Td className="num font-medium">{s.proposed === null ? "—" : money(s.proposed, ws.currency)}</Td>
                <Td className="num">{s.n}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
      <form action={applyCalibration.bind(null, ws.id)} className="mt-6">
        <Button disabled={!changes}>{changes ? "Approve & publish calibrated values" : "Nothing to change yet"}</Button>
      </form>
    </>
  );
}
