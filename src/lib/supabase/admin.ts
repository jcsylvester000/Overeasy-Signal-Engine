import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

let cached: SupabaseClient | null = null;

/**
 * Service-role client. BYPASSES RLS — every query made with it must filter by workspace_id explicitly.
 * Used only by ingest, webhooks, background jobs and Vault access.
 */
export function admin(): SupabaseClient {
  if (!cached) {
    cached = createClient(env.supabaseUrl(), env.serviceRoleKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cached;
}

/** Throws a readable error for a Supabase { error } result. */
export function must<T>(res: { data: T; error: { message: string } | null }, what: string): NonNullable<T> {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  if (res.data === null || res.data === undefined) throw new Error(`${what}: not found`);
  return res.data as NonNullable<T>;
}
