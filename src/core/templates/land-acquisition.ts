import type { ScoringModel } from "../scoring/types";
import type { ValueModel } from "../value/types";

/**
 * Land acquisition (seller leads). Weights reproduce the pilot's form-fill Lead Value Schedule v1.4
 * (base 10, clamp 5–120). The published examples only reconcile when some unstated answers are assumed;
 * the test cases below spell out the full answer sets and flag each assumption.
 */
const opts = (pairs: [string, string][]) => pairs.map(([value, label]) => ({ value, label }));

export const landScoring: ScoringModel = {
  name: "Land acquisition – seller form",
  currency: "USD",
  base: 10,
  clamp: { min: 5, max: 120 },
  fields: [
    { key: "state", label: "State", type: "text", required: true },
    { key: "acreage", label: "Acreage", type: "select", options: opts([["0-1", "0–1"], ["1-2", "1–2"], ["2-5", "2–5"], ["5-10", "5–10"], ["10-20", "10–20"], ["20+", "20+"]]) },
    { key: "acquired", label: "How acquired", type: "select", options: opts([["purchased", "Purchased"], ["inherited_sole", "Inherited – sole owner"], ["inherited_shared", "Inherited – shared with heirs"], ["gift", "Gift"], ["tax_sale", "Tax sale / auction"], ["other", "Other"]]) },
    { key: "years_owned", label: "Years owned", type: "select", options: opts([["<1", "Under 1"], ["1-5", "1–5"], ["5-10", "5–10"], ["10-20", "10–20"], ["20+", "20+"], ["not_sure", "Not sure"]]) },
    { key: "why_selling", label: "Why selling", type: "select", options: opts([["inherited_dont_want", "Inherited, don't want it"], ["taxes_upkeep", "Tired of taxes & upkeep"], ["need_cash", "Need the cash"], ["never_use", "Never use it"], ["too_far", "Too far away"], ["family", "Family situation"], ["moving", "Moving / downsizing"], ["just_looking", "Just seeing what it's worth"], ["other", "Other"]]) },
    { key: "taxes_current", label: "Taxes current", type: "select", options: opts([["yes", "Yes"], ["no", "No (behind)"]]) },
    { key: "mortgage", label: "Mortgage or loan", type: "select", options: opts([["yes", "Yes"], ["no", "No (free and clear)"]]) },
    { key: "listed_with_realtor", label: "Listed with a realtor", type: "select", options: opts([["yes", "Yes"], ["no", "No"]]) },
    { key: "deed_in_name", label: "Deed in seller's name", type: "select", options: opts([["yes", "Yes"], ["no", "No"], ["not_sure", "Not sure"]]) },
    { key: "road_access", label: "Legal road access", type: "select", options: opts([["yes", "Yes"], ["no", "No"], ["not_sure", "Not sure"]]) },
    { key: "price_flexibility", label: "Price flexibility (1–5)", type: "select", options: opts([["5", "5"], ["4", "4"], ["3", "3"], ["2", "2"], ["1", "1"]]) },
    { key: "timeline", label: "Timeline", type: "select", options: opts([["asap", "ASAP"], ["30_days", "Within 30 days"], ["90_days", "Within 90 days"], ["flexible", "Flexible"]]) },
  ],
  rules: [
    { kind: "map", field: "acreage", map: { blank: 5, "0-1": 0, "1-2": 10, "2-5": 20, "5-10": 35, "10-20": 35, "20+": 30 } },
    { kind: "map", field: "acquired", map: { purchased: 0, inherited_sole: 15, inherited_shared: 5, gift: 15, tax_sale: 5, other: 0 } },
    { kind: "map", field: "years_owned", map: { "<1": -10, "1-5": 0, "5-10": 5, "10-20": 10, "20+": 15, not_sure: 5 } },
    { kind: "map", field: "why_selling", map: { inherited_dont_want: 15, taxes_upkeep: 15, need_cash: 15, never_use: 10, too_far: 10, family: 10, moving: 5, just_looking: -15, other: 0 } },
    { kind: "map", field: "taxes_current", map: { no: 15 } },
    { kind: "map", field: "mortgage", map: { no: 5 } },
    { kind: "map", field: "listed_with_realtor", map: { yes: -40 } },
    { kind: "map", field: "deed_in_name", map: { no: -15, not_sure: -5 } },
    { kind: "map", field: "road_access", map: { yes: 10, no: -15, not_sure: 0 } },
    { kind: "map", field: "price_flexibility", map: { "5": 20, "4": 12, "3": 5, "2": 0, "1": -20 } },
  ],
  leadTypes: [
    { type: "Title / Probate", velocity: "slow", when: { any: [{ field: "acquired", in: ["inherited_sole", "inherited_shared"] }, { field: "deed_in_name", in: ["no", "not_sure"] }] } },
    { type: "Low Value", velocity: "normal", when: { score_lte: 25 } },
    { type: "Fast Cash", velocity: "fast", when: { any: [{ field: "why_selling", in: ["need_cash"] }, { field: "timeline", in: ["asap", "30_days"] }] } },
    { type: "High Value", velocity: "normal", when: { all: [{ field: "acreage", in: ["5-10", "10-20", "20+"] }, { score_gte: 70 }] } },
  ],
  defaultLeadType: "Standard",
  defaultVelocity: "normal",
  tests: [
    { name: "8 ac, inherited sole, taxes behind, 20+ yrs, tired of taxes, flex 5", answers: { state: "TX", acreage: "5-10", acquired: "inherited_sole", taxes_current: "no", years_owned: "20+", why_selling: "taxes_upkeep", price_flexibility: "5" }, expect: 120, expectType: "Title / Probate", note: "Raw 125, capped at 120." },
    { name: "12 ac, purchased, 10–20 yrs, never uses it, flex 3", answers: { state: "NC", acreage: "10-20", acquired: "purchased", years_owned: "10-20", why_selling: "never_use", taxes_current: "yes", price_flexibility: "3", road_access: "yes", mortgage: "no" }, expect: 85, expectType: "High Value", note: "Assumes road access yes (+10) and free and clear (+5)." },
    { name: "15 ac, inherited shared, deed in estate, family, flex 4", answers: { state: "AZ", acreage: "10-20", acquired: "inherited_shared", deed_in_name: "no", why_selling: "family", price_flexibility: "4", road_access: "yes", mortgage: "no", years_owned: "10-20" }, expect: 82, expectType: "Title / Probate", note: "Assumes road yes, free and clear, owned 10–20 yrs." },
    { name: "8 ac, listed with realtor, needs cash, flex 4", answers: { state: "FL", acreage: "5-10", listed_with_realtor: "yes", why_selling: "need_cash", price_flexibility: "4", road_access: "yes", mortgage: "no", years_owned: "5-10" }, expect: 52, expectType: "Fast Cash", note: "Assumes road yes, free and clear, owned 5–10 yrs." },
    { name: "3 ac bought < 1 yr ago, just looking, flex 2", answers: { state: "GA", acreage: "2-5", acquired: "purchased", years_owned: "<1", why_selling: "just_looking", price_flexibility: "2", road_access: "yes", mortgage: "no" }, expect: 20, expectType: "Low Value", note: "Assumes road yes and free and clear." },
    { name: "Only state answered", answers: { state: "AZ" }, expect: 15, expectType: "Low Value", note: "Base 10 + blank acreage 5." },
  ],
};

/** Placeholder value model until the client supplies spreads and stage rates from funded history. */
export const landValue: ValueModel = {
  currency: "USD",
  stageProbs: { submitted: 0.05, qualified: 0.2, opportunity: 0.35, contract: 0.75, sold: 0.92, funded: 1 },
  spreads: { default: 15000, "Title / Probate": 22000, "Fast Cash": 12000, "High Value": 30000, "Low Value": 4000 },
  caps: { submitted: undefined, qualified: undefined, opportunity: undefined, contract: undefined, sold: undefined, funded: 100000 },
  formRung: { mode: "score" },
  floorStep: 0.01,
  uploadStages: ["submitted", "qualified", "opportunity", "contract", "funded"],
  windows: { googleClickDays: 90, googleEnhancedLeadsDays: 63, microsoftClickDays: 90 },
  trueUpFunded: true,
};
