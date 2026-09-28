import "server-only";
import { hmacHex, randomToken, safeEqual } from "@/lib/crypto";
import { env } from "@/lib/env";
import type { OAuthTokens } from "./tokens";

/**
 * OAuth 2.0 connect flows (authorization code). Turned on per provider when its client ID/secret env vars exist,
 * i.e. after the platform approves the app. Tokens go to Supabase Vault via storeTokens().
 * Scope strings follow the platforms' docs as of Sep 2026 — confirm against the approved app before going live.
 */
export type OAuthProvider = "google_ads" | "microsoft_ads" | "ghl";

type ProviderConfig = {
  authUrl: string;
  tokenUrl: string;
  clientId?: string;
  clientSecret?: string;
  scope: string;
  extraAuth?: Record<string, string>;
  extraToken?: Record<string, string>;
};

function cfg(p: OAuthProvider): ProviderConfig {
  switch (p) {
    case "google_ads":
      return {
        authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
        tokenUrl: "https://oauth2.googleapis.com/token",
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        // Data Manager (offline conversion upload) + Google Ads (spend reporting, conversion-action setup).
        scope: "https://www.googleapis.com/auth/datamanager https://www.googleapis.com/auth/adwords",
        extraAuth: { access_type: "offline", prompt: "consent", include_granted_scopes: "true" },
      };
    case "microsoft_ads":
      return {
        authUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
        tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
        clientId: process.env.MICROSOFT_CLIENT_ID,
        clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
        scope: "https://ads.microsoft.com/msads.manage offline_access openid profile",
        extraAuth: { prompt: "select_account" },
      };
    case "ghl":
      return {
        authUrl: "https://marketplace.gohighlevel.com/oauth/chooselocation",
        tokenUrl: "https://services.leadconnectorhq.com/oauth/token",
        clientId: process.env.GHL_CLIENT_ID,
        clientSecret: process.env.GHL_CLIENT_SECRET,
        scope: "contacts.readonly contacts.write opportunities.readonly opportunities.write locations/customFields.readonly locations/customFields.write",
        extraToken: { user_type: "Location" },
      };
  }
}

export function oauthEnabled(p: OAuthProvider): boolean {
  const c = cfg(p);
  return Boolean(c.clientId && c.clientSecret);
}

export const redirectUri = (p: OAuthProvider) => `${env.appUrl()}/api/oauth/${p}/callback`;

type StatePayload = { ws: string; conn: string; uid: string; n: string; exp: number };

export function signState(p: Omit<StatePayload, "n" | "exp">): { state: string; nonce: string } {
  const payload: StatePayload = { ...p, n: randomToken(12), exp: Math.floor(Date.now() / 1000) + 600 };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return { state: `${body}.${hmacHex(env.encryptionKey(), body)}`, nonce: payload.n };
}

export function verifyState(state: string | null, nonceCookie: string | undefined): StatePayload | null {
  if (!state || !nonceCookie) return null;
  const [body, sig] = state.split(".");
  if (!body || !sig || !safeEqual(hmacHex(env.encryptionKey(), body), sig)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString()) as StatePayload;
    if (p.exp < Date.now() / 1000 || !safeEqual(p.n, nonceCookie)) return null;
    return p;
  } catch {
    return null;
  }
}

export function authorizeUrl(p: OAuthProvider, state: string): string {
  const c = cfg(p);
  const u = new URL(c.authUrl);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", c.clientId ?? "");
  u.searchParams.set("redirect_uri", redirectUri(p));
  u.searchParams.set("scope", c.scope);
  u.searchParams.set("state", state);
  for (const [k, v] of Object.entries(c.extraAuth ?? {})) u.searchParams.set(k, v);
  return u.toString();
}

export async function exchangeCode(p: OAuthProvider, code: string): Promise<{ tokens: OAuthTokens; raw: Record<string, unknown> }> {
  const c = cfg(p);
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(p),
    client_id: c.clientId ?? "",
    client_secret: c.clientSecret ?? "",
    ...(p === "microsoft_ads" ? { scope: c.scope } : {}),
    ...(c.extraToken ?? {}),
  });
  const res = await fetch(c.tokenUrl, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body });
  const raw = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || typeof raw.access_token !== "string") throw new Error(`Token exchange failed (${res.status})`);
  return {
    raw,
    tokens: {
      access_token: raw.access_token,
      refresh_token: typeof raw.refresh_token === "string" ? raw.refresh_token : undefined,
      expires_at: Math.floor(Date.now() / 1000) + (typeof raw.expires_in === "number" ? raw.expires_in : 3600),
      token_type: typeof raw.token_type === "string" ? raw.token_type : undefined,
    },
  };
}
