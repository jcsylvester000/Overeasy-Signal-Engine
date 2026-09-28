import "server-only";
import type { ConnectorMode } from "@/lib/env";
import { accessToken } from "../tokens";
import { ConnectorError, isRetryableStatus, type Connection } from "../types";

/**
 * Typed HighLevel (GoHighLevel) API v2 client. Rate limits: 100 req / 10 s burst, 200k / day per app per resource.
 * Calls are paced per location (in-process token bucket) and Inngest concurrency keys cap parallelism per connection.
 * In dry_run the client returns the request it would have made.
 */
const BASE = "https://services.leadconnectorhq.com";
const VERSION = "2021-07-28";

/** Custom fields OSE creates on install (LCM-05). Keys are stable; GHL ids are stored in connection.settings.fieldIds. */
export const OSE_FIELDS = [
  { key: "ose_lead_id", name: "OSE Lead ID", dataType: "TEXT" },
  { key: "leadvalue_initial", name: "Lead Value (initial)", dataType: "MONETORY" },
  { key: "leadvalue_current", name: "Lead Value (current)", dataType: "MONETORY" },
  { key: "lead_type", name: "Lead Type", dataType: "TEXT" },
  { key: "score_version", name: "Score Version", dataType: "NUMERICAL" },
  { key: "ose_sync_status", name: "Ad Signal Status", dataType: "LARGE_TEXT" },
  { key: "window_expires_on", name: "Upload Window Expires", dataType: "DATE" },
] as const;
export type OseFieldKey = (typeof OSE_FIELDS)[number]["key"];

const buckets = new Map<string, { tokens: number; at: number }>();
async function pace(locationId: string) {
  const cap = 90; // stay under 100 / 10 s
  for (;;) {
    const now = Date.now();
    const b = buckets.get(locationId) ?? { tokens: cap, at: now };
    b.tokens = Math.min(cap, b.tokens + ((now - b.at) / 10_000) * cap);
    b.at = now;
    if (b.tokens >= 1) {
      b.tokens -= 1;
      buckets.set(locationId, b);
      return;
    }
    buckets.set(locationId, b);
    await new Promise((r) => setTimeout(r, 150));
  }
}

export type GhlCall = { method: "GET" | "POST" | "PUT"; path: string; body?: unknown };
export type GhlResult<T = unknown> = { mode: ConnectorMode; request: GhlCall; status: number; data: T | null };

export async function ghl<T = unknown>(conn: Connection, call: GhlCall, mode: ConnectorMode): Promise<GhlResult<T>> {
  if (mode === "dry_run" || mode === "test") {
    // HighLevel has no sandbox; "test" behaves like dry_run for CRM writes.
    return { mode, request: call, status: 0, data: null };
  }
  const locationId = conn.external_account;
  if (!locationId) throw new ConnectorError("GHL locationId missing on the connection", false);
  await pace(locationId);
  const token = await accessToken(conn);
  const res = await fetch(`${BASE}${call.path}`, {
    method: call.method,
    headers: { authorization: `Bearer ${token}`, Version: VERSION, accept: "application/json", ...(call.body ? { "content-type": "application/json" } : {}) },
    body: call.body ? JSON.stringify(call.body) : undefined,
  });
  const data = (await res.json().catch(() => null)) as T | null;
  if (!res.ok) throw new ConnectorError(`GHL ${call.method} ${call.path} → ${res.status}`, isRetryableStatus(res.status), res.status);
  return { mode, request: call, status: res.status, data };
}

export function customFieldsPayload(conn: Connection, values: Partial<Record<OseFieldKey, string | number | null>>) {
  const ids = (conn.settings.fieldIds ?? {}) as Partial<Record<OseFieldKey, string>>;
  return Object.entries(values)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => (ids[k as OseFieldKey] ? { id: ids[k as OseFieldKey], field_value: v } : { key: `contact.${k}`, field_value: v }));
}

export const ghlCalls = {
  createCustomField: (locationId: string, f: (typeof OSE_FIELDS)[number]): GhlCall => ({
    method: "POST",
    path: `/locations/${locationId}/customFields`,
    body: { name: f.name, dataType: f.dataType, fieldKey: `contact.${f.key}`, model: "contact" },
  }),
  upsertContact: (locationId: string, body: Record<string, unknown>): GhlCall => ({ method: "POST", path: "/contacts/upsert", body: { locationId, ...body } }),
  updateContact: (contactId: string, body: Record<string, unknown>): GhlCall => ({ method: "PUT", path: `/contacts/${contactId}`, body }),
  pipelines: (locationId: string): GhlCall => ({ method: "GET", path: `/opportunities/pipelines?locationId=${encodeURIComponent(locationId)}` }),
};
