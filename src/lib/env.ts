import "server-only";

/**
 * Environment access. Nothing throws at import time (Next evaluates route modules during build);
 * missing values throw only when a feature that needs them is used.
 */
function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set. See .env.example.`);
  return v;
}

export const env = {
  supabaseUrl: () => need("NEXT_PUBLIC_SUPABASE_URL"),
  supabaseAnonKey: () => need("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  serviceRoleKey: () => need("SUPABASE_SERVICE_ROLE_KEY"),
  encryptionKey: () => need("OSE_ENCRYPTION_KEY"),
  hashPepper: () => process.env.OSE_HASH_PEPPER ?? "",
  appUrl: () => (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, ""),
  platformAppName: () => process.env.PLATFORM_APP_NAME || "Signal Engine",
  /** Global ceiling for connector sends. A connection can never be more "live" than this. */
  connectorMode: (): "dry_run" | "test" | "live" => {
    const m = process.env.CONNECTOR_MODE;
    return m === "live" || m === "test" ? m : "dry_run";
  },
  ghlWebhookPublicKey: () => process.env.GHL_WEBHOOK_PUBLIC_KEY ?? "",
  inngestEnabled: () => Boolean(process.env.INNGEST_EVENT_KEY) || process.env.INNGEST_DEV === "1",
  isConfigured: () => Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
};

const ORDER = { dry_run: 0, test: 1, live: 2 } as const;
export type ConnectorMode = keyof typeof ORDER;

/** Effective mode = the stricter of the connection's own mode and the global ceiling. */
export function effectiveMode(connectionMode: string | null | undefined): ConnectorMode {
  const c = (connectionMode as ConnectorMode) in ORDER ? (connectionMode as ConnectorMode) : "dry_run";
  const g = env.connectorMode();
  return ORDER[c] <= ORDER[g] ? c : g;
}
