import "server-only";
import { admin } from "@/lib/supabase/admin";
import { ConnectorError, type Connection } from "./types";

export type OAuthTokens = { access_token: string; refresh_token?: string; expires_at?: number; token_type?: string };

type RefreshConfig = { tokenUrl: string; clientId?: string; clientSecret?: string; scope?: string };

const REFRESH: Record<string, () => RefreshConfig> = {
  google_ads: () => ({ tokenUrl: "https://oauth2.googleapis.com/token", clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET }),
  microsoft_ads: () => ({
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    clientId: process.env.MICROSOFT_CLIENT_ID,
    clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
    scope: "https://ads.microsoft.com/msads.manage offline_access",
  }),
  ghl: () => ({ tokenUrl: "https://services.leadconnectorhq.com/oauth/token", clientId: process.env.GHL_CLIENT_ID, clientSecret: process.env.GHL_CLIENT_SECRET }),
};

/** Store OAuth tokens in Supabase Vault; the connection row only keeps the secret id. */
export async function storeTokens(conn: Pick<Connection, "id">, tokens: OAuthTokens): Promise<string> {
  const { data, error } = await admin().rpc("ose_vault_put", { p_name: `conn:${conn.id}`, p_secret: JSON.stringify(tokens) });
  if (error) throw new Error(`vault_put: ${error.message}`);
  await admin().from("connections").update({ token_secret_id: data }).eq("id", conn.id);
  return data as string;
}

/** Access token for a live/test call, refreshed when within 2 minutes of expiry. */
export async function accessToken(conn: Connection): Promise<string> {
  if (!conn.token_secret_id) throw new ConnectorError(`${conn.provider}: not connected (no OAuth tokens)`, false);
  const { data, error } = await admin().rpc("ose_vault_get", { p_id: conn.token_secret_id });
  if (error || !data) throw new ConnectorError(`${conn.provider}: token read failed`, true);
  const tokens = JSON.parse(data as string) as OAuthTokens;
  if (!tokens.expires_at || tokens.expires_at - 120 > Date.now() / 1000) return tokens.access_token;

  const cfg = REFRESH[conn.provider]?.();
  if (!cfg?.clientId || !cfg.clientSecret || !tokens.refresh_token) {
    await markConnection(conn.id, "expired", "Token expired and cannot be refreshed");
    throw new ConnectorError(`${conn.provider}: token expired`, false);
  }
  const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: cfg.clientId, client_secret: cfg.clientSecret });
  if (cfg.scope) body.set("scope", cfg.scope);
  const res = await fetch(cfg.tokenUrl, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
  if (!res.ok) {
    await markConnection(conn.id, "expired", `Refresh failed (${res.status})`);
    throw new ConnectorError(`${conn.provider}: refresh failed ${res.status}`, res.status >= 500);
  }
  const fresh = (await res.json()) as { access_token: string; refresh_token?: string; expires_in?: number };
  const next: OAuthTokens = {
    access_token: fresh.access_token,
    refresh_token: fresh.refresh_token ?? tokens.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + (fresh.expires_in ?? 3600),
  };
  await storeTokens(conn, next);
  return next.access_token;
}

export async function markConnection(id: string, status: Connection["status"], error?: string) {
  await admin()
    .from("connections")
    .update(status === "ok" ? { status, error: null, last_ok_at: new Date().toISOString() } : { status, error: error ?? null })
    .eq("id", id);
}
