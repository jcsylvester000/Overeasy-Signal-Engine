import "server-only";
import { z } from "zod";
import { admin, must } from "@/lib/supabase/admin";
import { encrypt } from "@/lib/crypto";
import { hashEmail, hashEmailMicrosoft, hashPhone } from "@/core/hash";
import { sanitizeAnswers } from "@/core/privacy";
import { evaluate } from "@/core/scoring/evaluate";
import { windowExpiresOn } from "@/core/value/engine";
import { publishedScoring, publishedValue } from "./models";
import { dispatch } from "./dispatch";
import { emitEvent } from "./outbound";

/** Attribution captured by the tag or sent explicitly by a server. */
export const Attribution = z
  .object({
    gclid: z.string().max(200).nullish(),
    gbraid: z.string().max(200).nullish(),
    wbraid: z.string().max(200).nullish(),
    msclkid: z.string().max(200).nullish(),
    fbclid: z.string().max(300).nullish(),
    utm_source: z.string().max(200).nullish(),
    utm_medium: z.string().max(200).nullish(),
    utm_campaign: z.string().max(200).nullish(),
    utm_term: z.string().max(200).nullish(),
    utm_content: z.string().max(200).nullish(),
    campaign_id: z.string().max(100).nullish(),
    adgroup_id: z.string().max(100).nullish(),
    keyword: z.string().max(200).nullish(),
    device: z.string().max(40).nullish(),
    landing_url: z.string().max(2000).nullish(),
    referrer: z.string().max(2000).nullish(),
    click_ts: z.string().datetime({ offset: true }).nullish(),
  })
  .partial();
export type Attribution = z.infer<typeof Attribution>;

export const Consent = z
  .object({
    ad_user_data: z.enum(["granted", "denied", "unknown"]).optional(),
    ad_personalization: z.enum(["granted", "denied", "unknown"]).optional(),
    gpc: z.boolean().optional(),
  })
  .partial();

export const IntakeBody = z.object({
  form: z.string().max(100).optional(),
  visitor_id: z.string().max(100).nullish(),
  external_ref: z.string().max(200).nullish(),
  email: z.string().max(320).nullish(),
  phone: z.string().max(40).nullish(),
  name: z.string().max(200).nullish(),
  geo: z.string().max(100).nullish(),
  answers: z.record(z.string().max(48), z.union([z.string().max(500), z.number(), z.null()])).default({}),
  attribution: Attribution.optional(),
  consent: Consent.optional(),
  test: z.boolean().optional(),
});
export type IntakeBody = z.infer<typeof IntakeBody>;

type VisitRow = Attribution & { id: string; touch: "first" | "last"; consent: Record<string, string> | null };

const CLICK_KEYS = ["gclid", "gbraid", "wbraid", "msclkid", "fbclid"] as const;

/**
 * Lead intake pipeline (spec §12 step 2): resolve attribution → hash PII → score → type → store → emit.
 * Attribution is bound server-side from recorded visits; browser-sent values only fill gaps (ITP-safe).
 */
export async function intakeLead(input: IntakeBody & { workspaceId: string; siteId?: string | null; source: "tag" | "api" | "simulator" | "crm" | "import"; idempotencyKey?: string | null; via?: string | null }) {
  const db = admin();

  if (input.idempotencyKey) {
    const { data: existing } = await db
      .from("leads")
      .select("id,score,lead_type,score_version")
      .eq("workspace_id", input.workspaceId)
      .eq("idempotency_key", input.idempotencyKey)
      .maybeSingle();
    if (existing) return { lead_id: existing.id as string, score: Number(existing.score), lead_type: existing.lead_type as string, score_version: existing.score_version as number, duplicate: true };
  }

  const ws = must(await db.from("workspaces").select("id,org_id,currency,settings").eq("id", input.workspaceId).single(), "workspace");
  const settings = (ws.settings ?? {}) as { storeRawPii?: boolean; piiRetentionDays?: number; phoneCountryCode?: string };

  // 1. Attribution: first/last touch recorded by /v1/collect for this visitor.
  let first: VisitRow | null = null;
  let last: VisitRow | null = null;
  if (input.visitor_id && input.siteId) {
    const { data: visits } = await db
      .from("visits")
      .select("*")
      .eq("site_id", input.siteId)
      .eq("visitor_id", input.visitor_id)
      .order("created_at", { ascending: false })
      .limit(20);
    for (const v of (visits ?? []) as VisitRow[]) {
      if (v.touch === "last" && !last) last = v;
      if (v.touch === "first") first = v;
    }
  }
  const explicit = input.attribution ?? {};
  const bound: Attribution = { ...(first ?? {}), ...(last ?? {}) };
  for (const [k, v] of Object.entries(explicit)) if (v && !bound[k as keyof Attribution]) (bound as Record<string, unknown>)[k] = v;
  const attribution: Attribution = Object.fromEntries(
    Object.entries(Attribution.shape).map(([k]) => [k, (bound as Record<string, unknown>)[k] ?? null]).filter(([, v]) => v !== null && v !== undefined),
  );
  const hasClick = CLICK_KEYS.some((k) => attribution[k]);
  const clickTs = attribution.click_ts ? new Date(attribution.click_ts) : hasClick ? new Date() : null;

  // 2. Consent: explicit > visit-recorded > unknown.
  const visitConsent = (last?.consent ?? first?.consent ?? {}) as Record<string, string>;
  const gpc = input.consent?.gpc === true || (visitConsent as Record<string, unknown>).gpc === true;
  const consent = {
    ad_user_data: input.consent?.ad_user_data ?? visitConsent.ad_user_data ?? "unknown",
    ad_personalization: gpc ? "denied" : (input.consent?.ad_personalization ?? visitConsent.ad_personalization ?? "unknown"),
    ...(gpc ? { gpc: true } : {}),
  };

  // 3. Hash PII (normalised SHA-256) — hashes are kept for CRM matching and platform uploads.
  const cc = settings.phoneCountryCode ?? (ws.currency === "PHP" ? "63" : "1");
  const emailSha = hashEmail(input.email);
  const emailShaMs = hashEmailMicrosoft(input.email);
  const phoneSha = hashPhone(input.phone, cc);

  // 4. Score with the published model (version recorded on the lead).
  const scoring = await publishedScoring(input.workspaceId);
  const value = await publishedValue(input.workspaceId);
  const answers = input.answers ?? {};
  const result = scoring ? evaluate(scoring.model, answers) : null;
  // Capture allowlist: store only answers for fields the workspace defined; sensitive answers are masked after scoring.
  const stored = scoring ? sanitizeAnswers(scoring.model, answers).kept : {};
  const geo = input.geo ?? (typeof answers.state === "string" ? answers.state : null);
  const expires = value ? windowExpiresOn(value.model, clickTs) : null;

  const lead = must(
    await db
      .from("leads")
      .insert({
        workspace_id: input.workspaceId,
        site_id: input.siteId ?? null,
        source: input.source,
        form: input.form ?? null,
        external_ref: input.external_ref ?? null,
        visitor_id: input.visitor_id ?? null,
        first_touch_visit_id: first?.id ?? null,
        last_touch_visit_id: last?.id ?? null,
        attribution,
        email_sha256: emailSha,
        email_sha256_ms: emailShaMs,
        phone_sha256: phoneSha,
        geo,
        answers: stored,
        score: result?.score ?? null,
        score_raw: result?.raw ?? null,
        score_capped: result?.capped ?? false,
        score_version: scoring?.version ?? null,
        lead_type: result?.leadType ?? null,
        velocity_band: result?.velocity ?? null,
        canonical_stage: "submitted",
        currency: ws.currency,
        click_ts: clickTs?.toISOString() ?? null,
        window_expires_on: expires ? expires.toISOString().slice(0, 10) : null,
        consent,
        is_test: Boolean(input.test) || input.source === "simulator",
        idempotency_key: input.idempotencyKey ?? null,
        capture_via: input.via ?? null,
      })
      .select("id")
      .single(),
    "insert lead",
  );

  // 5. Raw PII is optional, encrypted and purged on schedule (default 30 days).
  if (settings.storeRawPii !== false && (input.email || input.phone || input.name)) {
    const days = settings.piiRetentionDays ?? 30;
    await db.from("lead_pii").insert({
      lead_id: lead.id,
      workspace_id: input.workspaceId,
      enc_email: input.email ? encrypt(input.email.trim()) : null,
      enc_phone: input.phone ? encrypt(input.phone.trim()) : null,
      enc_name: input.name ? encrypt(input.name.trim()) : null,
      purge_after: new Date(Date.now() + days * 86_400_000).toISOString(),
    });
  }

  await db.from("stage_events").insert({ workspace_id: input.workspaceId, lead_id: lead.id, canonical_stage: "submitted", source: "intake" });
  await dispatch("ose/lead.created", { workspaceId: input.workspaceId, leadId: lead.id });
  await emitEvent(input.workspaceId, "lead.created", { lead_id: lead.id, created_at: new Date().toISOString(), score: result?.score ?? null, lead_type: result?.leadType ?? null, source: input.source, form: input.form ?? null });

  return { lead_id: lead.id as string, score: result?.score ?? null, lead_type: result?.leadType ?? null, score_version: scoring?.version ?? null, duplicate: false };
}

/**
 * Embedded third-party forms (Typeform, GHL iframe, Calendly…) reach us as a contact-less "embed" lead from the tag,
 * and later as a CRM event with the contact. Returns that anonymous lead so the CRM event merges into it instead of
 * creating a duplicate. Exact match on the visitor id (passed into the embed via data-embed-params → ose_visitor);
 * otherwise only when exactly one unmatched embed lead arrived in the last 15 minutes.
 */
export async function findAnonymousEmbedLead(workspaceId: string, visitorId?: string | null): Promise<string | null> {
  const db = admin();
  if (visitorId) {
    const { data } = await db
      .from("leads")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("visitor_id", visitorId)
      .is("email_sha256", null)
      .is("phone_sha256", null)
      .gte("created_at", new Date(Date.now() - 7 * 86_400_000).toISOString())
      .order("created_at", { ascending: false })
      .limit(1);
    if (data?.[0]) return data[0].id as string;
  }
  const { data } = await db
    .from("leads")
    .select("id")
    .eq("workspace_id", workspaceId)
    .like("capture_via", "embed:%")
    .is("email_sha256", null)
    .is("phone_sha256", null)
    .gte("created_at", new Date(Date.now() - 15 * 60_000).toISOString())
    .limit(2);
  return data?.length === 1 ? (data[0].id as string) : null;
}

/** Adds contact details (hashed; raw encrypted per workspace policy) to an existing contact-less lead. */
export async function attachContact(workspaceId: string, leadId: string, c: { email?: string | null; phone?: string | null; name?: string | null }) {
  const db = admin();
  const ws = must(await db.from("workspaces").select("currency,settings").eq("id", workspaceId).single(), "workspace");
  const settings = (ws.settings ?? {}) as { storeRawPii?: boolean; piiRetentionDays?: number; phoneCountryCode?: string };
  const cc = settings.phoneCountryCode ?? (ws.currency === "PHP" ? "63" : "1");
  await db
    .from("leads")
    .update({ email_sha256: hashEmail(c.email), email_sha256_ms: hashEmailMicrosoft(c.email), phone_sha256: hashPhone(c.phone, cc) })
    .eq("id", leadId)
    .eq("workspace_id", workspaceId);
  if (settings.storeRawPii !== false && (c.email || c.phone || c.name)) {
    const days = settings.piiRetentionDays ?? 30;
    await db.from("lead_pii").upsert({
      lead_id: leadId,
      workspace_id: workspaceId,
      enc_email: c.email ? encrypt(c.email.trim()) : null,
      enc_phone: c.phone ? encrypt(c.phone.trim()) : null,
      enc_name: c.name ? encrypt(c.name.trim()) : null,
      purge_after: new Date(Date.now() + days * 86_400_000).toISOString(),
    });
  }
}
