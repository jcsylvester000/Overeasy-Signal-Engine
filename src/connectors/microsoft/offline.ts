import "server-only";
import type { ConnectorMode } from "@/lib/env";
import { accessToken } from "../tokens";
import { ConnectorError, isRetryableStatus, type Connection, type OutboundConversion, type SendResult } from "../types";

/**
 * Microsoft Advertising Campaign Management v13 — ApplyOfflineConversions (REST). ≤ 1,000 per request.
 * Wait 2 h after creating an offline conversion goal before the first upload; data can take up to 6 h to appear.
 * There is no official Node SDK; this is a typed REST client. Re-check field names before switching to live.
 */
const ENDPOINTS = {
  live: "https://campaign.api.bingads.microsoft.com/CampaignManagement/v13/OfflineConversions/Apply",
  test: "https://campaign.api.sandbox.bingads.microsoft.com/CampaignManagement/v13/OfflineConversions/Apply",
};
const MAX = 1000;

/** Microsoft expects UTC without offset, e.g. 2026-09-28T14:02:11Z */
const msTime = (iso: string) => new Date(iso).toISOString().replace(/\.\d{3}Z$/, "Z");

export function buildApplyRequest(goalName: string, events: OutboundConversion[]) {
  return {
    OfflineConversions: events.map((e) => ({
      MicrosoftClickId: e.clickIds.msclkid,
      ConversionName: goalName,
      ConversionTime: msTime(e.eventTime),
      ConversionValue: e.value,
      ConversionCurrencyCode: e.currency,
      ...(e.consent.adUserData !== "denied" && (e.emailSha256Ms ?? e.emailSha256) ? { HashedEmailAddress: e.emailSha256Ms ?? e.emailSha256 } : {}),
      ...(e.consent.adUserData !== "denied" && e.phoneSha256 ? { HashedPhoneNumber: e.phoneSha256 } : {}),
    })),
  };
}

type PartialError = { Index?: number; Message?: string; Code?: number };

export async function sendMicrosoft(conn: Connection, goalName: string, events: OutboundConversion[], mode: ConnectorMode): Promise<SendResult> {
  if (!conn.external_account || !conn.login_account) throw new ConnectorError("Microsoft account ID and customer ID are required on the connection", false);
  const results: SendResult["results"] = {};
  const requests: unknown[] = [];
  const responses: unknown[] = [];

  for (let i = 0; i < events.length; i += MAX) {
    const batch = events.slice(i, i + MAX);
    const body = buildApplyRequest(goalName, batch);
    requests.push(body);

    if (mode === "dry_run") {
      responses.push({ dryRun: true, events: batch.length });
      for (const e of batch) results[e.jobId] = { ok: true, retryable: false };
      continue;
    }

    const devToken = process.env.MICROSOFT_DEVELOPER_TOKEN;
    if (!devToken) throw new ConnectorError("MICROSOFT_DEVELOPER_TOKEN is not set", false);
    const token = await accessToken(conn);
    const res = await fetch(mode === "live" ? ENDPOINTS.live : ENDPOINTS.test, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        DeveloperToken: devToken,
        CustomerId: conn.login_account,
        CustomerAccountId: conn.external_account,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as { PartialErrors?: PartialError[] };
    responses.push({ status: res.status, body: json });
    const partial = new Map<number, string>();
    for (const pe of json.PartialErrors ?? []) if (typeof pe.Index === "number") partial.set(pe.Index, `${pe.Code ?? ""} ${pe.Message ?? ""}`.trim());
    batch.forEach((e, idx) => {
      if (!res.ok) results[e.jobId] = { ok: false, retryable: isRetryableStatus(res.status), error: `HTTP ${res.status}` };
      else if (partial.has(idx)) results[e.jobId] = { ok: false, retryable: false, error: partial.get(idx) };
      else results[e.jobId] = { ok: true, retryable: false };
    });
  }
  return { results, request: requests, response: responses };
}
