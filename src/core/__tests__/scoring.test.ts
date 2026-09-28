import { describe, expect, it } from "vitest";
import { evaluate, runTests, validateForPublish } from "../scoring/evaluate";
import { TEMPLATES } from "../templates";
import { landScoring } from "../templates/land-acquisition";

describe("scoring engine", () => {
  it.each(TEMPLATES.map((t) => [t.id, t] as const))("template %s passes its own test cases", (_id, t) => {
    const res = runTests(t.scoring);
    for (const o of res.outcomes) expect({ name: o.test.name, score: o.got.score, type: o.got.leadType }).toEqual({ name: o.test.name, score: o.test.expect, type: o.test.expectType ?? o.got.leadType });
    expect(validateForPublish(t.scoring).ok).toBe(true);
  });

  it("clamps after summing and keeps the raw score", () => {
    const r = evaluate(landScoring, { acreage: "5-10", acquired: "inherited_sole", taxes_current: "no", years_owned: "20+", why_selling: "taxes_upkeep", price_flexibility: "5" });
    expect(r.raw).toBe(125);
    expect(r.score).toBe(120);
    expect(r.capped).toBe(true);
  });

  it("unknown answers add nothing; blank key applies to missing fields", () => {
    expect(evaluate(landScoring, { acreage: "nonsense" }).score).toBe(10);
    expect(evaluate(landScoring, {}).score).toBe(15);
  });

  it("lead-type rules are ordered: inherited parcel is Title / Probate even when score is low", () => {
    const r = evaluate(landScoring, { acquired: "inherited_shared", listed_with_realtor: "yes" });
    expect(r.leadType).toBe("Title / Probate");
    expect(r.velocity).toBe("slow");
  });

  it("blocks publishing when a test fails", () => {
    const bad = { ...landScoring, tests: [{ name: "wrong", answers: { state: "AZ" }, expect: 99 }] };
    const v = validateForPublish(bad);
    expect(v.ok).toBe(false);
  });

  it("rejects rules that reference unknown fields", () => {
    const bad = { ...landScoring, rules: [...landScoring.rules, { kind: "map" as const, field: "nope", map: { a: 1 } }] };
    const v = validateForPublish(bad);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.errors.join(" ")).toContain("nope");
  });
});
