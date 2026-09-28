import "server-only";
import { userClient } from "@/lib/supabase/server";
import { RUNGS, rungIndex } from "@/core/stages";

type Lead = {
  id: string;
  created_at: string;
  score: number | null;
  score_capped: boolean;
  lead_type: string | null;
  canonical_stage: string;
  value_current: number;
  geo: string | null;
  attribution: Record<string, string | null>;
  is_test: boolean;
};

export type Row = { key: string; leads: number; qualified: number; contract: number; funded: number; lost: number; value: number; avgScore: number | null; medianDaysToContract: number | null; spend: number };

const platformOf = (a: Record<string, string | null>) => (a.gclid || a.gbraid || a.wbraid ? "Google" : a.msclkid ? "Microsoft" : a.fbclid ? "Meta" : a.utm_medium === "cpc" ? "Paid (no click id)" : "Organic / direct");

function median(xs: number[]) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Funnel and breakdowns (RPT-02..05). Reads through RLS as the signed-in user. */
export async function overview(workspaceId: string, days: number, includeTest: boolean) {
  const sb = await userClient();
  const from = new Date(Date.now() - days * 86_400_000).toISOString();
  let q = sb.from("leads").select("id,created_at,score,score_capped,lead_type,canonical_stage,value_current,geo,attribution,is_test").eq("workspace_id", workspaceId).gte("created_at", from).limit(5000);
  if (!includeTest) q = q.eq("is_test", false);
  const { data: leadsRaw } = await q;
  const leads = (leadsRaw ?? []) as Lead[];
  const ids = leads.map((l) => l.id);

  // Highest rung reached per lead + first time it reached each rung.
  const reached = new Map<string, number>();
  const firstAt = new Map<string, Map<string, string>>();
  for (let i = 0; i < ids.length; i += 500) {
    const { data: ev } = await sb.from("stage_events").select("lead_id,canonical_stage,occurred_at").in("lead_id", ids.slice(i, i + 500));
    for (const e of ev ?? []) {
      const r = rungIndex(e.canonical_stage);
      if (r > (reached.get(e.lead_id) ?? -1)) reached.set(e.lead_id, r);
      const m = firstAt.get(e.lead_id) ?? new Map<string, string>();
      if (!m.has(e.canonical_stage) || m.get(e.canonical_stage)! > e.occurred_at) m.set(e.canonical_stage, e.occurred_at);
      firstAt.set(e.lead_id, m);
    }
  }

  const funnel = RUNGS.map((stage, i) => ({ stage, count: leads.filter((l) => (reached.get(l.id) ?? 0) >= i).length }));
  const lost = leads.filter((l) => l.canonical_stage === "lost").length;
  const totalValue = leads.reduce((s, l) => s + Number(l.value_current ?? 0), 0);

  const { data: spendRows } = await sb.from("ad_spend_daily").select("platform,campaign,campaign_id,geo,cost").eq("workspace_id", workspaceId).gte("date", from.slice(0, 10));
  const spendTotal = (spendRows ?? []).reduce((s, r) => s + Number(r.cost), 0);

  function group(keyOf: (l: Lead) => string, spendOf?: (key: string) => number): Row[] {
    const map = new Map<string, Lead[]>();
    for (const l of leads) map.set(keyOf(l), [...(map.get(keyOf(l)) ?? []), l]);
    return [...map.entries()]
      .map(([key, ls]) => {
        const scored = ls.filter((l) => l.score !== null);
        const dtc = ls
          .map((l) => {
            const c = firstAt.get(l.id)?.get("contract");
            return c ? (new Date(c).getTime() - new Date(l.created_at).getTime()) / 86_400_000 : null;
          })
          .filter((x): x is number => x !== null);
        return {
          key,
          leads: ls.length,
          qualified: ls.filter((l) => (reached.get(l.id) ?? 0) >= 1).length,
          contract: ls.filter((l) => (reached.get(l.id) ?? 0) >= 3).length,
          funded: ls.filter((l) => (reached.get(l.id) ?? 0) >= 5).length,
          lost: ls.filter((l) => l.canonical_stage === "lost").length,
          value: ls.reduce((s, l) => s + Number(l.value_current ?? 0), 0),
          avgScore: scored.length ? scored.reduce((s, l) => s + Number(l.score), 0) / scored.length : null,
          medianDaysToContract: median(dtc),
          spend: spendOf ? spendOf(key) : 0,
        };
      })
      .sort((a, b) => b.value - a.value);
  }

  const spendByCampaign = (name: string) => (spendRows ?? []).filter((r) => (r.campaign ?? r.campaign_id) === name).reduce((s, r) => s + Number(r.cost), 0);
  const byCampaign = group((l) => l.attribution?.utm_campaign ?? "(none)", spendByCampaign);
  const deadSpend = byCampaign.reduce((s, r) => s + (r.leads ? r.spend * (r.lost / r.leads) : 0), 0);

  const { data: jobs } = await sb.from("signal_jobs").select("status,value_increment").eq("workspace_id", workspaceId).gte("created_at", from).limit(10000);
  const signalStatus = new Map<string, { n: number; value: number }>();
  for (const j of jobs ?? []) {
    const s = signalStatus.get(j.status) ?? { n: 0, value: 0 };
    s.n++;
    s.value += Number(j.value_increment);
    signalStatus.set(j.status, s);
  }

  return {
    leads: leads.length,
    testLeads: leads.filter((l) => l.is_test).length,
    funnel,
    lost,
    totalValue,
    spendTotal,
    deadSpend,
    capHitRate: leads.length ? leads.filter((l) => l.score_capped).length / leads.length : 0,
    byType: group((l) => l.lead_type ?? "(unscored)"),
    byCampaign,
    byPlatform: group((l) => platformOf(l.attribution ?? {})),
    byGeo: group((l) => l.geo ?? "(unknown)").slice(0, 15),
    signals: [...signalStatus.entries()].map(([status, v]) => ({ status, ...v })),
  };
}
