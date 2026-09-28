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
  } else if (kind === "data-map.md") {
    // B15: data inventory / data-flow summary for the client's privacy assessment (DPIA/PIA).
    const [{ data: model }, { data: conns }, { data: sites }] = await Promise.all([
      sb.from("scoring_models").select("model,version").eq("workspace_id", ws.id).eq("status", "published").maybeSingle(),
      sb.from("connections").select("provider,mode,status").eq("workspace_id", ws.id).neq("status", "disconnected"),
      sb.from("sites").select("domain,allowed_origins").eq("workspace_id", ws.id),
    ]);
    const st = ws.settings as { storeRawPii?: boolean; piiRetentionDays?: number; regulatedVertical?: boolean; optOutPolicy?: string };
    const fields = ((model?.model as { fields?: { key: string; label: string; sensitive?: boolean }[] })?.fields ?? []).map((f) => `| ${f.label} | \`${f.key}\` | ${f.sensitive ? "Sensitive: used for scoring, stored masked" : "Stored with the lead"} |`);
    csv = [
      `# Data map — ${ws.name}`,
      `Generated ${new Date().toISOString().slice(0, 10)}. For the client's privacy assessment; not legal advice.`,
      ``,
      `## Collection points`,
      ...(sites ?? []).map((s) => `- Website tag on ${s.domain} (allowed origins: ${(s.allowed_origins ?? []).join(", ") || "any"})`),
      `- Server Ingest API and CRM webhooks (if configured)`,
      ``,
      `## Data captured`,
      `| Item | Detail | Handling |`,
      `|---|---|---|`,
      `| Ad click data | gclid, gbraid, wbraid, msclkid, fbclid, UTM/ValueTrack, landing page (no query), referrer, click time | Stored per visit and bound to the lead |`,
      `| Consent | Google Consent Mode (ad_user_data, ad_personalization, ad_storage), Global Privacy Control | Stored per lead; enforced before upload |`,
      `| Email / phone | Normalised, SHA-256 hashed at intake | Hashes kept for matching${st.regulatedVertical ? "; never uploaded (regulated vertical)" : " and uploads where permitted"} |`,
      `| Raw email / phone / name | ${st.storeRawPii === false ? "Not stored" : `Encrypted (AES-256-GCM), deleted after ${st.piiRetentionDays ?? 30} days`} | Used only for CRM sync |`,
      `| Pipeline stages, deal value | From the CRM | Stored as stage history |`,
      ``,
      `## Form fields (scoring model v${model?.version ?? "—"}; unlisted fields are dropped)`,
      `| Question | Key | Handling |`,
      `|---|---|---|`,
      ...fields,
      ``,
      `## Recipients`,
      ...(conns ?? []).map((c) => `- ${c.provider} (${c.mode})`),
      `- Sub-processors: see /trust`,
      ``,
      `## Opt-outs`,
      `- GPC / recorded opt-out: ${st.optOutPolicy === "click_id_only" ? "uploaded with click ID only, personalization denied" : "not uploaded to ad platforms"}`,
      `- Data-subject requests: Privacy page (access/export, delete)`,
      ``,
    ].join("\n");
    await audit({ orgId: ws.org_id, workspaceId: ws.id, action: "export.data_map", entity: kind });
    return new Response(csv, { headers: { "content-type": "text/markdown; charset=utf-8", "content-disposition": `attachment; filename="${ws.slug}-data-map.md"`, "cache-control": "no-store" } });
  } else {
    return new Response("Not found", { status: 404 });
  }
  const { data: u } = await sb.auth.getClaims();
  await audit({ orgId: ws.org_id, workspaceId: ws.id, actorId: u?.claims?.sub ? String(u.claims.sub) : null, action: "export.csv", entity: kind, diff: { days } });
  return new Response(csv, {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${ws.slug}-${kind.replace(".csv", "")}-${new Date().toISOString().slice(0, 10)}.csv"`, "cache-control": "no-store" },
  });
}
