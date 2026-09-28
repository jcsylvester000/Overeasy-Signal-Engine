import Link from "next/link";
import { requireWorkspace } from "@/lib/tenancy";
import { userClient } from "@/lib/supabase/server";
import { nowMs } from "@/lib/time";
import { analyzeSpend, platformKey, type Grain, type LeadRow, type Metrics, type SpendRow } from "@/core/spend-analytics";
import { HBars, Legend, StackedBarLine } from "@/components/charts";
import { Badge, Button, Card, money, Notice, PageHeader, Stat, Table, Td } from "@/components/ui";
import { syncSpendNow, uploadSpend } from "../ops-actions";

export const metadata = { title: "Ad spend" };

const RANGES = [7, 30, 90, 180, 365];
const VIEWS = [
  { id: "overview", label: "Overview" },
  { id: "platforms", label: "Platforms" },
  { id: "campaigns", label: "Campaigns" },
  { id: "data", label: "Daily data" },
] as const;
const PAGE_SIZE = 30;
const PLATFORM_LABEL: Record<string, string> = { google: "Google Ads", microsoft: "Microsoft Ads", other: "Other" };

type SP = { saved?: string; error?: string; view?: string; days?: string; grain?: string; platform?: string; campaign?: string; page?: string; sort?: string };

export default async function Spend({ params, searchParams }: { params: Promise<{ ws: string }>; searchParams: Promise<SP> }) {
  const { ws: wsId } = await params;
  const sp = await searchParams;
  const { ws, rank } = await requireWorkspace(wsId, 2);
  const sb = await userClient();

  const view = VIEWS.some((v) => v.id === sp.view) ? (sp.view as (typeof VIEWS)[number]["id"]) : "overview";
  const days = RANGES.includes(Number(sp.days)) ? Number(sp.days) : 30;
  const grain: Grain = sp.grain === "day" || sp.grain === "week" || sp.grain === "month" ? sp.grain : days <= 30 ? "day" : days <= 180 ? "week" : "month";
  const platform = sp.platform === "google" || sp.platform === "microsoft" ? sp.platform : "all";
  const campaignFilter = sp.campaign?.slice(0, 200) || "";
  const page = Math.max(0, Number(sp.page ?? 0) || 0);
  const from = new Date(nowMs() - days * 86_400_000).toISOString();
  const fmt = (n: number) => money(n, ws.currency);
  const cur = (n: number | null, digits = 2) => (n === null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: ws.currency, maximumFractionDigits: digits }).format(n));
  const pct = (n: number | null) => (n === null ? "—" : `${(n * 100).toFixed(2)}%`);
  const x = (n: number | null) => (n === null ? "—" : `${n.toFixed(1)}×`);

  // Spend (all rows in range for analytics; the Daily data view paginates separately).
  let sq = sb.from("ad_spend_daily").select("date,platform,campaign,campaign_id,cost,clicks,impressions").eq("workspace_id", ws.id).gte("date", from.slice(0, 10)).limit(20000);
  if (platform !== "all") sq = sq.eq("platform", platform);
  if (campaignFilter) sq = sq.or(`campaign.eq.${JSON.stringify(campaignFilter)},campaign_id.eq.${JSON.stringify(campaignFilter)}`);
  const leadsQ = sb.from("leads").select("created_at,canonical_stage,value_current,attribution").eq("workspace_id", ws.id).eq("is_test", false).gte("created_at", from).limit(20000);
  const [{ data: spendRaw }, { data: leadsRaw }] = await Promise.all([sq, leadsQ]);

  const spend: SpendRow[] = (spendRaw ?? []).map((r) => ({ ...r, cost: Number(r.cost), clicks: Number(r.clicks), impressions: Number(r.impressions) }));
  const leads: LeadRow[] = (leadsRaw ?? [])
    .map((l) => {
      const a = (l.attribution ?? {}) as Record<string, string>;
      const p = a.gclid || a.gbraid || a.wbraid ? "google" : a.msclkid ? "microsoft" : platformKey(a.utm_source);
      return { campaign: a.utm_campaign ?? null, campaign_id: a.campaign_id ?? null, platform: p, created_at: l.created_at as string, stage: l.canonical_stage as string, value: Number(l.value_current ?? 0) };
    })
    // Paid leads only (organic leads have no spend), matching the platform/campaign filter.
    .filter((l) => (l.platform === "google" || l.platform === "microsoft") && (platform === "all" || l.platform === platform) && (!campaignFilter || l.campaign === campaignFilter || l.campaign_id === campaignFilter));
  const a = analyzeSpend(spend, leads, grain);
  const platformsPresent = [...new Set([...a.platforms.map((p) => p.platform)])].filter((p) => a.platforms.find((x) => x.platform === p)?.cost);
  const allCampaigns = [...new Set(spend.map((s) => s.campaign ?? s.campaign_id))].sort();

  const q = (over: Partial<SP>) => {
    const base: Record<string, string> = { view, days: String(days), grain, platform, ...(campaignFilter ? { campaign: campaignFilter } : {}) };
    const merged = { ...base, ...Object.fromEntries(Object.entries(over).filter(([, v]) => v !== undefined)) } as Record<string, string>;
    if (merged.platform === "all") delete merged.platform;
    if (!merged.campaign) delete merged.campaign;
    return `?${new URLSearchParams(merged)}`;
  };
  const pill = (active: boolean) => `rounded px-2 py-1 ${active ? "bg-brand text-white" : "hover:bg-gray-100"}`;

  return (
    <>
      <PageHeader
        title="Ad spend"
        description="Where the budget goes and what it returns: clicks, leads, contracts and pipeline value by platform and campaign."
        actions={
          <>
            <a className="rounded-md border border-line bg-white px-3 py-1.5 text-sm hover:bg-gray-50" href={`/w/${ws.id}/export/spend.csv?days=${days}`}>
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

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <div className="flex gap-1" aria-label="Date range">
          {RANGES.map((d) => (
            <Link key={d} href={q({ days: String(d), grain: undefined, page: "0" })} className={pill(d === days)}>
              {d}d
            </Link>
          ))}
        </div>
        <div className="flex gap-1" aria-label="Group by">
          {(["day", "week", "month"] as const).map((g) => (
            <Link key={g} href={q({ grain: g })} className={pill(g === grain)}>
              {g === "day" ? "Daily" : g === "week" ? "Weekly" : "Monthly"}
            </Link>
          ))}
        </div>
        <div className="flex gap-1" aria-label="Platform">
          {["all", "google", "microsoft"].map((p) => (
            <Link key={p} href={q({ platform: p, page: "0" })} className={pill(p === platform)}>
              {p === "all" ? "All platforms" : PLATFORM_LABEL[p]}
            </Link>
          ))}
        </div>
        {campaignFilter && (
          <span className="flex items-center gap-1">
            <Badge tone="blue">Campaign: {campaignFilter}</Badge>
            <Link href={q({ campaign: "", page: "0" })} className="text-xs text-brand hover:underline">
              clear
            </Link>
          </span>
        )}
      </div>

      {/* View tabs */}
      <div role="tablist" className="mb-6 flex flex-wrap gap-1 border-b border-line">
        {VIEWS.map((v) => (
          <Link key={v.id} role="tab" aria-selected={v.id === view} href={q({ view: v.id, page: "0" })} className={`-mb-px border-b-2 px-3 py-2 text-sm ${v.id === view ? "border-brand font-medium text-ink" : "border-transparent text-muted hover:text-ink"}`}>
            {v.label}
          </Link>
        ))}
      </div>

      {/* KPIs (all views) */}
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Stat label="Spend" value={fmt(a.total.cost)} />
        <Stat label="Clicks" value={a.total.clicks.toLocaleString()} />
        <Stat label="Impressions" value={a.total.impressions.toLocaleString()} />
        <Stat label="CTR" value={pct(a.total.ctr)} />
        <Stat label="CPC" value={cur(a.total.cpc)} />
        <Stat label="Cost / lead" value={cur(a.total.cpl)} hint={`${a.total.leads} leads`} />
        <Stat label="Cost / contract" value={cur(a.total.costPerContract, 0)} hint={`${a.total.contracts} contracts`} />
        <Stat label="Value / spend" value={x(a.total.roas)} hint={`${fmt(a.total.value)} pipeline`} />
      </div>

      {view === "overview" && (
        <div className="space-y-6">
          <Card title="What the numbers say" description="Automatic summary for this period and filter. Campaigns under 5% of spend are not ranked.">
            <ul className="space-y-1.5 text-sm">
              {a.insights.map((i, n) => (
                <li key={n} className="flex gap-2">
                  <span aria-hidden className={i.tone === "good" ? "text-green-700" : i.tone === "bad" ? "text-red-700" : "text-blue-700"}>
                    {i.tone === "good" ? "▲" : i.tone === "bad" ? "▼" : "●"}
                  </span>
                  <span>{i.text}</span>
                </li>
              ))}
            </ul>
          </Card>
          <Card title={`Spend by platform · ${grain === "day" ? "daily" : grain === "week" ? "weekly" : "monthly"}`} description="Bars: spend. Line: clicks." actions={<Legend items={[...platformsPresent.map((p) => ({ key: p, label: PLATFORM_LABEL[p] ?? p })), { key: "line", label: "Clicks" }]} />}>
            <StackedBarLine data={a.timeline.map((t) => ({ label: t.label, segments: Object.fromEntries(Object.entries(t.platforms).map(([k, v]) => [k, v.cost])), line: t.total.clicks }))} keys={platformsPresent} line="clicks" formatBar={(n) => fmt(n)} formatLine={(n) => Math.round(n).toLocaleString()} />
          </Card>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card title="Leads per period" description="Bars: leads by platform. Line: cost per lead.">
              <StackedBarLine
                height={200}
                data={a.timeline.map((t) => ({ label: t.label, segments: Object.fromEntries(Object.entries(t.platforms).map(([k, v]) => [k, v.leads])), line: t.total.cpl ?? 0 }))}
                keys={platformsPresent}
                line="cost per lead"
                formatBar={(n) => String(Math.round(n))}
                formatLine={(n) => cur(n, 0)}
              />
            </Card>
            <Card title="Pipeline value vs spend" description="Top campaigns. Blue: spend. Orange: pipeline value.">
              <HBars rows={a.campaigns.slice(0, 8).map((c) => ({ label: c.campaign, value: c.cost, second: c.value, colorKey: c.platform }))} format={fmt} secondLabel="value" formatSecond={fmt} />
            </Card>
          </div>
        </div>
      )}

      {view === "platforms" && (
        <div className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-3">
            <Card title="Spend share">
              <HBars rows={a.platforms.map((p) => ({ label: PLATFORM_LABEL[p.platform] ?? p.platform, value: p.cost, colorKey: p.platform, note: a.total.cost ? `${Math.round((p.cost / a.total.cost) * 100)}%` : undefined }))} format={fmt} />
            </Card>
            <Card title="Cost per lead">
              <HBars rows={a.platforms.filter((p) => p.cpl !== null).map((p) => ({ label: PLATFORM_LABEL[p.platform] ?? p.platform, value: p.cpl ?? 0, colorKey: p.platform }))} format={(n) => cur(n)} />
            </Card>
            <Card title="Value per dollar">
              <HBars rows={a.platforms.filter((p) => p.roas !== null).map((p) => ({ label: PLATFORM_LABEL[p.platform] ?? p.platform, value: p.roas ?? 0, colorKey: p.platform }))} format={(n) => `${n.toFixed(1)}×`} />
            </Card>
          </div>
          <Card title="Platform comparison">
            <MetricTable rows={a.platforms.map((p) => ({ key: p.platform, label: PLATFORM_LABEL[p.platform] ?? p.platform, m: p }))} fmt={fmt} cur={cur} pct={pct} x={x} />
          </Card>
          <Card title={`Platforms over time · ${grain}`} actions={<Legend items={platformsPresent.map((p) => ({ key: p, label: PLATFORM_LABEL[p] ?? p }))} />}>
            <StackedBarLine data={a.timeline.map((t) => ({ label: t.label, segments: Object.fromEntries(Object.entries(t.platforms).map(([k, v]) => [k, v.cost])) }))} keys={platformsPresent} formatBar={fmt} />
          </Card>
        </div>
      )}

      {view === "campaigns" && (
        <div className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-3">
            <Card title="Best value per dollar" description="Pipeline value ÷ spend">
              <HBars rows={[...a.campaigns].filter((c) => c.roas !== null).sort((p, q2) => (q2.roas ?? 0) - (p.roas ?? 0)).slice(0, 6).map((c) => ({ label: c.campaign, value: c.roas ?? 0, colorKey: c.platform }))} format={(n) => `${n.toFixed(1)}×`} />
            </Card>
            <Card title="Lowest cost per lead">
              <HBars rows={[...a.campaigns].filter((c) => c.cpl !== null).sort((p, q2) => (p.cpl ?? 0) - (q2.cpl ?? 0)).slice(0, 6).map((c) => ({ label: c.campaign, value: c.cpl ?? 0, colorKey: c.platform }))} format={(n) => cur(n)} />
            </Card>
            <Card title="Best click-through rate">
              <HBars rows={[...a.campaigns].filter((c) => c.ctr !== null).sort((p, q2) => (q2.ctr ?? 0) - (p.ctr ?? 0)).slice(0, 6).map((c) => ({ label: c.campaign, value: (c.ctr ?? 0) * 100, colorKey: c.platform }))} format={(n) => `${n.toFixed(2)}%`} />
            </Card>
          </div>
          <Card title="Campaign comparison" description="Click a campaign to filter every view to it.">
            <MetricTable
              rows={a.campaigns.map((c) => ({ key: c.campaign, label: c.campaign, sub: PLATFORM_LABEL[c.platform] ?? c.platform, href: q({ campaign: c.campaign, view: "overview", page: "0" }), m: c }))}
              fmt={fmt}
              cur={cur}
              pct={pct}
              x={x}
              highlight
            />
          </Card>
        </div>
      )}

      {view === "data" && <DailyData wsId={ws.id} from={from} platform={platform} campaign={campaignFilter} page={page} fmt={fmt} q={q} />}

      {rank >= 3 && (
        <details className="mt-6 rounded-lg border border-line bg-panel p-4">
          <summary className="cursor-pointer text-sm font-semibold">Import spend from a CSV</summary>
          <p className="mt-2 text-xs text-muted">
            Header row with at least &quot;date&quot; and &quot;cost&quot;. Optional: platform (google / microsoft), campaign, campaign_id, clicks, impressions, geo, adgroup_id. Dates as YYYY-MM-DD or MM/DD/YYYY. Re-importing the same day and campaign replaces it.
          </p>
          <form action={uploadSpend.bind(null, ws.id)} className="mt-3 flex flex-wrap items-center gap-3">
            <input type="file" name="file" accept=".csv,text/csv" required aria-label="Spend CSV" />
            <Button>Import</Button>
          </form>
          <pre className="mt-3 overflow-x-auto rounded bg-gray-50 p-2 text-xs">{`date,platform,campaign,cost,clicks,impressions,geo
2026-09-27,google,Search – Sell Land,412.50,318,9120,TX
2026-09-27,microsoft,Search – Sell Land,96.10,74,2210,TX`}</pre>
        </details>
      )}
      {allCampaigns.length === 0 && view !== "data" && <p className="mt-4 text-sm text-muted">No spend in this period.</p>}
    </>
  );
}

function MetricTable({
  rows,
  fmt,
  cur,
  pct,
  x,
  highlight,
}: {
  rows: { key: string; label: string; sub?: string; href?: string; m: Metrics }[];
  fmt: (n: number) => string;
  cur: (n: number | null, d?: number) => string;
  pct: (n: number | null) => string;
  x: (n: number | null) => string;
  highlight?: boolean;
}) {
  const bestOf = (k: keyof Metrics, dir: "min" | "max") => {
    const vals = rows.map((r) => r.m[k]).filter((v): v is number => typeof v === "number");
    if (vals.length < 2) return null;
    return dir === "min" ? Math.min(...vals) : Math.max(...vals);
  };
  const b = { ctr: bestOf("ctr", "max"), cpc: bestOf("cpc", "min"), cpl: bestOf("cpl", "min"), roas: bestOf("roas", "max") };
  const star = (k: keyof typeof b, v: number | null) => (highlight !== false && v !== null && b[k] !== null && v === b[k] ? " ★" : "");
  return (
    <Table head={["", "Spend", "Clicks", "Impr.", "CTR", "CPC", "CPM", "Leads", "Cost/lead", "Contracts", "Cost/contract", "Value", "Value/spend"]} empty="No data.">
      {rows.map((r) => (
        <tr key={r.key} className="hover:bg-gray-50">
          <Td className="font-medium">
            {r.href ? (
              <Link href={r.href} className="text-brand hover:underline">
                {r.label}
              </Link>
            ) : (
              r.label
            )}
            {r.sub && <div className="text-xs font-normal text-muted">{r.sub}</div>}
          </Td>
          <Td className="num">{fmt(r.m.cost)}</Td>
          <Td className="num">{r.m.clicks.toLocaleString()}</Td>
          <Td className="num">{r.m.impressions.toLocaleString()}</Td>
          <Td className="num">{pct(r.m.ctr) + star("ctr", r.m.ctr)}</Td>
          <Td className="num">{cur(r.m.cpc) + star("cpc", r.m.cpc)}</Td>
          <Td className="num">{cur(r.m.cpm)}</Td>
          <Td className="num">{r.m.leads}</Td>
          <Td className="num">{cur(r.m.cpl) + star("cpl", r.m.cpl)}</Td>
          <Td className="num">{r.m.contracts}</Td>
          <Td className="num">{cur(r.m.costPerContract, 0)}</Td>
          <Td className="num">{fmt(r.m.value)}</Td>
          <Td className="num">{x(r.m.roas) + star("roas", r.m.roas)}</Td>
        </tr>
      ))}
    </Table>
  );
}

async function DailyData({ wsId, from, platform, campaign, page, fmt, q }: { wsId: string; from: string; platform: string; campaign: string; page: number; fmt: (n: number) => string; q: (o: Partial<SP>) => string }) {
  const sb = await userClient();
  let dq = sb
    .from("ad_spend_daily")
    .select("date,platform,campaign,campaign_id,adgroup_id,geo,cost,clicks,impressions", { count: "exact" })
    .eq("workspace_id", wsId)
    .gte("date", from.slice(0, 10))
    .order("date", { ascending: false })
    .order("cost", { ascending: false })
    .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
  if (platform !== "all") dq = dq.eq("platform", platform);
  if (campaign) dq = dq.or(`campaign.eq.${JSON.stringify(campaign)},campaign_id.eq.${JSON.stringify(campaign)}`);
  const { data, count } = await dq;
  const total = count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return (
    <Card>
      <Table head={["Date", "Platform", "Campaign", "Geo", "Cost", "Clicks", "Impr.", "CTR", "CPC"]} empty="No spend in this period.">
        {(data ?? []).map((r) => (
          <tr key={`${r.date}${r.platform}${r.campaign_id}${r.adgroup_id}${r.geo}`}>
            <Td>{r.date}</Td>
            <Td>{PLATFORM_LABEL[r.platform] ?? r.platform}</Td>
            <Td>{r.campaign ?? r.campaign_id}</Td>
            <Td>{r.geo || "—"}</Td>
            <Td className="num">{fmt(Number(r.cost))}</Td>
            <Td className="num">{r.clicks}</Td>
            <Td className="num">{r.impressions}</Td>
            <Td className="num">{r.impressions ? `${((r.clicks / r.impressions) * 100).toFixed(2)}%` : "—"}</Td>
            <Td className="num">{r.clicks ? fmt(Number(r.cost) / r.clicks) : "—"}</Td>
          </tr>
        ))}
      </Table>
      <nav aria-label="Pagination" className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="text-muted">
          {total ? `${page * PAGE_SIZE + 1}–${Math.min(total, (page + 1) * PAGE_SIZE)} of ${total} rows` : "0 rows"}
        </span>
        <span className="flex items-center gap-1">
          {page > 0 ? (
            <>
              <Link className="rounded border border-line px-2 py-1 hover:bg-gray-50" href={q({ page: "0" })}>
                « First
              </Link>
              <Link className="rounded border border-line px-2 py-1 hover:bg-gray-50" href={q({ page: String(page - 1) })}>
                ‹ Prev
              </Link>
            </>
          ) : null}
          <span className="px-2 text-muted">
            Page {page + 1} of {pages}
          </span>
          {page + 1 < pages ? (
            <>
              <Link className="rounded border border-line px-2 py-1 hover:bg-gray-50" href={q({ page: String(page + 1) })}>
                Next ›
              </Link>
              <Link className="rounded border border-line px-2 py-1 hover:bg-gray-50" href={q({ page: String(pages - 1) })}>
                Last »
              </Link>
            </>
          ) : null}
        </span>
      </nav>
    </Card>
  );
}
