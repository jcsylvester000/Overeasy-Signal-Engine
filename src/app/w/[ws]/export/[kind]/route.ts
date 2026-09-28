import { userClient } from "@/lib/supabase/server";
import { workspaceAccess } from "@/lib/tenancy";
import { audit } from "@/lib/audit";
import { toCsv } from "@/core/csv";

export const dynamic = "force-dynamic";

/** CSV exports (RPT-06). Read through RLS as the signed-in user. No raw contact details or hashes are exported. */
export async function GET(req: Request, ctx: { params: Promise<{ ws: string; kind: string }> }) {
  const { ws: wsId, kind } = await ctx.params;
  const { ws, rank } = await workspaceAccess(wsId);
  if (rank < 2) return new Response("Forbidden", { status: 403 });
  const sb = await userClient();
  const days = Math.min(730, Math.max(1, Number(new URL(req.url).searchParams.get("days") ?? 90)));
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  let csv: string;
  if (kind === "leads.csv") {
    const { data } = await sb
      .from("leads")
      .select("id,created_at,source,form,score,score_version,lead_type,velocity_band,canonical_stage,lost_reason,value_current,currency,geo,attribution,click_ts,window_expires_on,is_test")
      .eq("workspace_id", ws.id)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(50000);
    csv = toCsv(
      ["lead_id", "created_at", "source", "form", "score", "score_version", "lead_type", "velocity", "stage", "lost_reason", "value_current", "currency", "geo", "utm_source", "utm_campaign", "platform", "click_ts", "window_expires_on", "simulated"],
      (data ?? []).map((l) => {
        const a = (l.attribution ?? {}) as Record<string, string>;
        return [l.id, l.created_at, l.source, l.form, l.score, l.score_version, l.lead_type, l.velocity_band, l.canonical_stage, l.lost_reason, l.value_current, l.currency, l.geo, a.utm_source, a.utm_campaign, a.gclid || a.gbraid || a.wbraid ? "google" : a.msclkid ? "microsoft" : "", l.click_ts, l.window_expires_on, l.is_test];
      }),
    );
  } else if (kind === "signals.csv") {
    const { data } = await sb.from("signal_jobs").select("created_at,lead_id,platform,mode,canonical_stage,transaction_id,value_increment,cumulative_after,currency,status,attempts,sent_at,error").eq("workspace_id", ws.id).gte("created_at", since).order("created_at", { ascending: false }).limit(50000);
    const head = ["created_at", "lead_id", "platform", "mode", "stage", "transaction_id", "increment", "cumulative", "currency", "status", "attempts", "sent_at", "error"];
    csv = toCsv(head, (data ?? []).map((j) => [j.created_at, j.lead_id, j.platform, j.mode, j.canonical_stage, j.transaction_id, j.value_increment, j.cumulative_after, j.currency, j.status, j.attempts, j.sent_at, j.error]));
  } else if (kind === "spend.csv") {
    const { data } = await sb.from("ad_spend_daily").select("date,platform,campaign,campaign_id,adgroup_id,geo,cost,clicks,impressions").eq("workspace_id", ws.id).gte("date", since.slice(0, 10)).order("date", { ascending: false }).limit(50000);
    csv = toCsv(["date", "platform", "campaign", "campaign_id", "adgroup_id", "geo", "cost", "clicks", "impressions"], (data ?? []).map((r) => [r.date, r.platform, r.campaign, r.campaign_id, r.adgroup_id, r.geo, r.cost, r.clicks, r.impressions]));
  } else {
    return new Response("Not found", { status: 404 });
  }
  const { data: u } = await sb.auth.getUser();
  await audit({ orgId: ws.org_id, workspaceId: ws.id, actorId: u.user?.id, action: "export.csv", entity: kind, diff: { days } });
  return new Response(csv, {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${ws.slug}-${kind.replace(".csv", "")}-${new Date().toISOString().slice(0, 10)}.csv"`, "cache-control": "no-store" },
  });
}
