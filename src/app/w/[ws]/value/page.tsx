import { requireWorkspace } from "@/lib/tenancy";
import { publishedScoring, publishedValue } from "@/server/models";
import { validateLadder } from "@/core/value/engine";
import { RUNGS, STAGE_LABEL } from "@/core/stages";
import { Button, Card, Field, money, Notice, PageHeader, Table, Td } from "@/components/ui";
import { saveValue } from "../actions";

export const metadata = { title: "Value ladder" };

export default async function Value({ params, searchParams }: { params: Promise<{ ws: string }>; searchParams: Promise<{ saved?: string; error?: string }> }) {
  const { ws: wsId } = await params;
  const sp = await searchParams;
  const { ws } = await requireWorkspace(wsId, 3);
  const [value, scoring] = await Promise.all([publishedValue(ws.id), publishedScoring(ws.id)]);
  if (!value) return <Notice tone="red">No value model is published.</Notice>;
  const m = value.model;
  const scoreMax = scoring?.model.clamp.max ?? 0;
  const check = validateLadder(m, scoreMax);
  const types = Object.keys(m.spreads);
  const top = Math.max(1, ...check.rows.map((r) => r.max));

  return (
    <>
      <PageHeader
        title="⑤ Value ladder — what each stage is worth"
        description="Value at a stage = chance the lead funds × expected profit (spread) for its lead type. Every stage is worth more than the one before, only the increase is uploaded, and nothing is sent after the platform's 90-day click window."
      />
      {sp.saved && <div className="mb-4"><Notice tone="green">{sp.saved}</Notice></div>}
      {sp.error && <div className="mb-4"><Notice tone="red">{sp.error}</Notice></div>}
      {check.issues.map((i) => (
        <div key={i.message} className="mb-2">
          <Notice tone={i.level === "error" ? "red" : "amber"}>{i.message}</Notice>
        </div>
      ))}

      <Card title={`Live ladder (v${value.version})`} description="Cumulative value per lead type at each stage." className="mb-6">
        <Table head={["Stage", ...types, "Floor", "Cap", ""]}>
          {check.rows.map((r) => (
            <tr key={r.stage}>
              <Td className="font-medium">{STAGE_LABEL[r.stage]}</Td>
              {types.map((t) => (
                <Td key={t} className="num">
                  {r.stage === "submitted" && m.formRung.mode === "score" ? `score (≤ ${money(r.max, m.currency)})` : money(r.byType[t], m.currency)}
                </Td>
              ))}
              <Td className="num text-muted">{r.floor ? money(r.floor, m.currency) : "—"}</Td>
              <Td className="num text-muted">{r.cap !== null ? money(r.cap, m.currency) : "—"}</Td>
              <Td className="w-40">
                <span className="block h-2 rounded bg-gray-100">
                  <span className="block h-2 rounded bg-brand" style={{ width: `${(r.max / top) * 100}%` }} />
                </span>
              </Td>
            </tr>
          ))}
        </Table>
        <p className="mt-2 text-xs text-muted">
          Uploaded stages: {m.uploadStages.map((s) => STAGE_LABEL[s]).join(", ")}. Form rung mode: {m.formRung.mode}. Windows: Google {m.windows.googleClickDays} d (hashed-data-only {m.windows.googleEnhancedLeadsDays} d), Microsoft {m.windows.microsoftClickDays} d.
        </p>
      </Card>

      <form action={saveValue.bind(null, ws.id)} className="space-y-6">
        <input type="hidden" name="types" value={types.join("|")} />
        <Card title="Chance of funding by stage (%)" description="From the client's funded history. Placeholders until real data is supplied; recalibrate quarterly.">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
            {RUNGS.map((r) => (
              <Field key={r} label={STAGE_LABEL[r]}>
                <input name={`p:${r}`} type="number" min="0" max="100" step="0.1" defaultValue={+(m.stageProbs[r] * 100).toFixed(2)} />
              </Field>
            ))}
          </div>
        </Card>
        <Card title="Expected spread (profit) by lead type" description={`In ${m.currency}. "default" applies to any type not listed.`}>
          <div className="grid gap-3 sm:grid-cols-3">
            {types.map((t) => (
              <div key={t} className="flex items-end gap-2">
                <Field label={t}>
                  <input name={`spread:${t}`} type="number" min="0" step="1" defaultValue={m.spreads[t]} />
                </Field>
                {t !== "default" && (
                  <label className="mb-2 flex items-center gap-1 text-xs text-muted">
                    <input type="checkbox" name={`remove:${t}`} /> remove
                  </label>
                )}
              </div>
            ))}
            <div className="flex items-end gap-2">
              <Field label="Add lead type">
                <input name="new_type" placeholder="Type name" />
              </Field>
              <Field label="Spread">
                <input name="new_spread" type="number" min="0" step="1" className="w-28" />
              </Field>
            </div>
          </div>
        </Card>
        <Card title="Caps, form rung and uploads">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
            {RUNGS.map((r) => (
              <Field key={r} label={`Cap: ${STAGE_LABEL[r]}`}>
                <input name={`cap:${r}`} type="number" min="0" step="1" defaultValue={m.caps[r] ?? ""} placeholder="none" />
              </Field>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap items-end gap-4">
            <Field label="Form rung value">
              <select name="form_mode" defaultValue={m.formRung.mode}>
                <option value="score">Use the lead score</option>
                <option value="calibrated">Calibrated: P(submitted) × spread</option>
                <option value="fixed">Fixed value</option>
              </select>
            </Field>
            <Field label="Fixed value">
              <input name="form_fixed" type="number" min="0" step="0.01" defaultValue={m.formRung.fixedValue ?? ""} className="w-28" />
            </Field>
            <fieldset className="flex flex-wrap gap-3">
              <legend className="mb-1 text-xs font-medium">Upload these stages</legend>
              {RUNGS.map((r) => (
                <label key={r} className="flex items-center gap-1">
                  <input type="checkbox" name={`up:${r}`} defaultChecked={m.uploadStages.includes(r)} /> {STAGE_LABEL[r]}
                </label>
              ))}
            </fieldset>
            <label className="flex items-center gap-1">
              <input type="checkbox" name="true_up" defaultChecked={m.trueUpFunded} /> True-up at funded with the actual spread
            </label>
          </div>
        </Card>
        <div className="flex items-end gap-3">
          <Field label="Change note">
            <input name="notes" className="w-72" />
          </Field>
          <Button>Validate & publish</Button>
        </div>
      </form>
    </>
  );
}
