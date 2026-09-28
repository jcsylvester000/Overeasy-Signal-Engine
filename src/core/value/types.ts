import { z } from "zod";
import { RUNGS } from "../stages";

const Prob = z.number().min(0).max(1);
const Money = z.number().min(0);

export const ValueModel = z.object({
  currency: z.string().length(3),
  /** P(funded | reached stage). "submitted" is only used when formRung.mode = "calibrated". */
  stageProbs: z.object({
    submitted: Prob,
    qualified: Prob,
    opportunity: Prob,
    contract: Prob,
    sold: Prob,
    funded: Prob,
  }),
  /** Expected profit/spread per lead type; "default" applies to any type not listed. */
  spreads: z.record(z.string(), Money).refine((s) => typeof s.default === "number", "spreads.default is required"),
  /** Optional per-stage caps so one outlier cannot distort bidding. */
  caps: z.object(Object.fromEntries(RUNGS.map((r) => [r, Money.optional()])) as Record<(typeof RUNGS)[number], z.ZodOptional<typeof Money>>),
  formRung: z.object({
    mode: z.enum(["score", "calibrated", "fixed"]),
    fixedValue: Money.optional(),
  }),
  /** Minimum step between the previous stage's maximum and this stage's floor. */
  floorStep: z.number().positive().default(0.01),
  /** Rungs that are uploaded as their own conversion action. Value of skipped rungs rolls into the next upload. */
  uploadStages: z.array(z.enum(RUNGS)).min(1),
  windows: z.object({
    googleClickDays: z.number().int().positive().default(90),
    googleEnhancedLeadsDays: z.number().int().positive().default(63),
    microsoftClickDays: z.number().int().positive().default(90),
  }),
  /** At "funded", replace the expected value with the actual spread when it is reported (VAL-05). */
  trueUpFunded: z.boolean().default(true),
});
export type ValueModel = z.infer<typeof ValueModel>;

export type Platform = "google" | "microsoft";

export type ClickIds = {
  gclid?: string | null;
  gbraid?: string | null;
  wbraid?: string | null;
  msclkid?: string | null;
};
