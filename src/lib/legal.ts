import "server-only";
import type { Brand } from "@/lib/brand";

/**
 * Legal identity shown on the privacy policy and terms. Set per deployment (the platform's own domain);
 * partner agencies publish their own documents. DRAFT TEXT — counsel must review before submitting to Google/GHL/Microsoft.
 */
export function legalIdentity(brand: Brand) {
  return {
    entity: process.env.LEGAL_ENTITY_NAME || brand.appName,
    contact: process.env.LEGAL_CONTACT_EMAIL || brand.supportEmail || "privacy@example.com",
    address: process.env.LEGAL_ADDRESS || "",
    governingLaw: process.env.LEGAL_GOVERNING_LAW || "the State of Delaware, USA",
    updated: process.env.LEGAL_LAST_UPDATED || "2026-09-29",
  };
}
