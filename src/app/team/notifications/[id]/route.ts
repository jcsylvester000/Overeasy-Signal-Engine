import { NextResponse } from "next/server";
import { admin } from "@/lib/supabase/admin";
import { currentUser } from "@/lib/tenancy";

/** Opens a notification: marks it read (own notifications only) and redirects to its link. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await currentUser();
  const home = new URL("/team/notifications", req.url);
  if (!user) return NextResponse.redirect(new URL("/login", req.url));
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.redirect(home);
  const db = admin();
  const { data } = await db.from("notifications").select("id,link").eq("id", id).eq("user_id", user.id).maybeSingle();
  if (!data) return NextResponse.redirect(home);
  await db.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", id).is("read_at", null);
  const link = typeof data.link === "string" && data.link.startsWith("/") && !data.link.startsWith("//") ? data.link : "/team/notifications";
  return NextResponse.redirect(new URL(link, req.url));
}
