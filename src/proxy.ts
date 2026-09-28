import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Next.js 16 proxy (formerly middleware): refreshes the Supabase session cookie and keeps
 * signed-out users out of the dashboard. Public API, tag and auth routes are excluded by the matcher.
 */
export async function proxy(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  let res = NextResponse.next({ request: req });
  if (!url || !key) return res;

  const sb = createServerClient(url, key, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) req.cookies.set(name, value);
        res = NextResponse.next({ request: req });
        for (const { name, value, options } of list) res.cookies.set(name, value, options);
      },
    },
  });
  // getClaims(): refreshes an expiring session and verifies the JWT locally (no Auth-server round trip with asymmetric keys).
  const { data } = await sb.auth.getClaims();
  const path = req.nextUrl.pathname;
  const protectedPath = path.startsWith("/app") || path.startsWith("/w/") || path.startsWith("/org/") || path.startsWith("/team");
  if (!data?.claims?.sub && protectedPath) {
    const to = req.nextUrl.clone();
    to.pathname = "/login";
    to.search = `?next=${encodeURIComponent(path)}`;
    return NextResponse.redirect(to);
  }
  // A temporary password set by an admin must be changed before anything else.
  const meta = data?.claims?.app_metadata as { must_change_password?: boolean } | undefined;
  if (meta?.must_change_password && protectedPath && path !== "/app/account") {
    const to = req.nextUrl.clone();
    to.pathname = "/app/account";
    to.search = "?must=1";
    return NextResponse.redirect(to);
  }
  return res;
}

export const config = {
  matcher: ["/((?!api/|v1/|ose\\.js|_next/|favicon\\.ico|robots\\.txt|login|auth/|trust|privacy|terms|docs).*)"],
};
