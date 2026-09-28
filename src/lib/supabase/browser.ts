"use client";
import { createBrowserClient } from "@supabase/ssr";

/** Browser client (anon/publishable key, RLS applies). Used only for MFA flows that must run client-side. */
export function browserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase is not configured");
  return createBrowserClient(url, key);
}
