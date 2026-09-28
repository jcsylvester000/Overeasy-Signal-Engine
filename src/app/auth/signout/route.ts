import { NextResponse } from "next/server";
import { userClient } from "@/lib/supabase/server";

export async function POST(req: Request) {
  const sb = await userClient();
  await sb.auth.signOut();
  return NextResponse.redirect(new URL("/login", req.url), { status: 303 });
}
