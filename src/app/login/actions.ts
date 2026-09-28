"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { userClient } from "@/lib/supabase/server";

function safeNext(v: FormDataEntryValue | null) {
  const s = String(v ?? "/app");
  return s.startsWith("/") && !s.startsWith("//") ? s : "/app";
}

export async function signIn(fd: FormData) {
  const next = safeNext(fd.get("next"));
  const sb = await userClient();
  const { error } = await sb.auth.signInWithPassword({ email: String(fd.get("email") ?? ""), password: String(fd.get("password") ?? "") });
  if (error) redirect(`/login?error=${encodeURIComponent("Email or password is incorrect.")}&next=${encodeURIComponent(next)}`);
  redirect(next);
}

export async function sendMagicLink(fd: FormData) {
  const next = safeNext(fd.get("next"));
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
  const sb = await userClient();
  // shouldCreateUser: false — access is invite-only.
  await sb.auth.signInWithOtp({ email: String(fd.get("email") ?? ""), options: { shouldCreateUser: false, emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}` } });
  redirect(`/login?sent=1`); // same response whether or not the address exists
}
