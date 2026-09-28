import { describe, expect, it, vi } from "vitest";

const upserts: Record<string, unknown>[] = [];
vi.mock("@/lib/supabase/admin", () => ({
  admin: () => ({
    from: () => ({
      upsert: (rows: Record<string, unknown>[]) => {
        upserts.push(...rows);
        return Promise.resolve({ error: null });
      },
    }),
  }),
}));

describe("spend CSV import", () => {
  it("normalises platforms, dates and money; skips bad rows; tolerates a BOM", async () => {
    const { importSpendCsv } = await import("../spend");
    const csv =
      "﻿Date,Platform,Campaign,Cost,Clicks,Impressions\r\n" +
      '09/27/2026,Bing,Bing – Sell Land Test,"$1,096.10",74,2210\r\n' +
      "2026-09-27,Google Ads,Search – Format Test,412.5,318,9120\r\n" +
      "not-a-date,google,Should be skipped,10,1,1\r\n" +
      "2026-09-28,google,Also skipped,abc,1,1\r\n";
    const r = await importSpendCsv("ws-1", csv);
    expect(r).toEqual({ imported: 2, skipped: 2 });
    expect(upserts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ platform: "microsoft", date: "2026-09-27", cost: 1096.1, clicks: 74, campaign: "Bing – Sell Land Test" }),
        expect.objectContaining({ platform: "google", date: "2026-09-27", cost: 412.5, campaign_id: "Search – Format Test" }),
      ]),
    );
  });
});
