/** Canonical stage ladder every CRM pipeline maps to (spec §9.2, LCM-03). */
export const RUNGS = ["submitted", "qualified", "opportunity", "contract", "sold", "funded"] as const;
export type Rung = (typeof RUNGS)[number];
export type CanonicalStage = Rung | "lost";
export const CANONICAL_STAGES: CanonicalStage[] = [...RUNGS, "lost"];

export const STAGE_LABEL: Record<CanonicalStage, string> = {
  submitted: "Lead submitted",
  qualified: "Qualified",
  opportunity: "Opportunity",
  contract: "Contract",
  sold: "Deal sold",
  funded: "Deal funded",
  lost: "Lost",
};

export function rungIndex(stage: string): number {
  return RUNGS.indexOf(stage as Rung);
}

export function isRung(stage: string): stage is Rung {
  return rungIndex(stage) >= 0;
}

export function isCanonicalStage(stage: string): stage is CanonicalStage {
  return stage === "lost" || isRung(stage);
}

/** Leads never move "down" the ladder for value purposes; lost is terminal but keeps the highest rung reached. */
export function laterStage(current: string, next: string): string {
  if (next === "lost") return "lost";
  if (current === "lost") return next; // re-opened
  return rungIndex(next) > rungIndex(current) ? next : current;
}
