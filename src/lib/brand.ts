import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { admin } from "@/lib/supabase/admin";
import { env } from "@/lib/env";

/** White-label brand (ADM-02). No platform name is hard-coded in the client UI. */
export type Brand = {
  appName: string;
  logoUrl?: string;
  faviconUrl?: string;
  primary: string; // CSS colour
  accent: string;
  emailFrom?: string;
  supportEmail?: string;
};

export const DEFAULT_BRAND: Omit<Brand, "appName"> = { primary: "#1f3a5f", accent: "#2f855a" };

const HEX = /^#[0-9a-fA-F]{3,8}$/;

export function sanitizeBrand(input: Partial<Brand> | null | undefined): Partial<Brand> {
  if (!input) return {};
  const out: Partial<Brand> = {};
  if (typeof input.appName === "string" && input.appName.trim()) out.appName = input.appName.trim().slice(0, 60);
  for (const k of ["logoUrl", "faviconUrl"] as const) {
    const v = input[k];
    if (typeof v === "string" && /^https:\/\//.test(v)) out[k] = v.slice(0, 500);
  }
  for (const k of ["primary", "accent"] as const) {
    const v = input[k];
    if (typeof v === "string" && HEX.test(v)) out[k] = v;
  }
  for (const k of ["emailFrom", "supportEmail"] as const) {
    const v = input[k];
    if (typeof v === "string" && v.includes("@")) out[k] = v.slice(0, 200);
  }
  return out;
}

function base(): Brand {
  return { appName: env.platformAppName(), ...DEFAULT_BRAND };
}

type OrgRow = { id: string; parent_id: string | null; type: string; brand: Partial<Brand> | null };

/** Brand for an organization: its own values over its parents' values over the platform default. */
export const brandForOrg = cache(async (orgId: string | null | undefined): Promise<Brand> => {
  if (!orgId || !env.isConfigured()) return base();
  try {
    const chain: OrgRow[] = [];
    let id: string | null = orgId;
    for (let i = 0; id && i < 5; i++) {
      const { data }: { data: OrgRow | null } = await admin().from("organizations").select("id,parent_id,type,brand").eq("id", id).maybeSingle<OrgRow>();
      if (!data) break;
      chain.unshift(data);
      id = data.parent_id;
    }
    // Platform org brand is ignored on purpose: partners must never inherit the platform's name.
    return chain.filter((o) => o.type !== "platform").reduce<Brand>((acc, o) => ({ ...acc, ...sanitizeBrand(o.brand) }), base());
  } catch {
    return base();
  }
});

/** Brand from an already-loaded organization chain (no queries). */
export function brandFromChain(chain: { id: string; parent_id: string | null; type: string; brand: unknown }[], orgId: string): Brand {
  const ordered: typeof chain = [];
  let cur = chain.find((o) => o.id === orgId);
  for (let i = 0; cur && i < 6; i++) {
    ordered.unshift(cur);
    cur = chain.find((o) => o.id === cur!.parent_id);
  }
  return ordered.filter((o) => o.type !== "platform").reduce<Brand>((acc, o) => ({ ...acc, ...sanitizeBrand(o.brand as Partial<Brand>) }), base());
}

/** Brand resolved from the request host (partner custom domain), used before sign-in. */
export const brandForHost = cache(async (): Promise<{ brand: Brand; orgId: string | null }> => {
  const h = await headers();
  const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "").split(":")[0].toLowerCase();
  if (!host || !env.isConfigured()) return { brand: base(), orgId: null };
  try {
    const { data } = await admin().from("organizations").select("id").eq("custom_domain", host).maybeSingle<{ id: string }>();
    if (!data) return { brand: base(), orgId: null };
    return { brand: await brandForOrg(data.id), orgId: data.id };
  } catch {
    return { brand: base(), orgId: null };
  }
});

export function brandCssVars(b: Brand): string {
  return `:root{--brand:${b.primary};--brand-accent:${b.accent};}`;
}
