import { describe, expect, it } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";
import { buildIngestRequest } from "../google/datamanager";
import { buildApplyRequest } from "../microsoft/offline";
import { verifyGhlSignature } from "../ghl/verify";
import type { OutboundConversion } from "../types";

const conv = (over: Partial<OutboundConversion> = {}): OutboundConversion => ({
  jobId: "j1",
  transactionId: "lead-1-qualified",
  value: 4318,
  currency: "USD",
  eventTime: "2026-09-28T14:02:11.123Z",
  clickIds: { gclid: "Cj0K", msclkid: "ms-1" },
  emailSha256: "e".repeat(64),
  phoneSha256: "p".repeat(64),
  consent: { adUserData: "granted", adPersonalization: "granted" },
  ...over,
});

describe("Google Data Manager payload", () => {
  it("targets the conversion action and dedupes on transactionId", () => {
    const body = buildIngestRequest({ customerId: "123-456-7890", loginCustomerId: "111-222-3333", conversionActionId: "987", events: [conv()], validateOnly: true });
    expect(body.destinations[0]).toMatchObject({ operatingAccount: { accountId: "1234567890" }, loginAccount: { accountId: "1112223333" }, productDestinationId: "987" });
    expect(body.validateOnly).toBe(true);
    expect(body.events[0]).toMatchObject({ transactionId: "lead-1-qualified", conversionValue: 4318, currency: "USD", adIdentifiers: { gclid: "Cj0K" } });
    expect(body.events[0].userData?.userIdentifiers).toHaveLength(2);
  });

  it("omits hashed user data when ad_user_data consent is denied", () => {
    const body = buildIngestRequest({ customerId: "1", conversionActionId: "2", events: [conv({ consent: { adUserData: "denied", adPersonalization: "denied" } })], validateOnly: false });
    expect(body.events[0].userData).toBeUndefined();
    expect(body.events[0].consent).toEqual({ adUserData: "CONSENT_DENIED", adPersonalization: "CONSENT_DENIED" });
  });

  it("uses gbraid when there is no gclid", () => {
    const body = buildIngestRequest({ customerId: "1", conversionActionId: "2", events: [conv({ clickIds: { gbraid: "GB" } })], validateOnly: false });
    expect(body.events[0].adIdentifiers).toEqual({ gbraid: "GB" });
  });
});

describe("Microsoft offline conversions payload", () => {
  it("maps fields and strips milliseconds", () => {
    const body = buildApplyRequest("OSE – Qualified", [conv()]);
    expect(body.OfflineConversions[0]).toMatchObject({ MicrosoftClickId: "ms-1", ConversionName: "OSE – Qualified", ConversionTime: "2026-09-28T14:02:11Z", ConversionValue: 4318, ConversionCurrencyCode: "USD" });
  });
});

describe("GHL webhook signature (Ed25519)", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const body = JSON.stringify({ type: "OpportunityStageUpdate", locationId: "loc1", id: "opp1" });
  const sig = sign(null, Buffer.from(body), privateKey).toString("base64");

  it("accepts a valid signature", () => expect(verifyGhlSignature(body, sig, pem)).toBe(true));
  it("rejects a tampered body", () => expect(verifyGhlSignature(body.replace("opp1", "opp2"), sig, pem)).toBe(false));
  it("rejects a missing signature or key", () => {
    expect(verifyGhlSignature(body, null, pem)).toBe(false);
    expect(verifyGhlSignature(body, sig, "")).toBe(false);
  });
});
