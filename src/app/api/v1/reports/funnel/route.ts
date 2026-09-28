import { admin } from "@/lib/supabase/admin";
import { authApiKey, json, notConfigured } from "@/lib/api/http";
import { RUNGS, rungIndex } from "@/core/stages";

export const dynamic = "force-dynamic";

type Row = { key: string; leads: number; qualified: number; contract: number; funded: number; value: number };

/** GET /v1/reports/funnel?days=30 — funnel + breakdowns for embedding (read scope). Simulated leads excluded. */
export async function GET(req: Request) {
  const nc = notConfigured();
  if (nc) return nc;
  const auth = await authApiKey(req, null, "read");
  if (auth instanceof Response) return auth;
  const days = Math.min(730, Math.max(1, Number(new URL(req.url).searchParams.get("days") ?? 30) || 30));
  const from = new Date(Date.now() - days * 86_400_000).toISOString();
  const db = admin();
  const [{ data: ws }, { data: leads }] = await Promise.all([
    db.from("workspaces").select("currency").eq("id", auth.workspaceId).single(),
    db.from("leads").select("id,lead_type,canonical_stage,value_current,attribution").eq("workspace_id", auth.workspaceId).eq("is_test", false).gte("created_at", from).limit(20000),
  ]);
  const list = leads ?? [];
  const reached = new Map<string, number>();
  const ids = list.map((l) => l.id as string);
  for (let i = 0; i < ids.length; i += 500) {
    const { data: ev } = await db.from("stage_events").select("lead_id,canonical_stage").in("lead_id", ids.slice(i, i + 500));
    for (const e of ev ?? []) reached.set(e.lead_id, Math.max(reached.get(e.lead_id) ?? 0, rungIndex(e.canonical_stage)));
  }
  const group = (keyOf: (l: (typeof list)[number]) => string): Row[] => {
    const m = new Map<string, Row>();
    for (const l of list) {
      const k = keyOf(l);
      const r = m.get(k) ?? { key: k, leads: 0, qualified: 0, contract: 0, funded: 0, value: 0 };
      const x = reached.get(l.id) ?? 0;
      r.leads++;
      if (x >= 1) r.qualified++;
      if (x >= 3) r.contract++;
      if (x >= 5) r.funded++;
      r.value = Math.round((r.value + Number(l.value_current ?? 0)) * 100) / 100;
      m.set(k, r);
    }
    return [...m.values()].sort((a, b) => b.value - a.value);
  };
  return json({
    days,
    from,
    funnel: RUNGS.map((stage, i) => ({ stage, count: list.filter((l) => (reached.get(l.id) ?? 0) >= i).length })),
    lost: list.filter((l) => l.canonical_stage === "lost").length,
    value_total: Math.round(list.reduce((a, l) => a + Number(l.value_current ?? 0), 0) * 100) / 100,
    currency: ws?.currency ?? "USD",
    by_lead_type: group((l) => l.lead_type ?? "(unscored)"),
    by_campaign: group((l) => ((l.attribution ?? {}) as Record<string, string>).utm_campaign ?? "(none)"),
  });
}
