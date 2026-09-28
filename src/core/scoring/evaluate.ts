import type { Answers, Condition, ScoreResult, ScoringModel, TestCase } from "./types";
import { ScoringModel as ScoringModelSchema } from "./types";

const round2 = (n: number) => Math.round(n * 100) / 100;

function answerOf(answers: Answers, field: string): string | null {
  const v = answers[field];
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function numberOf(answers: Answers, field: string): number | null {
  const a = answerOf(answers, field);
  if (a === null) return null;
  const n = Number(a);
  return Number.isFinite(n) ? n : null;
}

/** Pure condition evaluator for lead-type rules. */
export function matches(cond: Condition, answers: Answers, score: number): boolean {
  if (cond.all && !cond.all.every((c) => matches(c, answers, score))) return false;
  if (cond.any && !cond.any.some((c) => matches(c, answers, score))) return false;
  if (cond.not && matches(cond.not, answers, score)) return false;
  if (cond.score_gte !== undefined && !(score >= cond.score_gte)) return false;
  if (cond.score_lte !== undefined && !(score <= cond.score_lte)) return false;
  if (cond.field) {
    const a = answerOf(answers, cond.field);
    if (cond.in && (a === null || !cond.in.includes(a))) return false;
    if (cond.gte !== undefined || cond.lte !== undefined) {
      const n = numberOf(answers, cond.field);
      if (n === null) return false;
      if (cond.gte !== undefined && n < cond.gte) return false;
      if (cond.lte !== undefined && n > cond.lte) return false;
    }
  }
  return true;
}

/**
 * Score = clamp(base + Σ rule points). Unknown or skipped answers add 0 unless the rule defines "blank".
 * The clamp is applied after summing; the raw score is kept so reports can show the cap-hit rate.
 */
export function evaluate(model: ScoringModel, answers: Answers): ScoreResult {
  const breakdown: ScoreResult["breakdown"] = [];
  let raw = model.base;

  for (const rule of model.rules) {
    const a = answerOf(answers, rule.field);
    let points = 0;
    if (rule.kind === "map") {
      if (a === null) points = rule.map.blank ?? 0;
      else points = rule.map[a] ?? 0;
    } else {
      const n = numberOf(answers, rule.field);
      if (n === null) points = rule.blank ?? 0;
      else {
        const hit = rule.ranges.find((r) => (r.min === null || n >= r.min) && (r.max === null || n < r.max));
        points = hit?.points ?? 0;
      }
    }
    if (points !== 0) breakdown.push({ field: rule.field, answer: a, points });
    raw += points;
  }

  raw = round2(raw);
  const score = round2(Math.min(model.clamp.max, Math.max(model.clamp.min, raw)));
  const capped = raw > model.clamp.max;

  let leadType = model.defaultLeadType;
  let velocity = model.defaultVelocity;
  for (const lt of model.leadTypes) {
    if (matches(lt.when, answers, score)) {
      leadType = lt.type;
      velocity = lt.velocity ?? model.defaultVelocity;
      break;
    }
  }

  return { score, raw, capped, leadType, velocity, breakdown };
}

export type TestOutcome = { test: TestCase; pass: boolean; got: ScoreResult };

export function runTests(model: ScoringModel): { pass: boolean; outcomes: TestOutcome[] } {
  const outcomes = model.tests.map((test) => {
    const got = evaluate(model, test.answers);
    const pass = got.score === test.expect && (test.expectType === undefined || got.leadType === test.expectType);
    return { test, pass, got };
  });
  return { pass: outcomes.every((o) => o.pass), outcomes };
}

/** Structural validation + test run. Publishing is blocked unless ok (SCR-03). */
export function validateForPublish(input: unknown):
  | { ok: true; model: ScoringModel; outcomes: TestOutcome[] }
  | { ok: false; errors: string[]; outcomes?: TestOutcome[] } {
  const parsed = ScoringModelSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join(".") || "model"}: ${i.message}`) };
  }
  const model = parsed.data;
  const errors: string[] = [];
  const keys = new Set(model.fields.map((f) => f.key));
  if (keys.size !== model.fields.length) errors.push("fields: duplicate keys");
  for (const r of model.rules) if (!keys.has(r.field)) errors.push(`rules: unknown field "${r.field}"`);
  if (model.tests.length === 0) errors.push("tests: add at least one test case");
  const { pass, outcomes } = runTests(model);
  if (!pass) {
    for (const o of outcomes.filter((x) => !x.pass)) {
      errors.push(
        `test "${o.test.name}": expected ${o.test.expect}${o.test.expectType ? ` / ${o.test.expectType}` : ""}, got ${o.got.score} / ${o.got.leadType}`,
      );
    }
  }
  return errors.length ? { ok: false, errors, outcomes } : { ok: true, model, outcomes };
}
