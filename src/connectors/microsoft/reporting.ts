import "server-only";
import { inflateRawSync } from "node:zlib";
import type { ConnectorMode } from "@/lib/env";
import { accessToken } from "../tokens";
import { ConnectorError, isRetryableStatus, type Connection } from "../types";
import type { SpendRow } from "../google/ads";
import { parseCsv } from "@/core/csv";

/**
 * Microsoft Advertising REST: Reporting v13 (spend) and Campaign Management v13 conversion goals.
 * From 1 Oct 2026 new features ship on REST only; SOAP retires 31 Jan 2027. Confirm paths/fields before live.
 */
const REPORTING = { live: "https://reporting.api.bingads.microsoft.com/Reporting/v13", test: "https://reporting.api.sandbox.bingads.microsoft.com/Reporting/v13" };
const CAMPAIGN = { live: "https://campaign.api.bingads.microsoft.com/CampaignManagement/v13", test: "https://campaign.api.sandbox.bingads.microsoft.com/CampaignManagement/v13" };

async function headers(conn: Connection) {
  const dev = process.env.MICROSOFT_DEVELOPER_TOKEN;
  if (!dev) throw new ConnectorError("MICROSOFT_DEVELOPER_TOKEN is not set", false);
  if (!conn.external_account || !conn.login_account) throw new ConnectorError("Microsoft account ID and customer ID are required", false);
  return {
    authorization: `Bearer ${await accessToken(conn)}`,
    DeveloperToken: dev,
    CustomerId: conn.login_account,
    CustomerAccountId: conn.external_account,
    "content-type": "application/json",
  };
}

/** Minimal ZIP reader for the single-file report archive (stored or deflated). */
export function unzipFirst(buf: Buffer): string {
  if (buf.readUInt32LE(0) !== 0x04034b50) return buf.toString("utf8"); // not a zip: plain CSV
  const method = buf.readUInt16LE(8);
  const compSize = buf.readUInt32LE(18);
  const nameLen = buf.readUInt16LE(26);
  const extraLen = buf.readUInt16LE(28);
  const start = 30 + nameLen + extraLen;
  const data = buf.subarray(start, compSize ? start + compSize : undefined);
  return (method === 8 ? inflateRawSync(data) : data).toString("utf8").replace(/^﻿/, "");
}

export function parseSpendCsv(csv: string): SpendRow[] {
  const [head, ...rows] = parseCsv(csv);
  if (!head) return [];
  const ix = (n: string) => head.findIndex((h) => h.trim().toLowerCase() === n.toLowerCase());
  const [d, id, name, spend, clicks, imp] = ["TimePeriod", "CampaignId", "CampaignName", "Spend", "Clicks", "Impressions"].map(ix);
  return rows.map((r) => ({
    date: r[d],
    campaign_id: r[id] ?? "",
    campaign: r[name] ?? "",
    cost: Number(String(r[spend] ?? "0").replace(/,/g, "")) || 0,
    clicks: Number(r[clicks] ?? 0) || 0,
    impressions: Number(r[imp] ?? 0) || 0,
  }));
}

export async function microsoftSpend(conn: Connection, days: number, mode: ConnectorMode): Promise<SpendRow[]> {
  if (mode === "dry_run") return [];
  const base = mode === "live" ? REPORTING.live : REPORTING.test;
  const h = await headers(conn);
  const today = new Date();
  const from = new Date(Date.now() - days * 86_400_000);
  const dt = (x: Date) => ({ Day: x.getUTCDate(), Month: x.getUTCMonth() + 1, Year: x.getUTCFullYear() });
  const submit = await fetch(`${base}/GenerateReport/Submit`, {
    method: "POST",
    headers: h,
    body: JSON.stringify({
      ReportRequest: {
        Type: "CampaignPerformanceReportRequest",
        Format: "Csv",
        ExcludeReportHeader: true,
        ExcludeReportFooter: true,
        ReturnOnlyCompleteData: false,
        Aggregation: "Daily",
        Columns: ["TimePeriod", "CampaignId", "CampaignName", "Spend", "Clicks", "Impressions"],
        Scope: { AccountIds: [Number(conn.external_account)] },
        Time: { CustomDateRangeStart: dt(from), CustomDateRangeEnd: dt(today) },
      },
    }),
  });
  const s = (await submit.json().catch(() => ({}))) as { ReportRequestId?: string };
  if (!submit.ok || !s.ReportRequestId) throw new ConnectorError(`Microsoft report submit ${submit.status}`, isRetryableStatus(submit.status), submit.status);
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const poll = await fetch(`${base}/GenerateReport/Poll`, { method: "POST", headers: h, body: JSON.stringify({ ReportRequestId: s.ReportRequestId }) });
    const p = (await poll.json().catch(() => ({}))) as { ReportRequestStatus?: { Status?: string; ReportDownloadUrl?: string | null } };
    const st = p.ReportRequestStatus?.Status;
    if (st === "Success") {
      if (!p.ReportRequestStatus?.ReportDownloadUrl) return []; // no data in range
      const file = await fetch(p.ReportRequestStatus.ReportDownloadUrl);
      return parseSpendCsv(unzipFirst(Buffer.from(await file.arrayBuffer())));
    }
    if (st === "Error") throw new ConnectorError("Microsoft report failed", true);
  }
  throw new ConnectorError("Microsoft report timed out", true);
}

/** DEL-03: offline conversion goals per stage (excluded from bidding until promoted). */
export function conversionGoalBody(names: { stage: string; name: string }[], currency: string) {
  return {
    ConversionGoals: names.map(({ name }) => ({
      Type: "OfflineConversion",
      Name: name,
      Scope: "Account",
      CountType: "All",
      ConversionWindowInMinutes: 90 * 24 * 60,
      Revenue: { Type: "VariableValue", CurrencyCode: currency },
      Status: "Active",
      ExcludeFromBidding: true,
    })),
  };
}

export async function createMicrosoftGoals(conn: Connection, names: { stage: string; name: string }[], currency: string, mode: ConnectorMode) {
  const body = conversionGoalBody(names, currency);
  if (mode === "dry_run") return { request: body };
  const res = await fetch(`${mode === "live" ? CAMPAIGN.live : CAMPAIGN.test}/ConversionGoals`, { method: "POST", headers: await headers(conn), body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ConnectorError(`Microsoft goal create ${res.status}: ${JSON.stringify(json).slice(0, 300)}`, isRetryableStatus(res.status), res.status);
  return { request: body, response: json };
}
