import { requireWorkspace } from "@/lib/tenancy";
import { userClient } from "@/lib/supabase/server";
import { ScoringModel, type Condition } from "@/core/scoring/types";
import { runTests } from "@/core/scoring/evaluate";
import { Badge, Button, Card, Field, Notice, PageHeader, Table, Td, when } from "@/components/ui";
import { rollbackScoring, saveScoring } from "../actions";

export const metadata = { title: "Lead scoring" };

function describe(c: Condition): string {
  const parts: string[] = [];
  if (c.field && c.in) parts.push(`${c.field} is ${c.in.join(" / ")}`);
  if (c.field && (c.gte !== undefined || c.lte !== undefined)) parts.push(`${c.field} ${c.gte !== undefined ? `≥ ${c.gte}` : ""}${c.lte !== undefined ? ` ≤ ${c.lte}` : ""}`);
  if (c.score_gte !== undefined) parts.push(`score ≥ ${c.score_gte}`);
  if (c.score_lte !== undefined) parts.push(`score ≤ ${c.score_lte}`);
  if (c.all) parts.push(c.all.map(describe).join(" AND "));
  if (c.any) parts.push(`(${c.any.map(describe).join(" OR ")})`);
  if (c.not) parts.push(`NOT ${describe(c.not)}`);
  return parts.join(" AND ");
}

export default async function Scoring({ params, searchParams }: { params: Promise<{ ws: string }>; searchParams: Promise<{ saved?: string; error?: string }> }) {
  const { ws: wsId } = await params;
  const sp = await searchParams;
  const { ws } = await requireWorkspace(wsId, 3);
  const sb = await userClient();
  const { data: versions } = await sb.from("scoring_models").select("id,version,status,notes,published_at,created_at,model").eq("workspace_id", ws.id).order("version", { ascending: false });
  const draft = versions?.find((v) => v.status === "draft");
  const published = versions?.find((v) => v.status === "published");
  const editing = draft ?? published;
  const parsed = ScoringModel.safeParse(editing?.model);
  const m = parsed.success ? parsed.data : null;
  const tests = m ? runTests(m) : null;
  const label = (field: string, value: string) => m?.fields.find((f) => f.key === field)?.options?.find((o) => o.value === value)?.label ?? value;

  return (
    <>
      <PageHeader
        title="① Lead scoring — form value calculator"
        description="Every form lead is scored the moment it arrives. Change points below; publishing runs every test case and is blocked if any fails. Existing leads keep the score (and version) they were given."
      />
      {sp.saved && <div className="mb-4"><Notice tone="green">{sp.saved}</Notice></div>}
      {sp.error && <div className="mb-4"><Notice tone="red">{sp.error}</Notice></div>}
      {draft && <div className="mb-4"><Notice tone="amber">You are editing draft v{draft.version} (not live). Live: v{published?.version ?? "—"}.</Notice></div>}
      {!m && <Notice tone="red">The model could not be read. Use the JSON editor below to fix it.</Notice>}

      {m && (
        <form action={saveScoring.bind(null, ws.id)} className="space-y-6">
          <Card title={m.name} description={`Currency ${m.currency}. Unknown or skipped answers add 0 unless "blank" is set. The clamp applies after summing.`}>
            <div className="grid max-w-xl grid-cols-3 gap-3">
              <Field label="Base points">
                <input name="base" type="number" step="any" defaultValue={m.base} />
              </Field>
              <Field label="Minimum">
                <input name="clamp_min" type="number" step="any" defaultValue={m.clamp.min} />
              </Field>
              <Field label="Maximum (cap)">
                <input name="clamp_max" type="number" step="any" defaultValue={m.clamp.max} />
              </Field>
            </div>
          </Card>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {m.rules.map((r, i) => (
              <Card key={`${r.field}-${i}`} title={m.fields.find((f) => f.key === r.field)?.label ?? r.field} description={r.kind === "range" ? "Numeric ranges" : "Points per answer"}>
                <table className="w-full text-sm">
                  <tbody>
                    {r.kind === "map"
                      ? Object.entries(r.map).map(([k, v]) => (
                          <tr key={k}>
                            <td className="py-0.5 pr-2">{k === "blank" ? <em className="text-muted">blank</em> : label(r.field, k)}</td>
                            <td className="w-24 py-0.5">
                              <input aria-label={`${r.field} ${k}`} name={`r${i}:${k}`} type="number" step="any" defaultValue={v} className="w-24 text-right" />
                            </td>
                          </tr>
                        ))
                      : r.ranges.map((x, j) => (
                          <tr key={j}>
                            <td className="py-0.5 pr-2">
                              {x.min ?? "−∞"} to {x.max ?? "∞"}
                            </td>
                            <td className="w-24 py-0.5">
                              <input aria-label={`${r.field} range ${j}`} name={`r${i}:${j}`} type="number" step="any" defaultValue={x.points} className="w-24 text-right" />
                            </td>
                          </tr>
                        ))}
                  </tbody>
                </table>
              </Card>
            ))}
          </div>

          <Card title="Lead types" description="Checked in order; the first match wins. Edit in the JSON editor.">
            <ol className="list-decimal space-y-1 pl-5 text-sm">
              {m.leadTypes.map((lt) => (
                <li key={lt.type}>
                  <strong>{lt.type}</strong> <Badge>{lt.velocity ?? m.defaultVelocity}</Badge> — when {describe(lt.when)}
                </li>
              ))}
              <li>
                Otherwise <strong>{m.defaultLeadType}</strong>
              </li>
            </ol>
          </Card>

          <Card title="Test cases" description="Publishing is blocked unless every case produces the expected value and type.">
            <Table head={["Case", "Expected", "Got", "", "Note"]}>
              {tests?.outcomes.map((o) => (
                <tr key={o.test.name}>
                  <Td>{o.test.name}</Td>
                  <Td className="num">
                    {o.test.expect}
                    {o.test.expectType ? ` · ${o.test.expectType}` : ""}
                  </Td>
                  <Td className="num">
                    {o.got.score} · {o.got.leadType}
                  </Td>
                  <Td>{o.pass ? <Badge tone="green">pass</Badge> : <Badge tone="red">fail</Badge>}</Td>
                  <Td className="text-xs text-muted">{o.test.note}</Td>
                </tr>
              ))}
            </Table>
          </Card>

          <div className="flex flex-wrap items-end gap-3">
            <Field label="Change note">
              <input name="notes" className="w-72" placeholder="What changed and why" />
            </Field>
            <Button name="intent" value="draft" variant="secondary">
              Save draft
            </Button>
            <Button name="intent" value="publish">
              Run tests & publish
            </Button>
          </div>
        </form>
      )}

      <Card title="Advanced: edit the model as JSON" description="Fields, rules, lead-type conditions and test cases. Validated and tested on save." className="mt-6">
        <form action={saveScoring.bind(null, ws.id)} className="space-y-3">
          <textarea name="json" rows={18} className="w-full font-mono text-xs" defaultValue={JSON.stringify(editing?.model ?? {}, null, 2)} aria-label="Scoring model JSON" />
          <div className="flex gap-3">
            <Button name="intent" value="draft" variant="secondary">
              Save draft
            </Button>
            <Button name="intent" value="publish">
              Run tests & publish
            </Button>
          </div>
        </form>
      </Card>

      <Card title="Version history" className="mt-6">
        <Table head={["Version", "Status", "Published", "Note", ""]}>
          {(versions ?? []).map((v) => (
            <tr key={v.id}>
              <Td>v{v.version}</Td>
              <Td>
                <Badge tone={v.status === "published" ? "green" : v.status === "draft" ? "amber" : "gray"}>{v.status}</Badge>
              </Td>
              <Td>{when(v.published_at)}</Td>
              <Td className="text-xs">{v.notes}</Td>
              <Td>
                {v.status === "archived" && (
                  <form action={rollbackScoring.bind(null, ws.id, v.id)}>
                    <button className="text-xs text-brand hover:underline">Roll back to this</button>
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
