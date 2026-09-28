import { RUNGS, type Rung, rungIndex } from "../stages";
import { ValueModel as ValueModelSchema, type ClickIds, type Platform, type ValueModel } from "./types";

/**
 * Value engine (spec §15). Pure functions only.
 *   cumulative(stage, type) = min(cap[stage], max(round(P[stage] × spread[type], 2), floor(stage)))
 *   floor(stage)            = max possible value of the previous stage + floorStep
 *   upload                  = cumulative − already sent (per platform); never negative
 *   window guard            = no upload when the click is older than the platform window
 */

const round2 = (n: number) => Math.round(n * 100) / 100;
const DAY = 86_400_000;

export function spreadFor(model: ValueModel, leadType: string | null | undefined): number {
  return (leadType && model.spreads[leadType] !== undefined ? model.spreads[leadType] : model.spreads.default) ?? 0;
}

function leadTypesOf(model: ValueModel): string[] {
  return Object.keys(model.spreads);
}

/** Form rung value for one lead. */
function formValue(model: ValueModel, leadType: string | null | undefined, score: number | null | undefined): number {
  const cap = model.caps.submitted;
  let v: number;
  if (model.formRung.mode === "score") v = score ?? 0;
  else if (model.formRung.mode === "fixed") v = model.formRung.fixedValue ?? 0;
  else v = model.stageProbs.submitted * spreadFor(model, leadType);
  v = round2(Math.max(0, v));
  return cap !== undefined ? Math.min(cap, v) : v;
}

/** Highest value the form rung can take (score mode uses the scoring model's clamp max). */
function formMax(model: ValueModel, scoreMax: number): number {
  const cap = model.caps.submitted;
  let v: number;
  if (model.formRung.mode === "score") v = scoreMax;
  else if (model.formRung.mode === "fixed") v = model.formRung.fixedValue ?? 0;
  else v = Math.max(...leadTypesOf(model).map((t) => model.stageProbs.submitted * spreadFor(model, t)));
  v = round2(v);
  return cap !== undefined ? Math.min(cap, v) : v;
}

export type LadderRow = {
  stage: Rung;
  floor: number;
  cap: number | null;
  max: number;
  byType: Record<string, number>;
};

/** Full ladder for every lead type — used by the validator, preview chart and the engine itself. */
export function ladder(model: ValueModel, scoreMax: number): LadderRow[] {
  const rows: LadderRow[] = [];
  const types = leadTypesOf(model);
  const fMax = formMax(model, scoreMax);
  rows.push({
    stage: "submitted",
    floor: 0,
    cap: model.caps.submitted ?? null,
    max: fMax,
    byType: Object.fromEntries(types.map((t) => [t, model.formRung.mode === "calibrated" ? formValue(model, t, null) : fMax])),
  });
  for (let i = 1; i < RUNGS.length; i++) {
    const stage = RUNGS[i];
    const prev = rows[i - 1];
    const cap = model.caps[stage];
    const byType: Record<string, number> = {};
    const floors: number[] = [];
    for (const t of types) {
      // Qualified must beat ANY form value (a form fill never outranks a qualified lead).
      // Later stages must beat the same lead type's previous stage (a lead's value never falls as it progresses).
      const floor = round2((i === 1 ? prev.max : prev.byType[t]) + model.floorStep);
      floors.push(floor);
      let v = Math.max(round2(model.stageProbs[stage] * spreadFor(model, t)), floor);
      if (cap !== undefined) v = Math.min(cap, v);
      byType[t] = round2(v);
    }
    rows.push({ stage, floor: Math.max(...floors), cap: cap ?? null, max: Math.max(...Object.values(byType)), byType });
  }
  return rows;
}

export type LadderIssue = { level: "error" | "warning"; message: string };

/** VAL-03: blocks saving a ladder where any stage could be worth ≤ the previous stage. */
export function validateLadder(input: unknown, scoreMax: number): { ok: boolean; model?: ValueModel; issues: LadderIssue[]; rows: LadderRow[] } {
  const parsed = ValueModelSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, rows: [], issues: parsed.error.issues.map((i) => ({ level: "error", message: `${i.path.join(".") || "model"}: ${i.message}` })) };
  }
  const model = parsed.data;
  const issues: LadderIssue[] = [];
  const rows = ladder(model, scoreMax);
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (r.cap !== null && r.cap < r.floor) {
      issues.push({ level: "error", message: `${r.stage}: cap ${r.cap} is below its floor ${r.floor}.` });
    }
    for (const [t, v] of Object.entries(r.byType)) {
      const prev = i === 1 ? rows[0].max : rows[i - 1].byType[t];
      const what = i === 1 ? "the highest possible form value" : `${t} at ${RUNGS[i - 1]}`;
      if (!(v > prev)) issues.push({ level: "error", message: `${r.stage} / ${t}: value ${v} is not above ${what} (${prev}).` });
    }
    const prevP = model.stageProbs[RUNGS[i - 1]];
    const p = model.stageProbs[r.stage];
    if (i > 1 && p < prevP) issues.push({ level: "warning", message: `${r.stage}: probability ${p} is lower than ${RUNGS[i - 1]} (${prevP}). Floors keep the order, but check the inputs.` });
  }
  if (model.stageProbs.funded !== 1) issues.push({ level: "warning", message: "funded probability is usually 1.0." });
  return { ok: !issues.some((x) => x.level === "error"), model, issues, rows };
}

/** Expected cumulative value of a lead that has reached `stage`. */
export function cumulativeValue(
  model: ValueModel,
  args: { stage: Rung; leadType?: string | null; score?: number | null; scoreMax: number; actualValue?: number | null },
): number {
  const rows = ladder(model, args.scoreMax);
  if (args.stage === "submitted") return formValue(model, args.leadType, args.score);
  const row = rows[rungIndex(args.stage)];
  if (args.stage === "funded" && model.trueUpFunded && typeof args.actualValue === "number" && args.actualValue >= 0) {
    const v = round2(args.actualValue);
    return row.cap !== null ? Math.min(row.cap, v) : v;
  }
  const t = args.leadType && model.spreads[args.leadType] !== undefined ? args.leadType : "default";
  return row.byType[t] ?? row.byType.default;
}

export type PlatformState = { platform: Platform; sent: number };

export type SignalDecision = {
  platform: Platform;
  status: "enqueue" | "blocked_window" | "no_click_id" | "skipped";
  reason?: string;
  matchType?: "click_id" | "enhanced_leads";
  increment: number;
  cumulative: number;
  clickAgeDays: number | null;
};

/**
 * Decide what to send for one lead that just reached `stage`.
 * Only the increase over what was already sent is uploaded; the sum per lead equals its current worth.
 */
export function planSignals(
  model: ValueModel,
  input: {
    stage: Rung;
    leadType?: string | null;
    score?: number | null;
    scoreMax: number;
    actualValue?: number | null;
    clickIds: ClickIds;
    hasHashedUserData: boolean;
    clickTs: Date | null;
    now: Date;
    platforms: PlatformState[];
  },
): SignalDecision[] {
  const cumulative = cumulativeValue(model, input);
  const ageDays = input.clickTs ? Math.floor((input.now.getTime() - input.clickTs.getTime()) / DAY) : null;

  return input.platforms.map(({ platform, sent }) => {
    const increment = round2(cumulative - sent);
    const base = { platform, cumulative, increment, clickAgeDays: ageDays };

    let matchType: SignalDecision["matchType"];
    let windowDays: number;
    if (platform === "google") {
      if (input.clickIds.gclid || input.clickIds.gbraid || input.clickIds.wbraid) {
        matchType = "click_id";
        windowDays = model.windows.googleClickDays;
      } else if (input.hasHashedUserData) {
        matchType = "enhanced_leads";
        windowDays = model.windows.googleEnhancedLeadsDays;
      } else return { ...base, status: "no_click_id", reason: "No gclid/gbraid/wbraid and no hashed email/phone." };
    } else {
      if (!input.clickIds.msclkid) return { ...base, status: "no_click_id", reason: "No msclkid." };
      matchType = "click_id";
      windowDays = model.windows.microsoftClickDays;
    }

    if (!model.uploadStages.includes(input.stage)) {
      return { ...base, matchType, status: "skipped", reason: `Stage "${input.stage}" is not uploaded; its value rolls into the next uploaded stage.` };
    }
    if (increment <= 0) {
      return { ...base, matchType, status: "skipped", reason: increment < 0 ? "Value fell below what was already sent; negative increments are never uploaded." : "Nothing new to send." };
    }
    // Leads without a click time (e.g. CRM-only) are treated as inside the window; the platform rejects if not.
    if (ageDays !== null && ageDays > windowDays) {
      return { ...base, matchType, status: "blocked_window", reason: `Click is ${ageDays} days old; the ${platform} window is ${windowDays} days. Value kept for reporting and calibration.` };
    }
    return { ...base, matchType, status: "enqueue" };
  });
}

/** Date after which no upload is accepted for this lead (click-ID window; the widest one the lead qualifies for). */
export function windowExpiresOn(model: ValueModel, clickTs: Date | null): Date | null {
  if (!clickTs) return null;
  const days = Math.max(model.windows.googleClickDays, model.windows.microsoftClickDays);
  return new Date(clickTs.getTime() + days * DAY);
}
