import { requireWorkspace } from "@/lib/tenancy";
import { userClient } from "@/lib/supabase/server";
import { CANONICAL_STAGES, STAGE_LABEL } from "@/core/stages";
import { Button, Card, Field, Notice, PageHeader, Table, Td } from "@/components/ui";
import { addStageMap, saveStageMaps } from "../actions";

export const metadata = { title: "CRM stages" };

export default async function Stages({ params, searchParams }: { params: Promise<{ ws: string }>; searchParams: Promise<{ saved?: string; error?: string }> }) {
  const { ws: wsId } = await params;
  const sp = await searchParams;
  const { ws } = await requireWorkspace(wsId, 3);
  const sb = await userClient();
  const { data: maps } = await sb.from("stage_maps").select("*").eq("workspace_id", ws.id).order("provider").order("pipeline_name").order("stage_name");
  const rules = ((ws.settings as { stageEntryRules?: Record<string, string> }).stageEntryRules ?? {}) as Record<string, string>;
  const options = [...CANONICAL_STAGES, "ignore"] as const;

  return (
    <>
      <PageHeader
        title="② Follow the lead — CRM stage mapping"
        description="Every CRM pipeline stage maps to one standard ladder. Two pipelines can map to the same stages. New CRM stages appear here automatically (as “ignore”) the first time a webhook mentions them."
      />
      {sp.saved && <div className="mb-4"><Notice tone="green">{sp.saved}</Notice></div>}
      {sp.error && <div className="mb-4"><Notice tone="red">{sp.error}</Notice></div>}

      <Card title="Stage entry rules" description="One objective rule per stage so any two reps would move the same lead the same way. Agree these with the sales team." className="mb-6">
        <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[140px_1fr]">
          {Object.entries(rules).map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="font-medium">{STAGE_LABEL[k as keyof typeof STAGE_LABEL] ?? k}</dt>
              <dd className="text-muted">{v}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card title="Mappings">
        <form action={saveStageMaps.bind(null, ws.id)}>
          <Table head={["CRM", "Pipeline", "CRM stage", "Maps to"]} empty="No CRM stages yet. They appear after the CRM is connected, or add one below.">
            {(maps ?? []).map((m) => (
              <tr key={m.id}>
                <Td>{m.provider}</Td>
                <Td>{m.pipeline_name ?? <span className="font-mono text-xs">{m.pipeline_id}</span>}</Td>
                <Td>{m.stage_name ?? <span className="font-mono text-xs">{m.stage_id}</span>}</Td>
                <Td>
                  <select name={`map:${m.id}`} defaultValue={m.canonical_stage} aria-label={`Map ${m.stage_name ?? m.stage_id}`}>
                    {options.map((o) => (
                      <option key={o} value={o}>
                        {o === "ignore" ? "— ignore —" : STAGE_LABEL[o]}
                      </option>
                    ))}
                  </select>
                </Td>
              </tr>
            ))}
          </Table>
          {!!maps?.length && <Button className="mt-3">Save mapping</Button>}
        </form>
      </Card>

      <Card title="Add a CRM stage manually" className="mt-6">
        <form action={addStageMap.bind(null, ws.id)} className="grid gap-3 sm:grid-cols-4">
          <Field label="CRM">
            <select name="provider" defaultValue="ghl">
              <option value="ghl">GoHighLevel</option>
              <option value="generic">Generic webhook / API</option>
            </select>
          </Field>
          <Field label="Pipeline ID">
            <input name="pipeline_id" required />
          </Field>
          <Field label="Pipeline name">
            <input name="pipeline_name" />
          </Field>
          <Field label="Stage ID">
            <input name="stage_id" required />
          </Field>
          <Field label="Stage name">
            <input name="stage_name" />
          </Field>
          <Field label="Maps to">
            <select name="canonical_stage" defaultValue="qualified">
              {options.map((o) => (
                <option key={o} value={o}>
                  {o === "ignore" ? "— ignore —" : STAGE_LABEL[o]}
                </option>
              ))}
            </select>
          </Field>
          <div className="flex items-end">
            <Button variant="secondary">Add</Button>
          </div>
        </form>
      </Card>
    </>
  );
}
