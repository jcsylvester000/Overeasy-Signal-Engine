import { describe, expect, it } from "vitest";
import { applyProposal, proposeCalibration, type OutcomeLead } from "../calibration";
import { landValue } from "../templates/land-acquisition";
import { validateLadder } from "../value/engine";
import { parseCsv, toCsv } from "../csv";

function leads(): OutcomeLead[] {
  const out: OutcomeLead[] = [];
  for (let i = 0; i < 100; i++) {
    const funded = i < 10;
    const reached = funded ? "funded" : i < 20 ? "contract" : i < 40 ? "qualified" : "submitted";
    out.push({ leadType: i % 2 ? "Fast Cash" : "Title / Probate", reached, lost: !funded, funded, fundedValue: funded ? 10000 + i * 100 : null, ageDays: 200 });
  }
  return out;
}

describe("calibration", () => {
  it("estimates stage probabilities from matured outcomes", () => {
    const p = proposeCalibration(landValue, leads());
    expect(p.sample).toBe(100);
    expect(p.stageProbs.submitted.proposed).toBe(0.1);
    expect(p.stageProbs.qualified.proposed).toBe(0.25);
    expect(p.stageProbs.contract.proposed).toBe(0.5);
    expect(p.stageProbs.funded.proposed).toBe(1);
  });
  it("proposes spreads only with enough funded deals", () => {
    const p = proposeCalibration(landValue, leads());
    expect(p.spreads["Title / Probate"].proposed).toBe(10400);
    expect(p.spreads["High Value"].proposed).toBeNull();
  });
  it("the applied model is still a valid rising ladder", () => {
    const m = applyProposal(landValue, proposeCalibration(landValue, leads()));
    expect(validateLadder(m, 120).ok).toBe(true);
  });
  it("small samples leave values unchanged", () => {
    const p = proposeCalibration(landValue, leads().slice(0, 5));
    expect(p.stageProbs.qualified.proposed).toBeNull();
    expect(p.warnings.length).toBeGreaterThan(0);
  });
});

describe("csv", () => {
  it("round-trips quotes and neutralises formulas", () => {
    const text = toCsv(["a", "b"], [["x,y", '=SUM(1)'], [-5, 'q"t']]);
    expect(parseCsv(text)).toEqual([["a", "b"], ["x,y", "'=SUM(1)"], ["-5", 'q"t']]);
  });
});
