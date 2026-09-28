import { describe, expect, it } from "vitest";
import { deflateRawSync } from "node:zlib";
import { conversionActionOps, parseSearchStream, spendQuery } from "../google/ads";
import { conversionGoalBody, parseSpendCsv, unzipFirst } from "../microsoft/reporting";

function zipOne(name: string, content: string): Buffer {
  const data = deflateRawSync(Buffer.from(content));
  const h = Buffer.alloc(30);
  h.writeUInt32LE(0x04034b50, 0);
  h.writeUInt16LE(8, 8);
  h.writeUInt32LE(data.length, 18);
  h.writeUInt32LE(content.length, 22);
  h.writeUInt16LE(name.length, 26);
  return Buffer.concat([h, Buffer.from(name), data]);
}

describe("Google Ads reporting", () => {
  it("builds a dated GAQL query", () => expect(spendQuery(7)).toMatch(/FROM campaign WHERE segments\.date BETWEEN '\d{4}-\d{2}-\d{2}' AND '\d{4}-\d{2}-\d{2}'/));
  it("converts micros to currency", () => {
    const rows = parseSearchStream([{ results: [{ segments: { date: "2026-09-27" }, campaign: { id: "1", name: "Sell Land" }, metrics: { costMicros: "412500000", clicks: "318", impressions: "9120" } }] }]);
    expect(rows[0]).toEqual({ date: "2026-09-27", campaign_id: "1", campaign: "Sell Land", cost: 412.5, clicks: 318, impressions: 9120 });
  });
  it("creates secondary upload-clicks actions per stage", () => {
    const ops = conversionActionOps([{ stage: "qualified", name: "X – Qualified" }], "USD");
    expect(ops.operations[0].create).toMatchObject({ type: "UPLOAD_CLICKS", category: "QUALIFIED_LEAD", primaryForGoal: false });
  });
});

describe("Microsoft reporting", () => {
  const csv = '"TimePeriod","CampaignId","CampaignName","Spend","Clicks","Impressions"\r\n"2026-09-27","55","Sell Land","1,096.10","74","2210"\r\n';
  it("reads the zipped CSV report", () => {
    expect(parseSpendCsv(unzipFirst(zipOne("r.csv", csv)))).toEqual([{ date: "2026-09-27", campaign_id: "55", campaign: "Sell Land", cost: 1096.1, clicks: 74, impressions: 2210 }]);
  });
  it("offline goals are excluded from bidding at creation", () => {
    expect(conversionGoalBody([{ stage: "contract", name: "X – Contract" }], "USD").ConversionGoals[0]).toMatchObject({ Type: "OfflineConversion", ExcludeFromBidding: true });
  });
});
