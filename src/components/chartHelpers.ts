// Shared helpers for the unified hourly chart (HourlySeriesChart).
// Open-meteo gives us local-time ISO strings (no TZ suffix) for both the
// hourly grid and the daily sunrise/sunset values, so simple string compare
// and numeric ms math are both safe within a single response.

import type { DataVarId } from "@/composables/hourlySeries";

// ---------------------------------------------------------------------------
// Variable selector model
// ---------------------------------------------------------------------------

/** A selectable entry in the chart's variable strip. Most map 1:1 to a
 *  DataVarId; `temp_precip` is a composite overview that draws temperature
 *  (line + band) and precipitation (bars) together on a dual axis. */
export type ChartViewId = "temp_precip" | DataVarId;

export interface ChartViewMeta {
  label: string;
  /** Underlying data variables this view renders. */
  vars: DataVarId[];
  /** Variable a single overlay line is drawn for. Composite views snap to
   *  this when the per-model overlay is enabled (two fans on two axes is unreadable). */
  overlayVar: DataVarId;
}

export const CHART_VIEWS: Record<ChartViewId, ChartViewMeta> = {
  temp_precip: { label: "Temp + Precip", vars: ["temperature_2m", "precipitation"], overlayVar: "temperature_2m" },
  temperature_2m: { label: "Temperature", vars: ["temperature_2m"], overlayVar: "temperature_2m" },
  precipitation: { label: "Precipitation", vars: ["precipitation"], overlayVar: "precipitation" },
  precipitation_probability: { label: "Precip. prob.", vars: ["precipitation_probability"], overlayVar: "precipitation_probability" },
  wind_speed_10m: { label: "Wind speed", vars: ["wind_speed_10m"], overlayVar: "wind_speed_10m" },
  cloud_cover: { label: "Cloud cover", vars: ["cloud_cover"], overlayVar: "cloud_cover" },
};

// ---------------------------------------------------------------------------
// Combinable-pair view model
// ---------------------------------------------------------------------------
// Temperature (left axis) and precipitation (right axis) are the one
// combinable pair: showing both together *is* the `temp_precip` composite
// view. Every other variable is an exclusive single-axis view. Modelling the
// active selection as a set of variables — rather than juggling tempOn/precipOn
// booleans — keeps the picker's toggle logic a single, testable transform.

/** The dual-axis pair that can be shown together as the composite view. */
export const COMBINABLE_VARS: readonly DataVarId[] = ["temperature_2m", "precipitation"];

function isCombinable(v: DataVarId): boolean {
  return COMBINABLE_VARS.includes(v);
}

/** The underlying data variables a view renders, as a set. */
export function viewVars(view: ChartViewId): Set<DataVarId> {
  return new Set(CHART_VIEWS[view].vars);
}

/** Map a non-empty set of combinable variables back to its view id. */
function combinableView(active: Set<DataVarId>): ChartViewId {
  const temp = active.has("temperature_2m");
  const precip = active.has("precipitation");
  return temp && precip ? "temp_precip" : temp ? "temperature_2m" : "precipitation";
}

/** Whether a picker entry reads as "active" for the current view. When the
 *  combinable pair is in play, temperature/precipitation are active whenever the
 *  current view includes them (the composite counts for both). */
export function isVarActive(view: ChartViewId, vid: ChartViewId, combinable: boolean): boolean {
  if (combinable && vid !== "temp_precip" && isCombinable(vid)) {
    return viewVars(view).has(vid);
  }
  return view === vid;
}

/** Toggle `clicked` within the active combinable set and return the resulting
 *  view. Coming from an exclusive view (wind/cloud/prob) focuses the click;
 *  toggling off the last remaining variable is a no-op (the pair never empties). */
export function nextCombinableView(view: ChartViewId, clicked: DataVarId): ChartViewId {
  const active = new Set<DataVarId>([...viewVars(view)].filter(isCombinable));
  if (active.size === 0) {
    active.add(clicked); // focusing in from an exclusive view
  } else if (active.has(clicked)) {
    active.delete(clicked);
  } else {
    active.add(clicked);
  }
  if (active.size === 0) active.add(clicked); // never leave the pair empty
  return combinableView(active);
}

// ---------------------------------------------------------------------------
// Time-axis helpers (unchanged)
// ---------------------------------------------------------------------------

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
