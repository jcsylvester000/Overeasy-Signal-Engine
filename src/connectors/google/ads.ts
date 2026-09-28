import "server-only";
import type { ConnectorMode } from "@/lib/env";
import { accessToken } from "../tokens";
import { ConnectorError, isRetryableStatus, type Connection } from "../types";

/**
 * Google Ads API (REST): spend reporting (GAQL) and conversion-action setup.
 * Since 9 Sep 2026 access levels belong to the Google Cloud project; the developer-token header is sent only if set.
 * Confirm GOOGLE_ADS_API_VERSION against the current release before going live.
 */
const version = () => process.env.GOOGLE_ADS_API_VERSION || "v22";
const base = () => `https://googleads.googleapis.com/${version()}`;
const cid = (s: string) => s.replace(/-/g, "");

async function headers(conn: Connection) {
  const h: Record<string, string> = { authorization: `Bearer ${await accessToken(conn)}`, "content-type": "application/json" };
  if (process.env.GOOGLE_ADS_DEVELOPER_TOKEN) h["developer-token"] = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  if (conn.login_account) h["login-customer-id"] = cid(conn.login_account);
  return h;
}

export type SpendRow = { date: string; campaign_id: string; campaign: string; cost: number; clicks: number; impressions: number };

export function spendQuery(days: number) {
  const to = new Date();
  const from = new Date(Date.now() - days * 86_400_000);
  const d = (x: Date) => x.toISOString().slice(0, 10);
  return `SELECT segments.date, campaign.id, campaign.name, metrics.cost_micros, metrics.clicks, metrics.impressions FROM campaign WHERE segments.date BETWEEN '${d(from)}' AND '${d(to)}'`;
}

type GaqlRow = { segments?: { date?: string }; campaign?: { id?: string; name?: string }; metrics?: { costMicros?: string; clicks?: string; impressions?: string } };

export function parseSearchStream(batches: { results?: GaqlRow[] }[]): SpendRow[] {
  return batches.flatMap((b) =>
    (b.results ?? []).map((r) => ({
      date: r.segments?.date ?? "",
      campaign_id: String(r.campaign?.id ?? ""),
      campaign: r.campaign?.name ?? "",
      cost: Math.round(Number(r.metrics?.costMicros ?? 0) / 10_000) / 100,
      clicks: Number(r.metrics?.clicks ?? 0),
      impressions: Number(r.metrics?.impressions ?? 0),
    })),
  );
}

export async function googleSpend(conn: Connection, days: number, mode: ConnectorMode): Promise<SpendRow[]> {
  if (mode === "dry_run") return [];
  if (!conn.external_account) throw new ConnectorError("Google Ads customer ID missing", false);
  const res = await fetch(`${base()}/customers/${cid(conn.external_account)}/googleAds:searchStream`, { method: "POST", headers: await headers(conn), body: JSON.stringify({ query: spendQuery(days) }) });
  const json = await res.json().catch(() => []);
  if (!res.ok) throw new ConnectorError(`Google Ads reporting ${res.status}`, isRetryableStatus(res.status), res.status);
  return parseSearchStream(Array.isArray(json) ? json : [json]);
}

const CATEGORY: Record<string, string> = { submitted: "SUBMIT_LEAD_FORM", qualified: "QUALIFIED_LEAD", opportunity: "QUALIFIED_LEAD", contract: "CONVERTED_LEAD", sold: "CONVERTED_LEAD", funded: "CONVERTED_LEAD" };

/** DEL-03: create one offline (UPLOAD_CLICKS) conversion action per stage, secondary by default. */
export function conversionActionOps(names: { stage: string; name: string }[], currency: string) {
  return {
    operations: names.map(({ stage, name }) => ({
      create: {
        name,
        type: "UPLOAD_CLICKS",
        category: CATEGORY[stage] ?? "QUALIFIED_LEAD",
        status: "ENABLED",
        primaryForGoal: false,
        valueSettings: { defaultValue: 0, defaultCurrencyCode: currency, alwaysUseDefaultValue: false },
      },
    })),
  };
}

export async function createGoogleConversionActions(conn: Connection, names: { stage: string; name: string }[], currency: string, mode: ConnectorMode) {
  const body = conversionActionOps(names, currency);
  if (mode === "dry_run") return { request: body, ids: names.map((n) => `dry-run-${n.stage}`) };
  if (!conn.external_account) throw new ConnectorError("Google Ads customer ID missing", false);
  const res = await fetch(`${base()}/customers/${cid(conn.external_account)}/conversionActions:mutate`, {
    method: "POST",
    headers: await headers(conn),
    body: JSON.stringify({ ...body, validateOnly: mode !== "live" }),
  });
  const json = (await res.json().catch(() => ({}))) as { results?: { resourceName?: string }[] };
  if (!res.ok) throw new ConnectorError(`Google conversion action create ${res.status}: ${JSON.stringify(json).slice(0, 300)}`, isRetryableStatus(res.status), res.status);
  return { request: body, ids: (json.results ?? []).map((r) => r.resourceName?.split("/").pop() ?? (mode === "test" ? "validated" : "")) };
}
