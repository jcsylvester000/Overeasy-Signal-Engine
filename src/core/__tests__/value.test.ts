import { describe, expect, it } from "vitest";
import { cumulativeValue, ladder, planSignals, validateLadder } from "../value/engine";
import { landValue } from "../templates/land-acquisition";
import { TEMPLATES } from "../templates";
import { RUNGS } from "../stages";
import { hashEmail, normalizePhone } from "../hash";

const now = new Date("2026-09-28T12:00:00Z");
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);

describe("value ladder", () => {
  it.each(TEMPLATES.map((t) => [t.id, t] as const))("template %s ladder is valid and strictly rising", (_id, t) => {
    const v = validateLadder(t.value, t.scoring.clamp.max);
    expect(v.issues.filter((i) => i.level === "error")).toEqual([]);
    for (let i = 1; i < v.rows.length; i++) {
      for (const [type, val] of Object.entries(v.rows[i].byType)) {
        expect(val).toBeGreaterThan(i === 1 ? v.rows[0].max : v.rows[i - 1].byType[type]);
      }
    }
    // Every qualified value beats every possible form value.
    expect(Math.min(...Object.values(v.rows[1].byType))).toBeGreaterThan(v.rows[0].max);
  });

  it("floors lift a low-spread type above the previous stage maximum", () => {
    const rows = ladder(landValue, 120);
    const q = rows[1];
    // Low Value: 0.2 × 4000 = 800 > 120.01 → not floored; floor itself = 120.01
    expect(q.floor).toBe(120.01);
    const tiny = { ...landValue, spreads: { default: 100 } };
    const r2 = ladder(tiny, 120);
    expect(r2[1].byType.default).toBe(120.01);
    expect(r2[2].byType.default).toBe(120.02);
  });

  it("a cap below the floor is an error", () => {
    const bad = { ...landValue, caps: { ...landValue.caps, qualified: 50 } };
    const v = validateLadder(bad, 120);
    expect(v.ok).toBe(false);
  });

  it("funded true-up uses the actual value when given", () => {
    expect(cumulativeValue(landValue, { stage: "funded", leadType: "Fast Cash", scoreMax: 120, actualValue: 17000 })).toBe(17000);
    expect(cumulativeValue(landValue, { stage: "funded", leadType: "Fast Cash", scoreMax: 120 })).toBe(12000);
  });
});

describe("planSignals", () => {
  const base = {
    leadType: "Title / Probate",
    score: 82,
    scoreMax: 120,
    clickIds: { gclid: "Cj0K", msclkid: "abc" },
    hasHashedUserData: true,
    now,
  };

  it("sends only the increment per platform", () => {
    const d = planSignals(landValue, { ...base, stage: "qualified", clickTs: daysAgo(3), platforms: [{ platform: "google", sent: 82 }, { platform: "microsoft", sent: 0 }] });
    const g = d.find((x) => x.platform === "google")!;
    const m = d.find((x) => x.platform === "microsoft")!;
    expect(g.cumulative).toBe(4400); // 0.2 × 22000
    expect(g.increment).toBe(4318);
    expect(m.increment).toBe(4400);
    expect(g.status).toBe("enqueue");
  });

  it("blocks uploads outside the 90-day window (value kept)", () => {
    const d = planSignals(landValue, { ...base, stage: "funded", clickTs: daysAgo(95), platforms: [{ platform: "google", sent: 16500 }] });
    expect(d[0].status).toBe("blocked_window");
    expect(d[0].cumulative).toBe(22000);
  });

  it("uses the 63-day window when Google can only match on hashed user data", () => {
    const d = planSignals(landValue, { ...base, clickIds: {}, stage: "contract", clickTs: daysAgo(70), platforms: [{ platform: "google", sent: 0 }, { platform: "microsoft", sent: 0 }] });
    expect(d[0]).toMatchObject({ status: "blocked_window", matchType: "enhanced_leads" });
    expect(d[1].status).toBe("no_click_id");
  });

  it("never uploads negative increments", () => {
    const d = planSignals(landValue, { ...base, stage: "qualified", clickTs: daysAgo(1), platforms: [{ platform: "google", sent: 99999 }] });
    expect(d[0].status).toBe("skipped");
  });

  it("stages that are not uploaded roll value into the next one", () => {
    const d = planSignals(landValue, { ...base, stage: "sold", clickTs: daysAgo(1), platforms: [{ platform: "google", sent: 100 }] });
    expect(d[0].status).toBe("skipped");
    const f = planSignals(landValue, { ...base, stage: "funded", clickTs: daysAgo(1), platforms: [{ platform: "google", sent: 100 }] });
    expect(f[0].increment).toBe(22000 - 100);
  });

  it("sum of increments equals the final cumulative value", () => {
    let sent = 0;
    for (const stage of RUNGS) {
      const [d] = planSignals(landValue, { ...base, stage, clickTs: daysAgo(10), platforms: [{ platform: "google", sent }] });
      if (d.status === "enqueue") sent += d.increment;
    }
    expect(sent).toBe(22000);
  });
});

describe("hashing", () => {
  it("normalises before hashing", () => {
    expect(hashEmail("  Seller@Example.com ")).toBe(hashEmail("seller@example.com"));
    expect(normalizePhone("(828) 555-0100")).toBe("+18285550100");
    expect(normalizePhone("+63 917 851 0963")).toBe("+639178510963");
  });
});
