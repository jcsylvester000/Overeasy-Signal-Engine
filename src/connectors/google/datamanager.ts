import "server-only";
import type { ConnectorMode } from "@/lib/env";
import { accessToken } from "../tokens";
import { ConnectorError, isRetryableStatus, type Connection, type OutboundConversion, type SendResult } from "../types";

/**
 * Google Data Manager API — events.ingest (required for new offline-conversion integrations since 15 Jun 2026).
 * One request per (account, conversion action). Google deduplicates on transactionId within a conversion action.
 * NOTE: field names follow developers.google.com/data-manager/api (Sep 2026). Re-check before switching to live.
 */
const ENDPOINT = "https://datamanager.googleapis.com/v1/events:ingest";
const MAX_EVENTS = 2000;

const consentValue = (c: "granted" | "denied" | "unknown") => (c === "granted" ? "CONSENT_GRANTED" : c === "denied" ? "CONSENT_DENIED" : "CONSENT_STATUS_UNSPECIFIED");

export function buildIngestRequest(args: {
  customerId: string;
  loginCustomerId?: string | null;
  conversionActionId: string;
  events: OutboundConversion[];
  validateOnly: boolean;
}) {
  const clean = (id: string) => id.replace(/-/g, "");
  return {
    destinations: [
      {
        operatingAccount: { accountType: "GOOGLE_ADS", accountId: clean(args.customerId) },
        ...(args.loginCustomerId ? { loginAccount: { accountType: "GOOGLE_ADS", accountId: clean(args.loginCustomerId) } } : {}),
        productDestinationId: args.conversionActionId,
      },
    ],
    encoding: "HEX",
    validateOnly: args.validateOnly,
    events: args.events.map((e) => {
      const adIdentifiers: Record<string, string> = {};
      if (e.clickIds.gclid) adIdentifiers.gclid = e.clickIds.gclid;
      else if (e.clickIds.gbraid) adIdentifiers.gbraid = e.clickIds.gbraid;
      else if (e.clickIds.wbraid) adIdentifiers.wbraid = e.clickIds.wbraid;
      // Hashed user data is only sent when the user consented to ad_user_data.
      const ids = e.consent.adUserData === "denied" ? [] : [
        ...(e.emailSha256 ? [{ emailAddress: e.emailSha256 }] : []),
        ...(e.phoneSha256 ? [{ phoneNumber: e.phoneSha256 }] : []),
      ];
      return {
        transactionId: e.transactionId,
        eventTimestamp: e.eventTime,
        conversionValue: e.value,
        currency: e.currency,
        eventSource: "WEB",
        ...(Object.keys(adIdentifiers).length ? { adIdentifiers } : {}),
        ...(ids.length ? { userData: { userIdentifiers: ids } } : {}),
        consent: { adUserData: consentValue(e.consent.adUserData), adPersonalization: consentValue(e.consent.adPersonalization) },
      };
    }),
  };
}

export async function sendGoogle(conn: Connection, conversionActionId: string, events: OutboundConversion[], mode: ConnectorMode): Promise<SendResult> {
  if (!conn.external_account) throw new ConnectorError("Google Ads customer ID missing on the connection", false);
  const results: SendResult["results"] = {};
  const requests: unknown[] = [];
  const responses: unknown[] = [];

  for (let i = 0; i < events.length; i += MAX_EVENTS) {
    const batch = events.slice(i, i + MAX_EVENTS);
    const body = buildIngestRequest({
      customerId: conn.external_account,
      loginCustomerId: conn.login_account,
      conversionActionId,
      events: batch,
      validateOnly: mode !== "live",
    });
    requests.push(body);

    if (mode === "dry_run") {
      responses.push({ dryRun: true, events: batch.length });
      for (const e of batch) results[e.jobId] = { ok: true, retryable: false };
      continue;
    }

    const token = await accessToken(conn);
    const res = await fetch(ENDPOINT, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    responses.push({ status: res.status, body: json });
    for (const e of batch) {
      results[e.jobId] = res.ok ? { ok: true, retryable: false } : { ok: false, retryable: isRetryableStatus(res.status), error: `HTTP ${res.status}: ${JSON.stringify(json).slice(0, 300)}` };
    }
  }
  return { results, request: requests, response: responses };
}
