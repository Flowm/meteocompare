/** Add `days` to an ISO `YYYY-MM-DD` date using UTC arithmetic so the result
 *  is independent of the browser's timezone. */
export function addDaysIso(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole days from `fromIso` to `toIso` (both `YYYY-MM-DD`), UTC-based so the
 *  result is timezone-independent. Positive when `toIso` is the later date. */
export function daysBetweenIso(fromIso: string, toIso: string): number {
  const from = new Date(`${fromIso}T00:00:00Z`).getTime();
  const to = new Date(`${toIso}T00:00:00Z`).getTime();
  return Math.round((to - from) / 86_400_000);
}

/** Shift a timezone-free ISO timestamp by a fixed offset, without using the
 *  browser's timezone. API response offsets define the clock on each series. */
export function shiftIsoTime(isoTime: string, seconds: number): string {
  if (seconds === 0) return isoTime;
  const timestamp = Date.parse(`${isoTime}Z`);
  if (!Number.isFinite(timestamp)) return isoTime;
  return new Date(timestamp + seconds * 1000).toISOString().slice(0, 16);
}
