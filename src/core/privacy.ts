import type { ScoringModel } from "./scoring/types";

/**
 * Privacy rules applied at intake and before every platform upload (compliance backlog B1, B2, B8).
 * Pure functions; the policy lives in workspace settings.
 */

export type LeadConsent = {
  ad_user_data?: "granted" | "denied" | "unknown";
  ad_personalization?: "granted" | "denied" | "unknown";
  /** Global Privacy Control / universal opt-out signal seen at capture. */
  gpc?: boolean;
  /** Explicit opt-out of sale/sharing/targeted advertising recorded later (DSAR or CMP webhook). */
  opted_out?: boolean;
};

export type PrivacySettings = {
  /** Health, legal, financial-distress etc.: never upload hashed contact data; click IDs only. */
  regulatedVertical?: boolean;
  /** What to do when a lead carries an opt-out signal (GPC or recorded opt-out). */
  optOutPolicy?: "skip_upload" | "click_id_only";
};

export type UploadPolicy = {
  upload: boolean;
  hashedUserData: boolean;
  adPersonalization: "granted" | "denied" | "unknown";
  reason?: string;
};

export function uploadPolicy(consent: LeadConsent | null | undefined, settings: PrivacySettings | null | undefined): UploadPolicy {
  const c = consent ?? {};
  const s = settings ?? {};
  const optedOut = c.gpc === true || c.opted_out === true;
  if (optedOut && (s.optOutPolicy ?? "skip_upload") === "skip_upload") {
    return { upload: false, hashedUserData: false, adPersonalization: "denied", reason: "Opt-out signal (GPC or recorded opt-out): not uploaded." };
  }
  let hashed = true;
  const reasons: string[] = [];
  if (s.regulatedVertical) {
    hashed = false;
    reasons.push("regulated vertical: click ID only");
  }
  if (c.ad_user_data === "denied") {
    hashed = false;
    reasons.push("ad_user_data denied");
  }
  if (optedOut) {
    hashed = false;
    reasons.push("opt-out: click ID only");
  }
  return {
    upload: true,
    hashedUserData: hashed,
    adPersonalization: optedOut ? "denied" : (c.ad_personalization ?? "unknown"),
    reason: reasons.length ? reasons.join("; ") : undefined,
  };
}

/**
 * Capture allowlist + sensitive-field handling: only answers for fields defined in the scoring model are kept;
 * sensitive fields are scored first, then stored as "[sensitive]".
 */
export function sanitizeAnswers(model: ScoringModel | null | undefined, answers: Record<string, string | number | null | undefined>) {
  if (!model) return { kept: {} as Record<string, string | number>, dropped: Object.keys(answers) };
  const kept: Record<string, string | number> = {};
  const dropped: string[] = [];
  for (const [k, v] of Object.entries(answers)) {
    const f = model.fields.find((x) => x.key === k);
    if (!f || v === null || v === undefined || v === "") {
      if (!f) dropped.push(k);
      continue;
    }
    kept[k] = f.sensitive ? "[sensitive]" : v;
  }
  return { kept, dropped };
}
