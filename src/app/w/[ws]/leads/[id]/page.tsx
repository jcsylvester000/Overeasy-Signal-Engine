import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/tenancy";
import { nowMs } from "@/lib/time";
import { userClient } from "@/lib/supabase/server";
import { CANONICAL_STAGES, STAGE_LABEL } from "@/core/stages";
import { ScoringModel } from "@/core/scoring/types";
import { evaluate } from "@/core/scoring/evaluate";
import { Badge, Button, Card, Field, Json, money, Notice, PageHeader, Status, Table, Td, when } from "@/components/ui";
import { ageTestLead, moveStage } from "../../actions";

export const metadata = { title: "Lead" };

export default async function LeadDetail({ params, searchParams }: { params: Promise<{ ws: string; id: string }>; searchParams: Promise<{ saved?: string; error?: string }> }) {
  const { ws: wsId, id } = await params;
  const sp = await searchParams;
  const { ws, rank } = await requireWorkspace(wsId);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const sb = await userClient();
  const { data: lead } = await sb.from("leads").select("*").eq("id", id).eq("workspace_id", ws.id).maybeSingle();
  if (!lead) notFound();
  const [{ data: events }, { data: jobs }, { data: links }, { data: model }] = await Promise.all([
    sb.from("stage_events").select("*").eq("lead_id", id).order("occurred_at"),
    sb.from("signal_jobs").select("*").eq("lead_id", id).order("created_at"),
    sb.from("crm_links").select("*").eq("lead_id", id),
    sb.from("scoring_models").select("model,version").eq("workspace_id", ws.id).eq("version", lead.score_version ?? -1).maybeSingle(),
  ]);
  const parsed = ScoringModel.safeParse(model?.model);
  const breakdown = parsed.success ? evaluate(parsed.data, lead.answers ?? {}).breakdown : [];
  const a = (lead.attribution ?? {}) as Record<string, string>;
  const clickAge = lead.click_ts ? Math.floor((nowMs() - new Date(lead.click_ts).getTime()) / 86_400_000) : null;

  return (
    <>
      <PageHeader
        title={`Lead ${String(lead.id).slice(0, 8)}`}
        description={
          <>
            {when(lead.created_at)} · {lead.form ?? lead.source} {lead.is_test && <Badge tone="purple">simulated</Badge>}
          </>
        }
      />
      {sp.saved && <div className="mb-4"><Notice tone="green">{sp.saved}</Notice></div>}
      {sp.error && <div className="mb-4"><Notice tone="red">{sp.error}</Notice></div>}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="① Score" description={`Model v${lead.score_version ?? "—"}`}>
          <div className="num text-3xl font-semibold">{lead.score ?? "—"}</div>
          <div className="mt-1 text-sm">
            {lead.lead_type ?? "—"} · velocity {lead.velocity_band ?? "—"}
            {lead.score_capped && <span className="text-muted"> · raw {lead.score_raw} (capped)</span>}
          </div>
          <ul className="mt-3 space-y-0.5 text-xs">
            {breakdown.map((b) => (
              <li key={b.field} className="flex justify-between">
                <span>
                  {b.field}: <span className="text-muted">{b.answer ?? "(blank)"}</span>
                </span>
                <span className="num">{b.points > 0 ? `+${b.points}` : b.points}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="② Stage & value">
          <div className="text-sm">
            Current stage: <strong>{STAGE_LABEL[lead.canonical_stage as keyof typeof STAGE_LABEL]}</strong>
            {lead.lost_reason && <span className="text-muted"> ({lead.lost_reason})</span>}
          </div>
          <div className="num mt-2 text-2xl font-semibold">{money(lead.value_current, lead.currency)}</div>
          <div className="text-xs text-muted">expected value now</div>
          <div className="mt-3 text-xs">
            Click age: {clickAge === null ? "no click" : `${clickAge} days`} · upload window closes {lead.window_expires_on ?? "—"}
          </div>
          <div className="mt-2 text-xs">
            CRM:{" "}
            {(links ?? []).length
              ? (links ?? []).map((l) => (
                  <span key={l.id} className="mr-2 font-mono">
                    {l.provider}:{l.contact_id ?? l.opportunity_id}
                  </span>
                ))
              : "not linked yet"}
          </div>
        </Card>
        <Card title="Attribution" description="Bound on the server at submit.">
          <dl className="grid grid-cols-[110px_1fr] gap-x-2 gap-y-0.5 text-xs">
            {Object.entries(a).map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted">{k}</dt>
                <dd className="truncate font-mono">{String(v)}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-2 text-xs text-muted">
            Consent: ad_user_data {lead.consent?.ad_user_data ?? "unknown"}, ad_personalization {lead.consent?.ad_personalization ?? "unknown"}
          </div>
        </Card>
      </div>

      {rank >= 3 && (
        <Card title="Move this lead" description="Normally the CRM does this through webhooks. Use it for testing or for CRMs without a connector." className="mt-6">
          <form action={moveStage.bind(null, ws.id, lead.id)} className="flex flex-wrap items-end gap-3">
            <Field label="New stage">
              <select name="stage" defaultValue="qualified">
                {CANONICAL_STAGES.map((s) => (
                  <option key={s} value={s}>
                    {STAGE_LABEL[s]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Actual spread (funded only)">
              <input name="actual_value" type="number" min="0" step="0.01" className="w-40" />
            </Field>
            <Field label="Lost reason">
              <input name="lost_reason" className="w-40" />
            </Field>
            <Button>Record stage</Button>
          </form>
          {lead.is_test && lead.click_ts && (
            <form action={ageTestLead.bind(null, ws.id, lead.id)} className="mt-4 flex items-end gap-3 border-t border-line pt-4">
              <Field label="Simulate time passing (days)" hint="Moves the click into the past to demo the 90-day window guard.">
                <input name="days" type="number" min="1" max="365" defaultValue="30" className="w-28" />
              </Field>
              <Button variant="secondary">Age click</Button>
            </form>
          )}
        </Card>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="Stage history">
          <Table head={["When", "Stage", "Source", "Actual"]}>
            {(events ?? []).map((e) => (
              <tr key={e.id}>
                <Td>{when(e.occurred_at)}</Td>
                <Td>{STAGE_LABEL[e.canonical_stage as keyof typeof STAGE_LABEL]}</Td>
                <Td>{e.source}</Td>
                <Td className="num">{e.actual_value ? money(e.actual_value, lead.currency) : ""}</Td>
              </tr>
            ))}
          </Table>
        </Card>
        <Card title="⑤ Signals to Google & Microsoft" description="Only the increase over what was already sent is uploaded.">
          <Table head={["Platform", "Stage", "Increment", "Cumulative", "Status", "Payload"]} empty="No signals (no ad connection, or nothing new to send).">
            {(jobs ?? []).map((j) => (
              <tr key={j.id}>
                <Td>{j.platform}</Td>
                <Td>{j.canonical_stage}</Td>
                <Td className="num">{money(j.value_increment, j.currency)}</Td>
                <Td className="num">{money(j.cumulative_after, j.currency)}</Td>
                <Td>
                  <Status value={j.status} />
                  {j.error && <div className="mt-1 max-w-56 text-xs text-muted">{j.error}</div>}
                </Td>
                <Td>
                  <Json value={j.request} />
                </Td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
    </>
  );
}
