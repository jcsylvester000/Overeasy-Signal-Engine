import { NextResponse } from "next/server";
import { requireUser, workspaceAccess } from "@/lib/tenancy";
import { admin } from "@/lib/supabase/admin";
import { authorizeUrl, oauthEnabled, signState, type OAuthProvider } from "@/connectors/oauth";

export const dynamic = "force-dynamic";
const PROVIDERS: OAuthProvider[] = ["google_ads", "microsoft_ads", "ghl"];

/** GET /api/oauth/{provider}/start?ws=<workspace>&conn=<connection> — admin+ only. */
export async function GET(req: Request, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  const url = new URL(req.url);
  const ws = url.searchParams.get("ws") ?? "";
  const conn = url.searchParams.get("conn") ?? "";
  if (!PROVIDERS.includes(provider as OAuthProvider)) return NextResponse.json({ error: "Unknown provider" }, { status: 404 });
  const p = provider as OAuthProvider;
  if (!oauthEnabled(p)) return NextResponse.redirect(new URL(`/w/${ws}/connections?error=${encodeURIComponent("This platform's app is not approved/configured yet.")}`, url.origin));

  const user = await requireUser();
  const access = await workspaceAccess(ws);
  if (access.rank < 4) return NextResponse.redirect(new URL(`/w/${ws}/connections?error=Admins%20only`, url.origin));
  const { data: c } = await admin().from("connections").select("id,provider").eq("id", conn).eq("workspace_id", ws).maybeSingle();
  if (!c || c.provider !== p) return NextResponse.redirect(new URL(`/w/${ws}/connections?error=Connection%20not%20found`, url.origin));

  const { state, nonce } = signState({ ws, conn, uid: user.id });
  const res = NextResponse.redirect(authorizeUrl(p, state));
  res.cookies.set("ose_oauth_nonce", nonce, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/api/oauth" });
  return res;
}
