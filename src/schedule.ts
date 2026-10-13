// When the automatic scan and sync are due. Pure: no Obsidian here. Days are local calendar days, `YYYY-MM-DD`.
import { addDays } from "./inbox/scan";

/** The most recent scan day (a weekday, 0 = Sunday … 6 = Saturday) on or before `today`, as `YYYY-MM-DD`. */
export function latestScanDay(today: string, scanDay: number): string {
  const [y, m, d] = today.split("-").map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return addDays(today, -((weekday - scanDay + 7) % 7));
}

/**
 * The weekly scan is due when none has completed since the latest scan day: never scanned, or the last complete scan
 * is before that day. A scan on any other day of the week (by hand, say) therefore counts for that week.
 */
export function scanDue(lastScan: string, today: string, scanDay: number): boolean {
  return lastScan === "" || lastScan < latestScanDay(today, scanDay);
}

/** The automatic sync runs once a day: due when it has not run today. */
export function syncDue(lastSync: string, today: string): boolean {
  return lastSync === "" || lastSync < today;
}
