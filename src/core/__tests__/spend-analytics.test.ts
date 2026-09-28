import { describe, expect, it } from "vitest";
import { analyzeSpend, bucketOf } from "../spend-analytics";

const spend = [
  { date: "2026-09-21", platform: "google", campaign: "A", campaign_id: "g1", cost: 100, clicks: 50, impressions: 1000 },
  { date: "2026-09-22", platform: "google", campaign: "A", campaign_id: "g1", cost: 100, clicks: 50, impressions: 1000 },
  { date: "2026-09-22", platform: "microsoft", campaign: "B", campaign_id: "m1", cost: 100, clicks: 20, impressions: 2000 },
  { date: "2026-09-29", platform: "google", campaign: "A", campaign_id: "g1", cost: 50, clicks: 10, impressions: 500 },
];
const leads = [
  { campaign: "A", campaign_id: null, platform: "google", created_at: "2026-09-21T10:00:00Z", stage: "contract", value: 5000 },
  { campaign: null, campaign_id: "m1", platform: "microsoft", created_at: "2026-09-22T10:00:00Z", stage: "submitted", value: 50 },
  { campaign: "B", campaign_id: null, platform: "bing", created_at: "2026-09-23T10:00:00Z", stage: "lost", value: 0 },
];

describe("spend analytics", () => {
  it("buckets by ISO week (Monday) and month", () => {
    expect(bucketOf("2026-09-27", "week")).toBe("2026-09-21");
    expect(bucketOf("2026-09-28", "week")).toBe("2026-09-28");
    expect(bucketOf("2026-09-28", "month")).toBe("2026-09");
  });
  it("computes platform and campaign metrics and joins leads by campaign name or id", () => {
    const a = analyzeSpend(spend, leads, "week");
    expect(a.total).toMatchObject({ cost: 350, clicks: 130, leads: 3, contracts: 1, value: 5050 });
    const A = a.campaigns.find((c) => c.campaign === "A")!;
    expect(A.ctr).toBeCloseTo(110 / 2500);
    expect(A.cpc).toBeCloseTo(250 / 110);
    expect(A.roas).toBeCloseTo(5000 / 250);
    const B = a.campaigns.find((c) => c.campaign === "B")!;
    expect(B.leads).toBe(2);
    expect(a.platforms.map((p) => p.platform).sort()).toEqual(["google", "microsoft"]);
    expect(a.timeline.map((t) => t.bucket)).toEqual(["2026-09-21", "2026-09-28"]);
  });
  it("writes insights naming the best and worst campaigns", () => {
    const a = analyzeSpend(spend, leads, "day");
    const text = a.insights.map((i) => i.text).join(" | ");
    expect(text).toContain("A returns the most pipeline value per dollar");
    expect(text).toContain("B returns the least value per dollar");
  });
});
