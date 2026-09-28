/**
 * Ad-spend analytics (pure): time buckets, platform/campaign comparison and plain-language insights.
 * Spend rows come from ad_spend_daily; lead outcomes are joined by campaign (name or id).
 */
export type SpendRow = { date: string; platform: string; campaign: string | null; campaign_id: string; cost: number; clicks: number; impressions: number };
export type LeadRow = { campaign: string | null; campaign_id: string | null; platform: string | null; created_at: string; stage: string; value: number };
export type Grain = "day" | "week" | "month";

export type Metrics = {
  cost: number;
  clicks: number;
  impressions: number;
  leads: number;
  contracts: number;
  value: number;
  ctr: number | null; // clicks / impressions
  cpc: number | null; // cost / clicks
  cpm: number | null; // cost per 1,000 impressions
  cpl: number | null; // cost per lead
  costPerContract: number | null;
  roas: number | null; // pipeline value / cost
  convRate: number | null; // leads / clicks
};

const CONTRACT_OR_LATER = new Set(["contract", "sold", "funded"]);

function finish(m: Omit<Metrics, "ctr" | "cpc" | "cpm" | "cpl" | "costPerContract" | "roas" | "convRate">): Metrics {
  const r = (a: number, b: number) => (b > 0 ? a / b : null);
  return {
    ...m,
    cost: Math.round(m.cost * 100) / 100,
    value: Math.round(m.value * 100) / 100,
    ctr: r(m.clicks, m.impressions),
    cpc: r(m.cost, m.clicks),
    cpm: m.impressions > 0 ? (m.cost / m.impressions) * 1000 : null,
    cpl: r(m.cost, m.leads),
    costPerContract: r(m.cost, m.contracts),
    roas: r(m.value, m.cost),
    convRate: r(m.leads, m.clicks),
  };
}

const empty = () => ({ cost: 0, clicks: 0, impressions: 0, leads: 0, contracts: 0, value: 0 });

export function bucketOf(date: string, grain: Grain): string {
  if (grain === "day") return date.slice(0, 10);
  if (grain === "month") return date.slice(0, 7);
  const d = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

export function bucketLabel(key: string, grain: Grain): string {
  if (grain === "month") {
    const [y, m] = key.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
  }
  const d = new Date(`${key}T00:00:00Z`);
  const s = d.toLocaleString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return grain === "week" ? `Wk of ${s}` : s;
}

/** Normalise platform labels from leads (utm_source / click id) and spend. */
export function platformKey(p: string | null | undefined): string {
  const s = (p ?? "").toLowerCase();
  if (/micro|bing/.test(s)) return "microsoft";
  if (/google|adwords/.test(s)) return "google";
  return s || "other";
}

export function analyzeSpend(spend: SpendRow[], leads: LeadRow[], grain: Grain) {
  // Campaign identity: prefer the campaign name; map ids → names from spend rows.
  const nameById = new Map<string, string>();
  for (const s of spend) if (s.campaign_id && s.campaign) nameById.set(s.campaign_id, s.campaign);
  const campKey = (name: string | null, id: string | null) => name || (id ? (nameById.get(id) ?? id) : "(none)");

  const series = new Map<string, Record<string, ReturnType<typeof empty>>>(); // bucket → platform → totals
  const byPlatform = new Map<string, ReturnType<typeof empty>>();
  const byCampaign = new Map<string, ReturnType<typeof empty> & { platform: string }>();
  const total = empty();

  const add = (t: ReturnType<typeof empty>, x: Partial<ReturnType<typeof empty>>) => {
    for (const k of Object.keys(x) as (keyof typeof t)[]) t[k] += x[k] ?? 0;
  };

  for (const s of spend) {
    const b = bucketOf(s.date, grain);
    const p = platformKey(s.platform);
    const row = series.get(b) ?? {};
    row[p] ??= empty();
    add(row[p], { cost: s.cost, clicks: s.clicks, impressions: s.impressions });
    series.set(b, row);
    const pl = byPlatform.get(p) ?? empty();
    add(pl, { cost: s.cost, clicks: s.clicks, impressions: s.impressions });
    byPlatform.set(p, pl);
    const ck = campKey(s.campaign, s.campaign_id);
    const c = byCampaign.get(ck) ?? { ...empty(), platform: p };
    add(c, { cost: s.cost, clicks: s.clicks, impressions: s.impressions });
    byCampaign.set(ck, c);
    add(total, { cost: s.cost, clicks: s.clicks, impressions: s.impressions });
  }
  for (const l of leads) {
    const x = { leads: 1, contracts: CONTRACT_OR_LATER.has(l.stage) ? 1 : 0, value: l.value };
    const b = bucketOf(l.created_at, grain);
    const p = platformKey(l.platform);
    const row = series.get(b) ?? {};
    row[p] ??= empty();
    add(row[p], x);
    series.set(b, row);
    const pl = byPlatform.get(p) ?? empty();
    add(pl, x);
    byPlatform.set(p, pl);
    const ck = campKey(l.campaign, l.campaign_id);
    const c = byCampaign.get(ck) ?? { ...empty(), platform: p };
    add(c, x);
    byCampaign.set(ck, c);
    add(total, x);
  }

  const timeline = [...series.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([bucket, platforms]) => {
      const all = empty();
      for (const v of Object.values(platforms)) add(all, v);
      return { bucket, label: bucketLabel(bucket, grain), total: finish(all), platforms: Object.fromEntries(Object.entries(platforms).map(([k, v]) => [k, finish(v)])) };
    });
  const platforms = [...byPlatform.entries()].map(([platform, v]) => ({ platform, ...finish(v) })).sort((a, b) => b.cost - a.cost);
  const campaigns = [...byCampaign.entries()]
    .map(([campaign, v]) => ({ campaign, platform: v.platform, ...finish(v) }))
    .filter((c) => c.cost > 0 || c.leads > 0)
    .sort((a, b) => b.cost - a.cost);
  return { timeline, platforms, campaigns, total: finish(total), insights: insights(campaigns, platforms, timeline) };
}

type Named = Metrics & { campaign?: string; platform?: string };

function best<T extends Named>(xs: T[], key: keyof Metrics, dir: "min" | "max", minCost: number) {
  const pool = xs.filter((x) => x[key] !== null && x.cost >= minCost);
  if (pool.length < 2) return null;
  return pool.reduce((a, b) => ((dir === "min" ? (b[key] as number) < (a[key] as number) : (b[key] as number) > (a[key] as number)) ? b : a));
}

export type Insight = { tone: "good" | "bad" | "info"; text: string };

/** Plain-language summary of what performed best/worst. Thresholds avoid judging campaigns on tiny spend. */
export function insights(
  campaigns: (Metrics & { campaign: string; platform: string })[],
  platforms: (Metrics & { platform: string })[],
  timeline: { label: string; total: Metrics }[],
): Insight[] {
  const out: Insight[] = [];
  const totalCost = campaigns.reduce((a, c) => a + c.cost, 0);
  if (!totalCost) return [{ tone: "info", text: "No spend in this period yet. Import a CSV or connect the ad accounts." }];
  const minCost = totalCost * 0.05;
  const money = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: n < 100 ? 2 : 0 })}`;
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

  const roasBest = best(campaigns, "roas", "max", minCost);
  if (roasBest?.roas) out.push({ tone: "good", text: `${roasBest.campaign} returns the most pipeline value per dollar: ${roasBest.roas.toFixed(1)}× (${money(roasBest.value)} on ${money(roasBest.cost)}).` });
  const roasWorst = best(campaigns, "roas", "min", minCost);
  if (roasWorst && roasWorst !== roasBest && roasWorst.roas !== null) out.push({ tone: "bad", text: `${roasWorst.campaign} returns the least value per dollar: ${roasWorst.roas.toFixed(1)}×. Review keywords, landing page or budget.` });
  const cplBest = best(campaigns, "cpl", "min", minCost);
  if (cplBest?.cpl) out.push({ tone: "good", text: `Cheapest leads: ${cplBest.campaign} at ${money(cplBest.cpl)} per lead.` });
  const cpcBest = best(campaigns, "cpc", "min", minCost);
  if (cpcBest?.cpc) out.push({ tone: "info", text: `Lowest cost per click: ${cpcBest.campaign} at ${money(cpcBest.cpc)}.` });
  const ctrBest = best(campaigns, "ctr", "max", minCost);
  if (ctrBest?.ctr) out.push({ tone: "info", text: `Best click-through rate: ${ctrBest.campaign} at ${pct(ctrBest.ctr)} of impressions.` });
  const noLeads = campaigns.filter((c) => c.cost >= minCost && c.leads === 0);
  for (const c of noLeads.slice(0, 2)) out.push({ tone: "bad", text: `${c.campaign} spent ${money(c.cost)} with no leads in this period.` });
  const cheapButWeak = cplBest && roasWorst && cplBest.campaign === roasWorst.campaign;
  if (cheapButWeak) out.push({ tone: "bad", text: `${cplBest!.campaign} has cheap leads but low value: volume without quality. Don't judge it on cost per lead alone.` });

  if (platforms.length >= 2) {
    const [a, b] = [...platforms].filter((p) => p.cost > 0).sort((x, y) => (y.roas ?? 0) - (x.roas ?? 0));
    if (a && b && a.roas !== null && b.roas !== null) out.push({ tone: "info", text: `${a.platform === "google" ? "Google" : a.platform === "microsoft" ? "Microsoft" : a.platform} returns ${a.roas.toFixed(1)}× vs ${b.platform === "google" ? "Google" : b.platform === "microsoft" ? "Microsoft" : b.platform} ${b.roas.toFixed(1)}× pipeline value per dollar.` });
  }
  if (timeline.length >= 2) {
    const last = timeline[timeline.length - 1].total;
    const prev = timeline[timeline.length - 2].total;
    if (prev.cost > 0) {
      const ch = (last.cost - prev.cost) / prev.cost;
      if (Math.abs(ch) >= 0.1) out.push({ tone: "info", text: `Spend ${ch > 0 ? "rose" : "fell"} ${pct(Math.abs(ch))} in the latest period (${timeline[timeline.length - 1].label}) vs the one before.` });
    }
  }
  return out;
}
