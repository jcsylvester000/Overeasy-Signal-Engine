import { z } from "zod";

/**
 * A scoring model is a JSON document, versioned and immutable once published (spec §14).
 * The evaluator is pure (no I/O) so it runs anywhere and is fully unit-tested.
 */

export const FieldOption = z.object({ value: z.string().min(1), label: z.string().min(1) });

export const FieldDef = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,47}$/, "lower_snake_case, max 48 chars"),
  label: z.string().min(1),
  type: z.enum(["select", "number", "text"]),
  options: z.array(FieldOption).optional(),
  required: z.boolean().optional(),
});
export type FieldDef = z.infer<typeof FieldDef>;

/** Points per answer. "blank" applies when the field is missing/empty (otherwise blank adds 0). */
export const MapRule = z.object({
  kind: z.literal("map"),
  field: z.string(),
  map: z.record(z.string(), z.number()),
});
/** Points by numeric range, [min, max) — first match wins. */
export const RangeRule = z.object({
  kind: z.literal("range"),
  field: z.string(),
  ranges: z.array(z.object({ min: z.number().nullable(), max: z.number().nullable(), points: z.number() })),
  blank: z.number().optional(),
});
export const Rule = z.discriminatedUnion("kind", [MapRule, RangeRule]);
export type Rule = z.infer<typeof Rule>;

export type Condition = {
  all?: Condition[];
  any?: Condition[];
  not?: Condition;
  field?: string;
  in?: string[];
  gte?: number;
  lte?: number;
  score_gte?: number;
  score_lte?: number;
};
export const Condition: z.ZodType<Condition> = z.lazy(() =>
  z.object({
    all: z.array(Condition).optional(),
    any: z.array(Condition).optional(),
    not: Condition.optional(),
    field: z.string().optional(),
    in: z.array(z.string()).optional(),
    gte: z.number().optional(),
    lte: z.number().optional(),
    score_gte: z.number().optional(),
    score_lte: z.number().optional(),
  }),
);

export const VelocityBand = z.enum(["fast", "normal", "slow"]);
export type VelocityBand = z.infer<typeof VelocityBand>;

export const LeadTypeRule = z.object({
  type: z.string().min(1),
  velocity: VelocityBand.optional(),
  when: Condition,
});
export type LeadTypeRule = z.infer<typeof LeadTypeRule>;

export const TestCase = z.object({
  name: z.string().min(1),
  answers: z.record(z.string(), z.union([z.string(), z.number()])),
  expect: z.number(),
  expectType: z.string().optional(),
  note: z.string().optional(),
});
export type TestCase = z.infer<typeof TestCase>;

export const ScoringModel = z.object({
  name: z.string().min(1),
  currency: z.string().length(3),
  base: z.number(),
  clamp: z.object({ min: z.number(), max: z.number() }).refine((c) => c.min <= c.max, "clamp.min must be ≤ clamp.max"),
  fields: z.array(FieldDef),
  rules: z.array(Rule),
  leadTypes: z.array(LeadTypeRule),
  defaultLeadType: z.string().min(1),
  defaultVelocity: VelocityBand,
  tests: z.array(TestCase),
});
export type ScoringModel = z.infer<typeof ScoringModel>;

export type Answers = Record<string, string | number | null | undefined>;

export type ScoreResult = {
  score: number;
  raw: number;
  capped: boolean;
  leadType: string;
  velocity: VelocityBand;
  breakdown: { field: string; answer: string | null; points: number }[];
};
