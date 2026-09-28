import "server-only";
import { admin } from "@/lib/supabase/admin";
import { effectiveMode } from "@/lib/env";
import { parseCsv } from "@/core/csv";
import { googleSpend, type SpendRow } from "@/connectors/google/ads";
import { microsoftSpend } from "@/connectors/microsoft/reporting";
import { markConnection } from "@/connectors/tokens";
import type { Connection } from "@/connectors/types";
import { raiseAlert } from "./alerts";

async function upsert(workspaceId: string, platform: string, rows: (SpendRow & { geo?: string; adgroup_id?: string })[]) {
  const clean = rows
    .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date))
    .map((r) => ({
      workspace_id: workspaceId,
      platform,
      date: r.date,
      campaign_id: r.campaign_id || r.campaign || "",
      campaign: r.campaign || null,
      adgroup_id: r.adgroup_id ?? "",
      geo: r.geo ?? "",
      cost: r.cost,
      clicks: r.clicks,
      impressions: r.impressions,
    }));
  for (let i = 0; i < clean.length; i += 500) {
    const { error } = await admin().from("ad_spend_daily").upsert(clean.slice(i, i + 500), { onConflict: "workspace_id,platform,date,campaign_id,adgroup_id,geo" });
    if (error) throw new Error(error.message);
  }
  return clean.length;
}

/** RPT-01: daily spend import from every connected ad account (skipped for dry-run connections). */
export async function syncSpend(workspaceId?: string, days = 7) {
  let q = admin().from("connections").select("*").in("provider", ["google_ads", "microsoft_ads"]).eq("status", "ok");
  if (workspaceId) q = q.eq("workspace_id", workspaceId);
  const { data } = await q;
  const out: { connection: string; rows: number; skipped?: string; error?: string }[] = [];
  for (const conn of (data ?? []) as Connection[]) {
    const mode = effectiveMode(conn.mode);
    if (mode === "dry_run") {
      out.push({ connection: conn.id, rows: 0, skipped: "dry run" });
      continue;
    }
    try {
      const rows = conn.provider === "google_ads" ? await googleSpend(conn, days, mode) : await microsoftSpend(conn, days, mode);
      out.push({ connection: conn.id, rows: await upsert(conn.workspace_id, conn.provider === "google_ads" ? "google" : "microsoft", rows) });
      await markConnection(conn.id, "ok");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      out.push({ connection: conn.id, rows: 0, error: msg });
      await raiseAlert(conn.workspace_id, { type: "spend_sync", severity: "warning", title: `Spend sync failed for ${conn.display_name ?? conn.provider}`, detail: { error: msg.slice(0, 300) }, dedupeKey: `spend:${conn.id}` });
    }
  }
  return out;
}

/**
 * Manual spend import (works before any ad-platform approval).
 * Columns (header row, any order): date, platform, campaign, campaign_id, cost, clicks, impressions, geo, adgroup_id
 */
export async function importSpendCsv(workspaceId: string, csv: string) {
  const [head, ...rows] = parseCsv(csv);
  if (!head) throw new Error("The file is empty.");
  const h = head.map((x) => x.trim().toLowerCase());
  const col = (n: string) => h.indexOf(n);
  if (col("date") < 0 || col("cost") < 0) throw new Error('The header row must include at least "date" and "cost".');
  const byPlatform = new Map<string, (SpendRow & { geo?: string; adgroup_id?: string })[]>();
  let bad = 0;
  for (const r of rows) {
    const get = (n: string) => (col(n) >= 0 ? (r[col(n)] ?? "").trim() : "");
    const raw = get("date");
    const iso = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(raw) ? (() => { const [m, d, y] = raw.split("/"); return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`; })() : "";
    const cost = Number(get("cost").replace(/[$,]/g, ""));
    if (!iso || !Number.isFinite(cost)) {
      bad++;
      continue;
    }
    const platform = (get("platform") || "google").toLowerCase().includes("micro") || get("platform").toLowerCase().includes("bing") ? "microsoft" : (get("platform") || "google").toLowerCase();
    const list = byPlatform.get(platform) ?? [];
    list.push({ date: iso, campaign: get("campaign"), campaign_id: get("campaign_id"), cost, clicks: Number(get("clicks")) || 0, impressions: Number(get("impressions")) || 0, geo: get("geo"), adgroup_id: get("adgroup_id") });
    byPlatform.set(platform, list);
  }
  let n = 0;
  for (const [platform, list] of byPlatform) n += await upsert(workspaceId, platform, list);
  return { imported: n, skipped: bad };
}
