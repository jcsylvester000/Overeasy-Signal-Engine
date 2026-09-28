import { createPublicKey, verify } from "node:crypto";

/**
 * Verifies HighLevel's X-GHL-Signature (Ed25519 over the raw body, base64 signature).
 * The legacy X-WH-Signature (RSA) was deprecated on 1 Sep 2026 and is not accepted.
 */
export function verifyGhlSignature(rawBody: string, signatureB64: string | null, publicKeyPem: string): boolean {
  if (!signatureB64 || !publicKeyPem) return false;
  try {
    const key = createPublicKey(publicKeyPem.includes("BEGIN") ? publicKeyPem : `-----BEGIN PUBLIC KEY-----\n${publicKeyPem}\n-----END PUBLIC KEY-----`);
    return verify(null, Buffer.from(rawBody, "utf8"), key, Buffer.from(signatureB64, "base64"));
  } catch {
    return false;
  }
}
