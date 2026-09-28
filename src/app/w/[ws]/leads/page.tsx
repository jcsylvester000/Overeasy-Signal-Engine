import Link from "next/link";
import { requireWorkspace } from "@/lib/tenancy";
import { userClient } from "@/lib/supabase/server";
import { CANONICAL_STAGES, STAGE_LABEL } from "@/core/stages";
import { Badge, Card, money, PageHeader, Table, Td, when } from "@/components/ui";

export const metadata = { title: "Leads" };

export default async function Leads({ params, searchParams }: { params: Promise<{ ws: string }>; searchParams: Promise<{ stage?: string; type?: string; page?: string }> }) {
  const { ws: wsId } = await params;
  const sp = await searchParams;
  const sb = await userClient();
  const page = Math.max(0, Number(sp.page ?? 0));
  let q = sb
    .from("leads")
    .select("id,created_at,source,form,score,score_capped,lead_type,velocity_band,canonical_stage,value_current,geo,attribution,window_expires_on,is_test", { count: "exact" })
    .eq("workspace_id", wsId)
    .order("created_at", { ascending: false })
    .range(page * 50, page * 50 + 49);
  if (sp.stage) q = q.eq("canonical_stage", sp.stage);
  if (sp.type) q = q.eq("lead_type", sp.type);
  const [{ ws }, { data: leads, count }] = await Promise.all([requireWorkspace(wsId), q]);
  const base = `/w/${ws.id}/leads`;
  const link = (p: Record<string, string | undefined>) => `${base}?${new URLSearchParams(Object.entries({ ...sp, ...p }).filter(([, v]) => v !== undefined) as [string, string][])}`;

  return (
    <>
      <PageHeader
        title="Leads"
        description="Every lead, its score, where it came from and how far it has moved. Contact details are never shown here."
        actions={
          <>
            <a className="rounded-md border border-line bg-white px-3 py-1.5 text-sm hover:bg-gray-50" href={`/w/${ws.id}/export/leads.csv?days=365`}>
              Export leads CSV
            </a>
            <a className="rounded-md border border-line bg-white px-3 py-1.5 text-sm hover:bg-gray-50" href={`/w/${ws.id}/export/signals.csv?days=365`}>
              Export signals CSV
            </a>
          </>
        }
      />
      <div className="mb-3 flex flex-wrap gap-1 text-sm">
        <Link href={link({ stage: undefined, page: undefined })} className={`rounded px-2 py-1 ${!sp.stage ? "bg-brand text-white" : "hover:bg-gray-100"}`}>
          All
        </Link>
        {CANONICAL_STAGES.map((s) => (
          <Link key={s} href={link({ stage: s, page: undefined })} className={`rounded px-2 py-1 ${sp.stage === s ? "bg-brand text-white" : "hover:bg-gray-100"}`}>
            {STAGE_LABEL[s]}
          </Link>
        ))}
      </div>
      <Card>
        <Table head={["Received", "Score", "Lead type", "Stage", "Value", "Source", "Campaign", "State", "Window closes"]} empty="No leads yet. Use the Simulator or install the tag.">
          {(leads ?? []).map((l) => {
            const a = (l.attribution ?? {}) as Record<string, string>;
            return (
              <tr key={l.id} className="hover:bg-gray-50">
                <Td>
                  <Link href={`${base}/${l.id}`} className="text-brand hover:underline">
                    {when(l.created_at)}
                  </Link>
                  {l.is_test && (
                    <span className="ml-1">
                      <Badge tone="purple">sim</Badge>
                    </span>
                  )}
                </Td>
                <Td className="num">
                  {l.score ?? "—"}
                  {l.score_capped && <span className="text-xs text-muted"> (cap)</span>}
                </Td>
                <Td>
                  {l.lead_type ? (
                    <Link href={link({ type: l.lead_type, page: undefined })} className="hover:underline">
                      {l.lead_type}
                    </Link>
                  ) : (
                    "—"
                  )}
                </Td>
                <Td>{STAGE_LABEL[l.canonical_stage as keyof typeof STAGE_LABEL] ?? l.canonical_stage}</Td>
                <Td className="num">{money(l.value_current, ws.currency)}</Td>
                <Td>{a.gclid || a.gbraid || a.wbraid ? "Google" : a.msclkid ? "Microsoft" : (a.utm_source ?? l.source)}</Td>
                <Td>{a.utm_campaign ?? "—"}</Td>
                <Td>{l.geo ?? "—"}</Td>
                <Td>{l.window_expires_on ?? "—"}</Td>
              </tr>
            );
          })}
        </Table>
        <div className="mt-3 flex items-center justify-between text-sm text-muted">
          <span>{count ?? 0} lead(s)</span>
          <span className="flex gap-3">
            {page > 0 && <Link href={link({ page: String(page - 1) })}>← Newer</Link>}
            {(count ?? 0) > (page + 1) * 50 && <Link href={link({ page: String(page + 1) })}>Older →</Link>}
          </span>
        </div>
      </Card>
    </>
  );
}
