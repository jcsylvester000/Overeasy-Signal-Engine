import { RUNGS, rungIndex, type Rung } from "./stages";
import type { ValueModel } from "./value/types";

/**
 * Calibration (VAL-06): re-estimate P(funded | reached stage) and spread per lead type from real outcomes.
 * Only "matured" leads count: funded, lost, or older than the maturity window. A human approves before apply.
 */
export type OutcomeLead = { leadType: string | null; reached: Rung; lost: boolean; funded: boolean; fundedValue: number | null; ageDays: number };

export type CalibrationProposal = {
  sample: number;
  stageProbs: Record<Rung, { current: number; proposed: number | null; n: number }>;
  spreads: Record<string, { current: number | null; proposed: number | null; n: number }>;
  warnings: string[];
};

const MIN_STAGE = 20;
const MIN_TYPE = 5;

export function proposeCalibration(model: ValueModel, leads: OutcomeLead[], maturityDays = 120): CalibrationProposal {
  const matured = leads.filter((l) => l.funded || l.lost || l.ageDays >= maturityDays);
  const warnings: string[] = [];
  const stageProbs = {} as CalibrationProposal["stageProbs"];
  for (const r of RUNGS) {
    const reached = matured.filter((l) => rungIndex(l.reached) >= rungIndex(r));
    const funded = reached.filter((l) => l.funded).length;
    const n = reached.length;
    let proposed: number | null = n >= MIN_STAGE ? Math.round((funded / n) * 1000) / 1000 : null;
    if (r === "funded") proposed = 1;
    stageProbs[r] = { current: model.stageProbs[r], proposed, n };
    if (r !== "funded" && n < MIN_STAGE) warnings.push(`${r}: only ${n} matured lead(s) reached this stage; need ${MIN_STAGE}+ before changing it.`);
  }
  // Probabilities must not fall as stages advance.
  let prev = 0;
  for (const r of RUNGS) {
    const p = stageProbs[r].proposed;
    if (p !== null) {
      if (p < prev) {
        warnings.push(`${r}: proposed ${p} is below an earlier stage (${prev}); raised to keep the ladder rising.`);
        stageProbs[r].proposed = prev;
      }
      prev = stageProbs[r].proposed!;
    }
  }

  const spreads: CalibrationProposal["spreads"] = {};
  const types = new Set([...Object.keys(model.spreads), ...leads.map((l) => l.leadType ?? "default")]);
  for (const t of types) {
    const vals = leads.filter((l) => (l.leadType ?? "default") === t && l.funded && typeof l.fundedValue === "number").map((l) => l.fundedValue as number);
    const n = vals.length;
    spreads[t] = { current: model.spreads[t] ?? null, proposed: n >= MIN_TYPE ? Math.round(vals.reduce((a, b) => a + b, 0) / n) : null, n };
  }
  if (!leads.some((l) => l.funded && l.fundedValue !== null)) warnings.push("No funded deals with an actual value yet: record the actual spread when moving a lead to Funded.");
  return { sample: matured.length, stageProbs, spreads, warnings };
}

/** Apply only the proposals that have enough data; everything else keeps its current value. */
export function applyProposal(model: ValueModel, p: CalibrationProposal): ValueModel {
  const stageProbs = { ...model.stageProbs };
  for (const r of RUNGS) if (p.stageProbs[r].proposed !== null) stageProbs[r] = p.stageProbs[r].proposed!;
  const spreads = { ...model.spreads };
  for (const [t, v] of Object.entries(p.spreads)) if (v.proposed !== null) spreads[t] = v.proposed;
  return { ...model, stageProbs, spreads };
}
