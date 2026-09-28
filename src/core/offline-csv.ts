import { toCsv } from "./csv";

/**
 * Offline-conversion upload files for the ad platforms' own upload screens (works before API approval).
 * Google Ads: Goals → Conversions → Uploads (click conversions). Microsoft Advertising: Conversions → Offline conversions → Upload.
 * Column names follow each platform's published template (Sep 2026). Download the current template once and compare
 * headers before the first upload.
 */
export type OfflineRow = {
  transactionId: string;
  stageName: string; // conversion action / goal name as created in the ad account
  time: Date; // UTC
  value: number;
  currency: string;
  gclid?: string | null;
  gbraid?: string | null;
  wbraid?: string | null;
  msclkid?: string | null;
};

const pad = (n: number) => String(n).padStart(2, "0");
/** "yyyy-MM-dd HH:mm:ss" in UTC. */
export function utcStamp(d: Date) {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

/** Google click-conversion upload. The first line sets the time zone for every row (UTC). Rows need a gclid. */
export function googleOfflineCsv(rows: OfflineRow[]) {
  const usable = rows.filter((r) => r.gclid);
  const body = toCsv(
    ["Google Click ID", "Conversion Name", "Conversion Time", "Conversion Value", "Conversion Currency", "Order ID"],
    usable.map((r) => [r.gclid, r.stageName, utcStamp(r.time), r.value.toFixed(2), r.currency, r.transactionId]),
  );
  return { csv: `Parameters:TimeZone=Etc/GMT\r\n${body}`, count: usable.length, skipped: rows.length - usable.length };
}

/** Microsoft offline conversion upload (UTC times). Rows need an msclkid. */
export function microsoftOfflineCsv(rows: OfflineRow[]) {
  const usable = rows.filter((r) => r.msclkid);
  const body = toCsv(
    ["Microsoft Click ID", "Conversion Name", "Conversion Time", "Conversion Value", "Conversion Currency Code"],
    usable.map((r) => [r.msclkid, r.stageName, utcStamp(r.time), r.value.toFixed(2), r.currency]),
  );
  return { csv: `Parameters:TimeZone=UTC\r\n${body}`, count: usable.length, skipped: rows.length - usable.length };
}
