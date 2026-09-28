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
  /** Text beside the logo (when the logo already carries the company name). Defaults to appName. */
  logoLabel?: string;
  /** Built-in visual theme (fonts, canvas colour). Only the platform brand sets this. */
  theme?: "overeasy";
};

export const DEFAULT_BRAND: Omit<Brand, "appName"> = { primary: "#1f3a5f", accent: "#2f855a" };

/**
 * Overeasy platform brand (Overeasy Brand Kit, 2026): Black #272727 · White #FDF8F3 · Yellow #F9BE61 ·
 * Orange #FA942B · Light yellow #FFFFB1. Display font Cubano, body font Work Sans. Logo assets in public/brand/.
 * Applies to the platform itself (public site, sign-in on the platform domain) and to Overeasy's own direct
 * clients. Never applied under a partner organization (white-label), and switched off with PLATFORM_BRAND=none.
 */
export const OVEREASY_BRAND: Brand = {
  appName: "Overeasy Signal Engine",
  logoLabel: "Signal Engine",
  logoUrl: "/brand/overeasy-logo.svg",
  faviconUrl: "/brand/overeasy-icon.svg",
  primary: "#272727",
  accent: "#FA942B",
  supportEmail: "sales@overeasy.solutions",
  theme: "overeasy",
};

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

/** Neutral base for partner (white-label) chains. */
function base(): Brand {
  return { appName: env.platformAppName(), ...DEFAULT_BRAND };
}

/** Base for the platform itself and its direct clients. */
function platformBase(): Brand {
  if (process.env.PLATFORM_BRAND === "none") return base();
  return { ...OVEREASY_BRAND, ...(process.env.PLATFORM_APP_NAME ? { appName: process.env.PLATFORM_APP_NAME } : {}) };
}

/** Root → leaf chain. Partners (and everything under them) never see the platform brand. */
function resolveChain(ordered: { type: string; brand: unknown }[]): Brand {
  if (ordered.some((o) => o.type === "partner")) {
    return ordered.filter((o) => o.type !== "platform").reduce<Brand>((acc, o) => ({ ...acc, ...sanitizeBrand(o.brand as Partial<Brand>) }), base());
  }
  return ordered.reduce<Brand>((acc, o) => ({ ...acc, ...sanitizeBrand(o.brand as Partial<Brand>) }), platformBase());
}

type OrgRow = { id: string; parent_id: string | null; type: string; brand: Partial<Brand> | null };

/** Brand for an organization: its own values over its parents' values over the platform default. */
export const brandForOrg = cache(async (orgId: string | null | undefined): Promise<Brand> => {
  if (!orgId || !env.isConfigured()) return platformBase();
  try {
    const chain: OrgRow[] = [];
    let id: string | null = orgId;
    for (let i = 0; id && i < 5; i++) {
      const { data }: { data: OrgRow | null } = await admin().from("organizations").select("id,parent_id,type,brand").eq("id", id).maybeSingle<OrgRow>();
      if (!data) break;
      chain.unshift(data);
      id = data.parent_id;
    }
    // Partners must never inherit the platform's name or logo.
    return resolveChain(chain);
  } catch {
    return platformBase();
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
  return resolveChain(ordered);
}

/** Brand resolved from the request host (partner custom domain), used before sign-in. */
export const brandForHost = cache(async (): Promise<{ brand: Brand; orgId: string | null }> => {
  const h = await headers();
  const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "").split(":")[0].toLowerCase();
  // Platform domain (no partner custom domain matched): platform brand.
  if (!host || !env.isConfigured()) return { brand: platformBase(), orgId: null };
  try {
    const { data } = await admin().from("organizations").select("id").eq("custom_domain", host).maybeSingle<{ id: string }>();
    if (!data) return { brand: platformBase(), orgId: null };
    return { brand: await brandForOrg(data.id), orgId: data.id };
  } catch {
    return { brand: platformBase(), orgId: null };
  }
});

const SYSTEM_FONT = `ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif`;

export function brandCssVars(b: Brand): string {
  const t = b.theme === "overeasy";
  return `:root{--brand:${b.primary};--brand-accent:${b.accent};--brand-canvas:${t ? "#FDF8F3" : "#f6f7f9"};--brand-font:${t ? `"Work Sans",${SYSTEM_FONT}` : SYSTEM_FONT};}`;
}
