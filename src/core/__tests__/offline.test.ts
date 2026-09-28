import { describe, expect, it } from "vitest";
import { googleOfflineCsv, microsoftOfflineCsv, utcStamp } from "../offline-csv";

const rows = [
  { transactionId: "l1-qualified", stageName: "Acme – Qualified", time: new Date("2026-09-28T14:02:11Z"), value: 4318, currency: "USD", gclid: "Cj0K" },
  { transactionId: "l2-contract", stageName: "Acme – Contract", time: new Date("2026-09-29T01:00:00Z"), value: 12100.5, currency: "USD", msclkid: "ms1" },
];

describe("offline conversion files", () => {
  it("formats UTC times", () => expect(utcStamp(new Date("2026-01-02T03:04:05Z"))).toBe("2026-01-02 03:04:05"));
  it("Google file has only gclid rows, time zone line and Order ID", () => {
    const g = googleOfflineCsv(rows);
    expect(g.count).toBe(1);
    expect(g.skipped).toBe(1);
    const lines = g.csv.trim().split("\r\n");
    expect(lines[0]).toBe("Parameters:TimeZone=Etc/GMT");
    expect(lines[1]).toBe("Google Click ID,Conversion Name,Conversion Time,Conversion Value,Conversion Currency,Order ID");
    expect(lines[2]).toBe("Cj0K,Acme – Qualified,2026-09-28 14:02:11,4318.00,USD,l1-qualified");
  });
  it("Microsoft file has only msclkid rows", () => {
    const m = microsoftOfflineCsv(rows);
    expect(m.count).toBe(1);
    expect(m.csv).toContain("ms1,Acme – Contract,2026-09-29 01:00:00,12100.50,USD");
  });
});
