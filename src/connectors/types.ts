import type { ConnectorMode } from "@/lib/env";

export type Connection = {
  id: string;
  workspace_id: string;
  provider: "ghl" | "google_ads" | "microsoft_ads" | "generic_crm";
  mode: ConnectorMode;
  external_account: string | null;
  login_account: string | null;
  display_name: string | null;
  token_secret_id: string | null;
  scopes: string[];
  settings: Record<string, unknown>;
  status: "ok" | "error" | "expired" | "disconnected";
};

/** One conversion to upload, already valued and window-checked by the value engine. */
export type OutboundConversion = {
  jobId: string;
  transactionId: string;
  value: number;
  currency: string;
  eventTime: string; // ISO
  clickIds: { gclid?: string | null; gbraid?: string | null; wbraid?: string | null; msclkid?: string | null };
  emailSha256?: string | null;
  /** Microsoft-normalised email hash (differs from Google). */
  emailSha256Ms?: string | null;
  phoneSha256?: string | null;
  consent: { adUserData: "granted" | "denied" | "unknown"; adPersonalization: "granted" | "denied" | "unknown" };
};

export type SendResult = {
  /** Per job id. */
  results: Record<string, { ok: boolean; retryable: boolean; error?: string }>;
  request: unknown; // redacted request (hashes only, no raw PII, no tokens)
  response: unknown;
};

export class ConnectorError extends Error {
  constructor(
    message: string,
    public retryable: boolean,
    public status?: number,
  ) {
    super(message);
  }
}

export function isRetryableStatus(status: number) {
  return status === 429 || status >= 500;
}
