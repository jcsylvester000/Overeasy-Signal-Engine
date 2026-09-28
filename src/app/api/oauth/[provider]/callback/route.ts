import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { admin } from "@/lib/supabase/admin";
import { audit } from "@/lib/audit";
import { currentUser } from "@/lib/tenancy";
import { exchangeCode, verifyState, type OAuthProvider } from "@/connectors/oauth";
import { markConnection, storeTokens } from "@/connectors/tokens";
import { installGhl } from "@/server/crm";
import type { Connection } from "@/connectors/types";

export const dynamic = "force-dynamic";

/** OAuth redirect target: verify state + nonce, exchange the code, store tokens in Vault, mark the connection ok. */
export async function GET(req: Request, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  const url = new URL(req.url);
  const jar = await cookies();
  const state = verifyState(url.searchParams.get("state"), jar.get("ose_oauth_nonce")?.value);
  const fail = (ws: string | undefined, msg: string) =>
    NextResponse.redirect(new URL(ws ? `/w/${ws}/connections?error=${encodeURIComponent(msg)}` : `/app`, url.origin));
  if (!state) return fail(undefined, "Invalid or expired sign-in state");
  const user = await currentUser();
  if (!user || user.id !== state.uid) return fail(state.ws, "Please sign in again and retry");
  if (url.searchParams.get("error")) return fail(state.ws, `Sign-in was cancelled (${url.searchParams.get("error")})`);
  const code = url.searchParams.get("code");
  if (!code) return fail(state.ws, "No authorization code returned");

  const db = admin();
  const { data: conn } = await db.from("connections").select("*").eq("id", state.conn).eq("workspace_id", state.ws).maybeSingle<Connection>();
  if (!conn || conn.provider !== provider) return fail(state.ws, "Connection not found");

  try {
    const { tokens, raw } = await exchangeCode(provider as OAuthProvider, code);
    await storeTokens(conn, tokens);
    const patch: Record<string, unknown> = { status: "ok", error: null, last_ok_at: new Date().toISOString() };
    if (provider === "ghl" && typeof raw.locationId === "string") patch.external_account = raw.locationId;
    if (typeof raw.scope === "string") patch.scopes = raw.scope.split(/[ ,]+/);
    await db.from("connections").update(patch).eq("id", conn.id);
    await audit({ workspaceId: state.ws, actorId: user.id, action: "connection.oauth", entity: "connection", entityId: conn.id, diff: { provider } });
    if (provider === "ghl") await installGhl({ ...conn, ...(patch as Partial<Connection>) } as Connection).catch(() => {});
  } catch (e) {
    await markConnection(conn.id, "error", e instanceof Error ? e.message : "OAuth failed");
    return fail(state.ws, "Could not complete sign-in with the platform");
  }
  const res = NextResponse.redirect(new URL(`/w/${state.ws}/connections?saved=${encodeURIComponent("Connected. Tokens are stored in the encrypted vault.")}`, url.origin));
  res.cookies.delete({ name: "ose_oauth_nonce", path: "/api/oauth" });
  return res;
}
