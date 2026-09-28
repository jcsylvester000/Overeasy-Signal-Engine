import { requireWorkspace } from "@/lib/tenancy";
import { userClient } from "@/lib/supabase/server";
import { Button, Card, money, Notice, PageHeader, Table, Td } from "@/components/ui";
import { syncSpendNow, uploadSpend } from "../ops-actions";

export const metadata = { title: "Ad spend" };

export default async function Spend({ params, searchParams }: { params: Promise<{ ws: string }>; searchParams: Promise<{ saved?: string; error?: string }> }) {
  const { ws: wsId } = await params;
  const sp = await searchParams;
  const { ws, rank } = await requireWorkspace(wsId, 2);
  const sb = await userClient();
  const { data } = await sb.from("ad_spend_daily").select("*").eq("workspace_id", ws.id).order("date", { ascending: false }).limit(200);
  return (
    <>
      <PageHeader
        title="Ad spend"
        description="Daily spend by platform and campaign. Synced automatically from connected ad accounts once they are live; import a CSV until then."
        actions={
          <>
            <a className="rounded-md border border-line bg-white px-3 py-1.5 text-sm hover:bg-gray-50" href={`/w/${ws.id}/export/spend.csv?days=365`}>
              Export CSV
            </a>
            {rank >= 3 && (
              <form action={syncSpendNow.bind(null, ws.id)}>
                <Button variant="secondary">Sync now</Button>
              </form>
            )}
          </>
        }
      />
      {sp.saved && <div className="mb-4"><Notice tone="green">{sp.saved}</Notice></div>}
      {sp.error && <div className="mb-4"><Notice tone="red">{sp.error}</Notice></div>}
      {rank >= 3 && (
        <Card title="Import a CSV" description='Header row with at least "date" and "cost". Optional: platform (google / microsoft), campaign, campaign_id, clicks, impressions, geo, adgroup_id. Dates as YYYY-MM-DD or MM/DD/YYYY. Re-importing the same day and campaign replaces it.' className="mb-6">
          <form action={uploadSpend.bind(null, ws.id)} className="flex flex-wrap items-center gap-3">
            <input type="file" name="file" accept=".csv,text/csv" required aria-label="Spend CSV" />
            <Button>Import</Button>
          </form>
          <pre className="mt-3 overflow-x-auto rounded bg-gray-50 p-2 text-xs">{`date,platform,campaign,cost,clicks,impressions,geo
2026-09-27,google,Search – Sell Land,412.50,318,9120,TX
2026-09-27,microsoft,Search – Sell Land,96.10,74,2210,TX`}</pre>
        </Card>
      )}
      <Card>
        <Table head={["Date", "Platform", "Campaign", "Geo", "Cost", "Clicks", "Impr."]} empty="No spend yet.">
          {(data ?? []).map((r) => (
            <tr key={`${r.date}${r.platform}${r.campaign_id}${r.adgroup_id}${r.geo}`}>
              <Td>{r.date}</Td>
              <Td>{r.platform}</Td>
              <Td>{r.campaign ?? r.campaign_id}</Td>
              <Td>{r.geo || "—"}</Td>
              <Td className="num">{money(r.cost, ws.currency)}</Td>
              <Td className="num">{r.clicks}</Td>
              <Td className="num">{r.impressions}</Td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
