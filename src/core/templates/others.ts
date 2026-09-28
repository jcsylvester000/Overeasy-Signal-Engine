import type { ScoringModel } from "../scoring/types";
import type { ValueModel } from "../value/types";

const opts = (pairs: [string, string][]) => pairs.map(([value, label]) => ({ value, label }));
const windows = { googleClickDays: 90, googleEnhancedLeadsDays: 63, microsoftClickDays: 90 };
const noCaps = { submitted: undefined, qualified: undefined, opportunity: undefined, contract: undefined, sold: undefined, funded: undefined };

// ---------------------------------------------------------------- Home services
export const homeScoring: ScoringModel = {
  name: "Home services – quote request",
  currency: "USD",
  base: 10,
  clamp: { min: 5, max: 100 },
  fields: [
    { key: "service", label: "Service", type: "select", options: opts([["replacement", "Full replacement"], ["install", "New install"], ["repair", "Repair"], ["maintenance", "Maintenance"]]) },
    { key: "homeowner", label: "Homeowner", type: "select", options: opts([["yes", "Yes"], ["no", "No (renter)"]]) },
    { key: "urgency", label: "When", type: "select", options: opts([["emergency", "Emergency"], ["this_week", "This week"], ["this_month", "This month"], ["researching", "Just researching"]]) },
    { key: "budget", label: "Budget (USD)", type: "number" },
    { key: "zip", label: "ZIP code", type: "text", required: true },
  ],
  rules: [
    { kind: "map", field: "service", map: { replacement: 35, install: 30, repair: 10, maintenance: 5 } },
    { kind: "map", field: "homeowner", map: { yes: 15, no: -20 } },
    { kind: "map", field: "urgency", map: { emergency: 20, this_week: 15, this_month: 5, researching: -10 } },
    { kind: "range", field: "budget", ranges: [{ min: null, max: 1000, points: 0 }, { min: 1000, max: 5000, points: 10 }, { min: 5000, max: null, points: 20 }] },
  ],
  leadTypes: [
    { type: "Emergency", velocity: "fast", when: { field: "urgency", in: ["emergency"] } },
    { type: "Low Value", velocity: "normal", when: { score_lte: 25 } },
    { type: "Big Ticket", velocity: "normal", when: { field: "service", in: ["replacement", "install"] } },
  ],
  defaultLeadType: "Standard",
  defaultVelocity: "normal",
  tests: [
    { name: "Homeowner replacement this week, $8k", answers: { service: "replacement", homeowner: "yes", urgency: "this_week", budget: 8000, zip: "30301" }, expect: 95, expectType: "Big Ticket" },
    { name: "Renter researching repair", answers: { service: "repair", homeowner: "no", urgency: "researching", zip: "30301" }, expect: 5, expectType: "Low Value" },
  ],
};
export const homeValue: ValueModel = {
  currency: "USD",
  stageProbs: { submitted: 0.1, qualified: 0.3, opportunity: 0.5, contract: 0.85, sold: 0.95, funded: 1 },
  spreads: { default: 2500, "Big Ticket": 6000, Emergency: 1500, "Low Value": 300 },
  caps: noCaps,
  formRung: { mode: "score" },
  floorStep: 0.01,
  uploadStages: ["submitted", "qualified", "opportunity", "contract", "funded"],
  windows,
  trueUpFunded: true,
};

// ---------------------------------------------------------------- Legal intake
export const legalScoring: ScoringModel = {
  name: "Legal – case intake",
  currency: "USD",
  base: 10,
  clamp: { min: 0, max: 150 },
  fields: [
    { key: "case_type", label: "Case type", type: "select", options: opts([["personal_injury", "Personal injury"], ["employment", "Employment"], ["family", "Family"], ["other", "Other"]]) },
    { key: "months_since_incident", label: "Months since incident", type: "number" },
    { key: "injury_treated", label: "Received medical treatment", type: "select", options: opts([["yes", "Yes"], ["no", "No"]]) },
    { key: "has_lawyer", label: "Already represented", type: "select", options: opts([["yes", "Yes"], ["no", "No"]]) },
    { key: "state", label: "State", type: "text", required: true },
  ],
  rules: [
    { kind: "map", field: "case_type", map: { personal_injury: 50, employment: 30, family: 15, other: 0 } },
    { kind: "range", field: "months_since_incident", ranges: [{ min: null, max: 6, points: 20 }, { min: 6, max: 24, points: 10 }, { min: 24, max: null, points: -30 }] },
    { kind: "map", field: "injury_treated", map: { yes: 25 } },
    { kind: "map", field: "has_lawyer", map: { yes: -60 } },
  ],
  leadTypes: [
    { type: "Not Eligible", velocity: "normal", when: { field: "has_lawyer", in: ["yes"] } },
    { type: "Priority Case", velocity: "normal", when: { score_gte: 90 } },
  ],
  defaultLeadType: "Standard",
  defaultVelocity: "slow",
  tests: [
    { name: "Recent treated PI, unrepresented", answers: { case_type: "personal_injury", months_since_incident: 2, injury_treated: "yes", has_lawyer: "no", state: "CA" }, expect: 105, expectType: "Priority Case" },
    { name: "Already represented", answers: { case_type: "employment", has_lawyer: "yes", state: "CA" }, expect: 0, expectType: "Not Eligible" },
  ],
};
export const legalValue: ValueModel = {
  currency: "USD",
  stageProbs: { submitted: 0.03, qualified: 0.15, opportunity: 0.3, contract: 0.7, sold: 0.9, funded: 1 },
  spreads: { default: 8000, "Priority Case": 25000, "Not Eligible": 0 },
  caps: { ...noCaps, funded: 250000 },
  formRung: { mode: "score" },
  floorStep: 0.01,
  uploadStages: ["submitted", "qualified", "contract", "funded"],
  windows,
  trueUpFunded: true,
};

// ---------------------------------------------------------------- B2B services
export const b2bScoring: ScoringModel = {
  name: "B2B services – demo / quote request",
  currency: "USD",
  base: 5,
  clamp: { min: 0, max: 100 },
  fields: [
    { key: "company_size", label: "Company size", type: "select", options: opts([["1-10", "1–10"], ["11-50", "11–50"], ["51-200", "51–200"], ["201+", "201+"]]) },
    { key: "role", label: "Role", type: "select", options: opts([["owner", "Owner / C-level"], ["manager", "Manager"], ["staff", "Staff"], ["student", "Student"]]) },
    { key: "budget", label: "Monthly budget (USD)", type: "number" },
    { key: "timeline", label: "Timeline", type: "select", options: opts([["now", "Now"], ["quarter", "This quarter"], ["later", "Later"]]) },
  ],
  rules: [
    { kind: "map", field: "company_size", map: { "1-10": 5, "11-50": 15, "51-200": 25, "201+": 30 } },
    { kind: "map", field: "role", map: { owner: 20, manager: 15, staff: 5, student: -30 } },
    { kind: "range", field: "budget", ranges: [{ min: null, max: 1000, points: 0 }, { min: 1000, max: 5000, points: 15 }, { min: 5000, max: null, points: 30 }] },
    { kind: "map", field: "timeline", map: { now: 15, quarter: 10, later: 0 } },
  ],
  leadTypes: [
    { type: "Not a Fit", velocity: "normal", when: { any: [{ field: "role", in: ["student"] }, { score_lte: 15 }] } },
    { type: "Enterprise", velocity: "slow", when: { field: "company_size", in: ["201+"] } },
    { type: "Hot", velocity: "fast", when: { all: [{ field: "timeline", in: ["now"] }, { score_gte: 60 }] } },
  ],
  defaultLeadType: "Standard",
  defaultVelocity: "normal",
  tests: [
    { name: "Owner, 51–200, $6k, now", answers: { company_size: "51-200", role: "owner", budget: 6000, timeline: "now" }, expect: 95, expectType: "Hot" },
    { name: "Student", answers: { role: "student" }, expect: 0, expectType: "Not a Fit" },
  ],
};
export const b2bValue: ValueModel = {
  currency: "USD",
  stageProbs: { submitted: 0.05, qualified: 0.2, opportunity: 0.4, contract: 0.8, sold: 0.95, funded: 1 },
  spreads: { default: 6000, Enterprise: 30000, Hot: 9000, "Not a Fit": 0 },
  caps: noCaps,
  formRung: { mode: "score" },
  floorStep: 0.01,
  uploadStages: ["submitted", "qualified", "opportunity", "contract", "funded"],
  windows,
  trueUpFunded: true,
};
