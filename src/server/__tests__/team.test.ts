import { describe, expect, it } from "vitest";
import { attentionScore, TEAM_RANK, TEAM_ROLE_MEMBERSHIP, type WsMetrics } from "../team";

const base: WsMetrics = { workspace_id: "w", leads_7d: 5, leads_30d: 20, qualified_7d: 2, contracts_30d: 1, funded_30d: 0, alerts_open: 0, alerts_critical: 0, failed_30d: 0, last_tag_event: null, last_lead_at: null, open_tasks: 0, overdue_tasks: 0 };
const now = Date.parse("2026-10-01T12:00:00Z");

describe("team", () => {
  it("healthy workspace scores low", () => {
    expect(attentionScore({ ...base, last_tag_event: "2026-10-01T11:00:00Z" }, now)).toBe(0);
  });
  it("critical alerts, failures, overdue work and a quiet tag raise the score (capped at 100)", () => {
    const s = attentionScore({ ...base, alerts_open: 3, alerts_critical: 2, failed_30d: 10, overdue_tasks: 3, leads_7d: 0 }, now);
    expect(s).toBe(100);
    expect(attentionScore({ ...base, last_tag_event: "2026-09-29T00:00:00Z" }, now)).toBe(15);
  });
  it("role model: super-admin > admin > user; users get no org-wide membership", () => {
    expect(TEAM_RANK.super_admin).toBeGreaterThan(TEAM_RANK.admin);
    expect(TEAM_RANK.admin).toBeGreaterThan(TEAM_RANK.user);
    expect(TEAM_ROLE_MEMBERSHIP).toEqual({ super_admin: "owner", admin: "admin", user: null });
  });
});
