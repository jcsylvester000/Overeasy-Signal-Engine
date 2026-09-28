import "server-only";
import { randomUUID } from "node:crypto";
import { admin, must } from "@/lib/supabase/admin";
import { sha256Hex } from "@/core/hash";
import { evaluate } from "@/core/scoring/evaluate";
import { planSignals, windowExpiresOn } from "@/core/value/engine";
import { RUNGS, type Rung } from "@/core/stages";
import { landScoring, landValue } from "@/core/templates/land-acquisition";
import type { Platform } from "@/core/value/types";
import { createWorkspace } from "./provision";

/**
 * Demo workspace: a fully populated land-buyer client with ~120 days of realistic traffic, leads, CRM stage
 * progressions, value-ladder uploads (dry run), ad spend, alerts, CRM operations and an automation registry.
 * Everything is generated with the same pure engines the live pipeline uses, so every screen shows consistent data.
 */

const DAY = 86_400_000;

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CAMPAIGNS: { platform: Platform; name: string; id: string; weight: number; quality: number; cpc: number }[] = [
  { platform: "google", name: "Search – Inherited Land", id: "g-101", weight: 22, quality: 1.25, cpc: 4.8 },
  { platform: "google", name: "Search – Sell Land Fast", id: "g-102", weight: 26, quality: 1.0, cpc: 3.9 },
  { platform: "google", name: "Search – Tax Burden", id: "g-103", weight: 12, quality: 1.1, cpc: 3.2 },
  { platform: "google", name: "PMax – Land Sellers", id: "g-104", weight: 18, quality: 0.6, cpc: 1.9 },
  { platform: "microsoft", name: "Bing – Sell Land", id: "m-201", weight: 12, quality: 1.05, cpc: 2.4 },
  { platform: "microsoft", name: "Bing – Inherited", id: "m-202", weight: 6, quality: 1.2, cpc: 2.9 },
];
const STATES: [string, number][] = [["TX", 22], ["NC", 14], ["AZ", 12], ["FL", 12], ["GA", 10], ["TN", 9], ["NM", 8], ["CO", 7], ["OK", 6]];
const LOST_REASONS = ["No response", "Price too high", "Listed with realtor", "Title issues", "Not the owner", "Changed mind"];

function pickW<T>(r: () => number, items: T[], weight: (x: T) => number): T {
  const total = items.reduce((a, x) => a + weight(x), 0);
  let n = r() * total;
  for (const x of items) {
    n -= weight(x);
    if (n <= 0) return x;
  }
  return items[items.length - 1];
}

function answersFor(r: () => number, quality: number): Record<string, string> {
  const a: Record<string, string> = {};
  const pick = (key: string, opts: [string, number][]) => {
    if (r() < 0.9) a[key] = pickW(r, opts, (o) => o[1])[0];
  };
  const q = quality;
  pick("acreage", [["0-1", 8 / q], ["1-2", 12], ["2-5", 20], ["5-10", 22 * q], ["10-20", 18 * q], ["20+", 12 * q]]);
  pick("acquired", [["purchased", 40 / q], ["inherited_sole", 18 * q], ["inherited_shared", 14 * q], ["gift", 6], ["tax_sale", 8], ["other", 4]]);
  pick("years_owned", [["<1", 6], ["1-5", 18], ["5-10", 22], ["10-20", 26], ["20+", 22], ["not_sure", 6]]);
  pick("why_selling", [["inherited_dont_want", 14 * q], ["taxes_upkeep", 18], ["need_cash", 16], ["never_use", 14], ["too_far", 10], ["family", 8], ["moving", 6], ["just_looking", 14 / q]]);
  pick("taxes_current", [["yes", 70], ["no", 30 * q]]);
  pick("mortgage", [["yes", 20], ["no", 80]]);
  pick("listed_with_realtor", [["yes", 10 / q], ["no", 90]]);
  pick("deed_in_name", [["yes", 75], ["no", 12 * q], ["not_sure", 13]]);
  pick("road_access", [["yes", 65], ["no", 15], ["not_sure", 20]]);
  pick("price_flexibility", [["5", 14 * q], ["4", 24 * q], ["3", 30], ["2", 18], ["1", 14 / q]]);
  pick("timeline", [["asap", 22], ["30_days", 24], ["90_days", 28], ["flexible", 26]]);
  a.state = pickW(r, STATES, (s) => s[1])[0];
  return a;
}

async function insertChunks(table: string, rows: Record<string, unknown>[], size = 400) {
  for (let i = 0; i < rows.length; i += size) {
    const { error } = await admin().from(table).insert(rows.slice(i, i + size));
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

export async function createDemoWorkspace(orgId: string, actorId: string) {
  const db = admin();
  const r = rng(20260928);
  const now = Date.now();
  const days = 120;

  const wsId = await createWorkspace({ orgId, name: "Demo – Summit Land Co", templateId: "land-acquisition", domain: "summitlandco.example", actorId });
  const ws = must(await db.from("workspaces").select("settings").eq("id", wsId).single(), "workspace");
  await db
    .from("workspaces")
    .update({ settings: { ...(ws.settings as object), demo: true, reportRecipients: "", acks: { privacy: true, sales: true } } })
    .eq("id", wsId);

  const { data: site } = await db.from("sites").select("id").eq("workspace_id", wsId).single();
  await db.from("sites").update({ last_event_at: new Date(now - 7 * 60_000).toISOString(), tag_version: "1.0.0" }).eq("id", site!.id);
  const { data: conns } = await db.from("connections").select("id,provider").eq("workspace_id", wsId);
  const connOf = (p: string) => conns!.find((c) => c.provider === p)!.id;
  const gConn = connOf("google_ads");
  const mConn = connOf("microsoft_ads");
  const ghlConn = connOf("ghl");
  await db.from("connections").update({ display_name: "Google Ads – Summit Land (demo)", external_account: "123-456-7890", last_ok_at: new Date(now - 3600_000).toISOString() }).eq("id", gConn);
  await db.from("connections").update({ display_name: "Microsoft Ads – Summit Land (demo)", external_account: "98765432", login_account: "12345678", last_ok_at: new Date(now - 3600_000).toISOString() }).eq("id", mConn);
  await db.from("connections").update({ display_name: "GoHighLevel – Summit Land (demo)", external_account: "demo-location-7Hq2", settings: { fieldIds: {} }, last_ok_at: new Date(now - 600_000).toISOString() }).eq("id", ghlConn);

  // CRM pipeline mapping (as it would look after install).
  const stages: [string, string, string][] = [
    ["st-new", "New Lead", "submitted"],
    ["st-contacted", "Contacted", "ignore"],
    ["st-qual", "Qualified Seller", "qualified"],
    ["st-offer", "Offer Sent", "opportunity"],
    ["st-contract", "Under Contract", "contract"],
    ["st-assigned", "Assigned to Buyer", "sold"],
    ["st-funded", "Closed / Funded", "funded"],
    ["st-dead", "Dead", "lost"],
  ];
  await insertChunks(
    "stage_maps",
    stages.map(([id, name, c]) => ({ workspace_id: wsId, provider: "ghl", pipeline_id: "pl-sellers", pipeline_name: "Seller Pipeline", stage_id: id, stage_name: name, canonical_stage: c })),
  );
  const uploadStages = landValue.uploadStages;
  await insertChunks("conversion_destinations", [
    ...uploadStages.map((s) => ({ workspace_id: wsId, connection_id: gConn, platform: "google", canonical_stage: s, conversion_action_id: `70${RUNGS.indexOf(s)}1234`, role: s === "submitted" || s === "qualified" || s === "contract" ? "primary" : "secondary" })),
    ...uploadStages.map((s) => ({ workspace_id: wsId, connection_id: mConn, platform: "microsoft", canonical_stage: s, goal_name: `Summit – ${s[0].toUpperCase()}${s.slice(1)}`, role: "secondary" })),
  ]);

  const visits: Record<string, unknown>[] = [];
  const leads: Record<string, unknown>[] = [];
  const events: Record<string, unknown>[] = [];
  const jobs: Record<string, unknown>[] = [];
  const links: Record<string, unknown>[] = [];
  const ops: Record<string, unknown>[] = [];
  const spend: Record<string, unknown>[] = [];

  const leadsPerDay = 2.6;
  for (let d = days; d >= 0; d--) {
    const dayStart = now - d * DAY;
    // Spend per campaign per day (weekday effect).
    const weekday = new Date(dayStart).getUTCDay();
    const wf = weekday === 0 || weekday === 6 ? 0.7 : 1.1;
    for (const c of CAMPAIGNS) {
      const clicks = Math.max(1, Math.round((c.weight / 3) * wf * (0.7 + r() * 0.6)));
      spend.push({ workspace_id: wsId, platform: c.platform, date: new Date(dayStart).toISOString().slice(0, 10), campaign_id: c.id, campaign: c.name, adgroup_id: "", geo: "", cost: Math.round(clicks * c.cpc * (0.85 + r() * 0.3) * 100) / 100, clicks, impressions: Math.round(clicks * (18 + r() * 25)) });
    }
    const n = Math.round(leadsPerDay * wf * (0.6 + r() * 0.8));
    for (let k = 0; k < n; k++) {
      const c = pickW(r, CAMPAIGNS, (x) => x.weight);
      const answers = answersFor(r, c.quality);
      const res = evaluate(landScoring, answers);
      const clickTs = dayStart - Math.round(r() * 6 * 3600_000) - Math.round(r() * 2 * DAY);
      const createdAt = clickTs + Math.round((5 + r() * 40) * 60_000);
      if (createdAt > now) continue;
      const leadId = randomUUID();
      const visitor = `v_demo${leadId.slice(0, 8)}`;
      const clickId = `${c.platform === "google" ? "Cj0KCQjw" : "ms"}${leadId.replace(/-/g, "").slice(0, 18)}`;
      const iosGbraid = c.platform === "google" && r() < 0.12;
      const attribution: Record<string, string> = {
        ...(c.platform === "google" ? (iosGbraid ? { gbraid: `0AAAAA${clickId}` } : { gclid: clickId }) : { msclkid: clickId }),
        utm_source: c.platform === "google" ? "google" : "bing",
        utm_medium: "cpc",
        utm_campaign: c.name,
        campaign_id: c.id,
        keyword: pickW(r, [["sell my land", 5], ["sell inherited land", 3], ["cash for land", 4], ["we buy land", 3], ["sell land fast", 3]] as [string, number][], (x) => x[1])[0],
        device: r() < 0.62 ? "mobile" : "desktop",
        landing_url: `https://summitlandco.example/${c.name.toLowerCase().includes("inherit") ? "inherited-land" : c.name.toLowerCase().includes("tax") ? "tax-burden" : "sell-land"}`,
        click_ts: new Date(clickTs).toISOString(),
      };
      const gpc = r() < 0.03;
      const consent = { ad_user_data: r() < 0.94 ? "granted" : "denied", ad_personalization: gpc ? "denied" : "granted", ...(gpc ? { gpc: true } : {}) };
      const visitId = randomUUID();
      visits.push({ id: visitId, workspace_id: wsId, site_id: site!.id, visitor_id: visitor, touch: "first", ...attribution, consent, created_at: new Date(clickTs).toISOString() });
      const email = `seller${leadId.slice(0, 6)}@example.test`;

      // Stage progression by lead type and score.
      const q = res.score / 120;
      const speed = res.velocity === "fast" ? 0.5 : res.velocity === "slow" ? 2.2 : 1;
      const pQual = Math.min(0.85, 0.18 + q * 0.55 + (res.leadType === "Low Value" ? -0.15 : 0));
      const path: { stage: Rung | "lost"; at: number; actual?: number }[] = [{ stage: "submitted", at: createdAt }];
      let t = createdAt;
      const next = (p: number, avgDays: number, stage: Rung) => {
        if (r() > p) return false;
        t += Math.round((avgDays * speed * (0.4 + r() * 1.2)) * DAY);
        if (t > now) return false;
        path.push({ stage, at: t });
        return true;
      };
      let lost = false;
      if (next(pQual, 1.5, "qualified")) {
        if (next(0.62, 4, "opportunity")) {
          if (next(0.5, 8, "contract")) {
            if (next(0.9, 12, "sold") && next(0.95, 9, "funded")) {
              const spread = landValue.spreads[res.leadType] ?? landValue.spreads.default;
              path[path.length - 1].actual = Math.round(spread * (0.6 + r() * 0.8));
            }
          } else lost = t + 10 * DAY < now;
        } else lost = t + 7 * DAY < now;
      } else lost = createdAt + 5 * DAY < now;
      if (lost) path.push({ stage: "lost", at: Math.min(now, t + Math.round((2 + r() * 6) * DAY)) });

      const lostReason = lost ? LOST_REASONS[Math.floor(r() * LOST_REASONS.length)] : null;
      const reached = path.filter((p) => p.stage !== "lost").at(-1)!.stage as Rung;
      const current = lost ? "lost" : reached;

      // Value ladder uploads (dry run), exactly as the engine would plan them.
      const platforms: Platform[] = [c.platform];
      const sent: Record<string, number> = { google: 0, microsoft: 0 };
      let valueCurrent = 0;
      for (const p of path) {
        if (p.stage === "lost") continue;
        const [dec] = planSignals(landValue, {
          stage: p.stage,
          leadType: res.leadType,
          score: res.score,
          scoreMax: landScoring.clamp.max,
          actualValue: p.actual ?? null,
          clickIds: attribution,
          hasHashedUserData: consent.ad_user_data !== "denied",
          clickTs: new Date(clickTs),
          now: new Date(p.at),
          platforms: platforms.map((pl) => ({ platform: pl, sent: sent[pl] })),
        });
        valueCurrent = dec.cumulative;
        if (dec.status === "skipped" && dec.increment === 0) continue;
        const status = gpc ? "skipped" : dec.status === "enqueue" ? "dry_run" : dec.status;
        if (status === "dry_run") sent[dec.platform] += dec.increment;
        const connId = dec.platform === "google" ? gConn : mConn;
        jobs.push({
          workspace_id: wsId,
          lead_id: leadId,
          connection_id: connId,
          platform: dec.platform,
          mode: "dry_run",
          canonical_stage: p.stage,
          idempotency_key: `${wsId}:${leadId}:${p.stage}:${connId}:dry_run${status === "dry_run" ? "" : `:${status}`}`,
          transaction_id: `${leadId}-${p.stage}`,
          match_type: dec.matchType ?? null,
          value_increment: Math.max(0, dec.increment),
          cumulative_after: dec.cumulative,
          currency: "USD",
          status,
          attempts: status === "dry_run" ? 1 : 0,
          error: gpc ? "Opt-out signal (GPC or recorded opt-out): not uploaded." : (dec.reason ?? null),
          request: status === "dry_run" ? { demo: true, transactionId: `${leadId}-${p.stage}`, conversionValue: dec.increment, currency: "USD" } : null,
          response: status === "dry_run" ? { dryRun: true } : null,
          sent_at: status === "dry_run" ? new Date(p.at + 120_000).toISOString() : null,
          created_at: new Date(p.at + 60_000).toISOString(),
        });
      }

      const expires = windowExpiresOn(landValue, new Date(clickTs));
      leads.push({
        id: leadId,
        workspace_id: wsId,
        site_id: site!.id,
        source: "tag",
        form: "seller-step2",
        visitor_id: visitor,
        first_touch_visit_id: visitId,
        last_touch_visit_id: visitId,
        attribution,
        email_sha256: sha256Hex(email),
        phone_sha256: sha256Hex(`+1555${leadId.replace(/\D/g, "").slice(0, 7).padEnd(7, "0")}`),
        geo: answers.state,
        answers,
        score: res.score,
        score_raw: res.raw,
        score_capped: res.capped,
        score_version: 1,
        lead_type: res.leadType,
        velocity_band: res.velocity,
        canonical_stage: current,
        lost_reason: lostReason,
        value_current: valueCurrent,
        currency: "USD",
        click_ts: new Date(clickTs).toISOString(),
        window_expires_on: expires ? expires.toISOString().slice(0, 10) : null,
        consent,
        is_test: false,
        created_at: new Date(createdAt).toISOString(),
      });
      for (const p of path) {
        events.push({ workspace_id: wsId, lead_id: leadId, canonical_stage: p.stage, crm_stage_id: stages.find((s) => s[2] === p.stage)?.[0] ?? null, actual_value: p.actual ?? null, occurred_at: new Date(p.at).toISOString(), source: p.stage === "submitted" ? "intake" : "ghl", lost_reason: p.stage === "lost" ? lostReason : null, created_at: new Date(p.at).toISOString() });
      }
      links.push({ workspace_id: wsId, lead_id: leadId, provider: "ghl", contact_id: `demo-ct-${leadId.slice(0, 10)}` });
      if (path.length > 1) links.push({ workspace_id: wsId, lead_id: leadId, provider: "ghl", opportunity_id: `demo-op-${leadId.slice(0, 10)}` });
      ops.push({ workspace_id: wsId, lead_id: leadId, provider: "ghl", op: "upsert_contact", mode: "dry_run", status: "dry_run", request: { method: "POST", path: "/contacts/upsert", body: { email: "[redacted]", customFields: [{ key: "contact.leadvalue_initial", field_value: res.score }, { key: "contact.lead_type", field_value: res.leadType }] } }, created_at: new Date(createdAt + 30_000).toISOString() });
    }
  }

  await insertChunks("visits", visits);
  await insertChunks("leads", leads);
  await insertChunks("stage_events", events);
  await insertChunks("signal_jobs", jobs);
  await insertChunks("crm_links", links);
  await insertChunks("crm_ops", ops.slice(-150));
  await insertChunks("ad_spend_daily", spend);

  // Operational context: alerts, automation registry, webhook inbox samples.
  const soon = leads.filter((l) => ["submitted", "qualified", "opportunity"].includes(String(l.canonical_stage)) && l.window_expires_on && Date.parse(String(l.window_expires_on)) - now < 10 * DAY && Date.parse(String(l.window_expires_on)) > now).length;
  await insertChunks("alerts", [
    ...(soon ? [{ workspace_id: wsId, type: "window_expiry", severity: "warning", title: `${soon} lead(s) reach the 90-day upload limit within 10 days`, dedupe_key: "demo:window" }] : []),
    { workspace_id: wsId, type: "stage_unmapped", severity: "warning", title: 'CRM stage "Contacted" is set to ignore — confirm this is intended', dedupe_key: "demo:unmapped" },
    { workspace_id: wsId, type: "stage_anomaly", severity: "info", title: "Lead skipped 2 stages (submitted → contract)", dedupe_key: "demo:skip" },
  ]);
  await insertChunks("automations", [
    { workspace_id: wsId, name: "Speed-to-lead SMS", system: "ghl", owner: "Sales ops", trigger: "Contact created (website)", updates: "Sends SMS, creates call task", on_failure: "GHL workflow error email", access: "GHL admins", status: "ok", last_run_at: new Date(now - 3600_000).toISOString() },
    { workspace_id: wsId, name: "Probate nurture (90 days)", system: "ghl", owner: "Acquisitions", trigger: "Lead type = Title / Probate", updates: "Email + SMS sequence", on_failure: "None (silent)", access: "GHL admins", status: "ok" },
    { workspace_id: wsId, name: "Legacy CSV upload to Google", system: "make", owner: "Former contractor", trigger: "Weekly schedule", updates: "Google offline conversions (flat value)", on_failure: "Unknown", access: "Unknown", status: "retire" },
    { workspace_id: wsId, name: "Call tracking number swap", system: "callrail", owner: "Marketing", trigger: "Page load", updates: "Phone numbers on site", on_failure: "CallRail alert", access: "Marketing", status: "ok" },
  ]);
  await insertChunks("webhook_inbox", [
    { workspace_id: wsId, provider: "ghl", webhook_id: `demo-${randomUUID()}`, event_type: "OpportunityStageUpdate", signature_ok: true, payload: { demo: true }, received_at: new Date(now - 40 * 60_000).toISOString(), processed_at: new Date(now - 40 * 60_000 + 900).toISOString() },
    { workspace_id: wsId, provider: "ghl", webhook_id: `demo-${randomUUID()}`, event_type: "ContactCreate", signature_ok: true, payload: { demo: true }, received_at: new Date(now - 25 * 60_000).toISOString(), processed_at: new Date(now - 25 * 60_000 + 700).toISOString() },
  ]);
  await db.from("audit_log").insert({ org_id: orgId, workspace_id: wsId, actor_id: actorId, action: "demo.create", entity: "workspace", entity_id: wsId, diff: { leads: leads.length, jobs: jobs.length, spendRows: spend.length } });
  return { wsId, leads: leads.length, signals: jobs.length };
}
