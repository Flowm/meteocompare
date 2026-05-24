// Shared helpers for the hourly-axis charts (HourlyChart + ModelBreakdown).
// Open-meteo gives us local-time ISO strings (no TZ suffix) for both the
// hourly grid and the daily sunrise/sunset values, so simple string compare
// and numeric ms math are both safe within a single response.

/** First index in `times` whose timestamp is at or after `nowStr`. */
export function findNowIndex(times: string[], nowStr: string): number {
  for (let i = 0; i < times.length; i++) {
    const t = times[i];
    if (t !== undefined && t >= nowStr) return i;
  }
  return -1;
}

/** Map a sunrise/sunset ISO string to the nearest hourly index in [0, count). */
function isoToHourIndex(iso: string, baseMs: number, count: number): number {
  const idx = Math.round((new Date(iso).getTime() - baseMs) / 3_600_000);
  return Math.max(0, Math.min(count - 1, idx));
}

/** Build [startIdx, endIdx] pairs covering night hours within the visible window. */
export function buildNightRanges(times: string[], sunrise: string[] | undefined, sunset: string[] | undefined): Array<[number, number]> {
  if (!times.length || !sunrise?.length || !sunset?.length) return [];
  const firstTime = times[0];
  const firstSunrise = sunrise[0];
  if (firstTime === undefined || firstSunrise === undefined) return [];
  const baseMs = new Date(firstTime).getTime();
  const count = times.length;
  const ranges: Array<[number, number]> = [];

  // Pre-dawn on the first day.
  const firstRise = isoToHourIndex(firstSunrise, baseMs, count);
  if (firstRise > 0) ranges.push([0, firstRise]);

  // Sunset of day i → sunrise of day i+1.
  for (let i = 0; i < sunset.length; i++) {
    const sunsetTime = sunset[i];
    if (sunsetTime === undefined) continue;
    const setIdx = isoToHourIndex(sunsetTime, baseMs, count);
    const nextRiseIso = sunrise[i + 1];
    const endIdx = nextRiseIso ? isoToHourIndex(nextRiseIso, baseMs, count) : count - 1;
    if (endIdx > setIdx) ranges.push([setIdx, endIdx]);
  }
  return ranges;
}
