import { createHash } from "node:crypto";

/**
 * Normalisation per Google Data Manager formatting guide (and Microsoft enhanced conversions):
 * email trimmed + lower-cased; phone in E.164; then SHA-256 hex.
 */
export function normalizeEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const e = email.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
}

/** Best-effort E.164. Numbers without a country code use `defaultCountryCode` (e.g. "1" for US/CA). */
export function normalizePhone(phone: string | null | undefined, defaultCountryCode = "1"): string | null {
  if (!phone) return null;
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 7) return null;
  if (trimmed.startsWith("+")) return `+${digits}`;
  if (trimmed.startsWith("00")) return `+${digits.slice(2)}`;
  if (defaultCountryCode === "1" && digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (defaultCountryCode === "63" && digits.length === 11 && digits.startsWith("0")) return `+63${digits.slice(1)}`;
  return `+${defaultCountryCode}${digits}`;
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function hashEmail(email: string | null | undefined): string | null {
  const n = normalizeEmail(email);
  return n ? sha256Hex(n) : null;
}

export function hashPhone(phone: string | null | undefined, defaultCountryCode = "1"): string | null {
  const n = normalizePhone(phone, defaultCountryCode);
  return n ? sha256Hex(n) : null;
}
