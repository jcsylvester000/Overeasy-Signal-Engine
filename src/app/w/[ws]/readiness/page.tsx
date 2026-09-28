import { requireWorkspace } from "@/lib/tenancy";
import { readiness } from "@/server/ops";
import { Badge, Card, Notice, PageHeader } from "@/components/ui";
import { setAck } from "../ops-actions";

export const metadata = { title: "Bidding readiness" };

export default async function Readiness({ params }: { params: Promise<{ ws: string }> }) {
  const { ws: wsId } = await params;
  const { ws, rank } = await requireWorkspace(wsId, 2);
  const r = await readiness(ws.id);
  return (
    <>
      <PageHeader title="Bidding readiness" description="Switching bidding is a human decision. This checklist shows when the stage signals are trustworthy enough to bid on." />
      <div className="mb-6">{r.ready ? <Notice tone="green">All checks pass. Follow the playbook below to move bidding to stage values.</Notice> : <Notice tone="amber">Not ready yet. Keep the stage conversions as secondary (observation) until every check passes.</Notice>}</div>
      <Card title="Checklist">
        <ul className="divide-y divide-line">
          {r.checks.map((c) => (
            <li key={c.key} className="flex flex-wrap items-center justify-between gap-3 py-2">
              <span className="flex items-center gap-2 text-sm">
                <Badge tone={c.ok ? "green" : "amber"}>{c.ok ? "pass" : "open"}</Badge>
                {c.label}
              </span>
              <span className="flex items-center gap-3 text-xs text-muted">
                {c.detail}
                {c.manual && rank >= 4 && (
                  <form action={setAck.bind(null, ws.id, c.key as "privacy" | "sales")}>
                    <input type="hidden" name="value" value={c.ok ? "" : "1"} />
                    <button className="text-brand hover:underline">{c.ok ? "Undo" : "Confirm"}</button>
                  </form>
                )}
              </span>
            </li>
          ))}
        </ul>
      </Card>
      <Card title="Playbook: moving bidding to stage values" className="mt-6">
        <ol className="list-decimal space-y-2 pl-5 text-sm">
          <li>Observe for about 30 days with every stage conversion action set to <em>secondary</em>. Compare uploads with the CRM each week (Ad signals → Reconciliation).</li>
          <li>Promote Qualified and Contract (and Opportunity if volume allows) to <em>primary</em>. Keep the valued form-fill action as primary so volume stays high enough; demote the flat-value form action.</li>
          <li>Switch campaigns to <em>Maximize conversion value</em>. Add a target ROAS only after 4–6 weeks of stable value data.</li>
          <li>Move budget monthly toward campaigns and states with the best pipeline value ÷ spend, not the lowest cost per lead.</li>
          <li>Recalibrate stage probabilities and spreads quarterly (Calibration page), and re-check this list after any big change.</li>
        </ol>
        <p className="mt-3 text-xs text-muted">Thresholds are starting points (judgement), not platform rules; adjust with the account manager.</p>
      </Card>
    </>
  );
}
