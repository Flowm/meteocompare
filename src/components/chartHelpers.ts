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

/** Which y-axis a data variable belongs to. */
export type AxisKind = "temp" | "precip" | "pct" | "wind";

export interface ChartViewMeta {
  label: string;
  /** Underlying data variables this view renders. */
  vars: DataVarId[];
  /** Variable a single line/spaghetti is drawn for. Composite views snap to
   *  this when spaghetti mode is enabled (two fans on two axes is unreadable). */
  spaghettiVar: DataVarId;
}

export const CHART_VIEWS: Record<ChartViewId, ChartViewMeta> = {
  temp_precip: { label: "Temp + Precip", vars: ["temperature_2m", "precipitation"], spaghettiVar: "temperature_2m" },
  temperature_2m: { label: "Temperature", vars: ["temperature_2m"], spaghettiVar: "temperature_2m" },
  precipitation: { label: "Precipitation", vars: ["precipitation"], spaghettiVar: "precipitation" },
  precipitation_probability: { label: "Precip. prob.", vars: ["precipitation_probability"], spaghettiVar: "precipitation_probability" },
  wind_speed_10m: { label: "Wind speed", vars: ["wind_speed_10m"], spaghettiVar: "wind_speed_10m" },
  cloud_cover: { label: "Cloud cover", vars: ["cloud_cover"], spaghettiVar: "cloud_cover" },
};

interface DataVarMeta {
  axis: AxisKind;
  /** How the aggregate is drawn. Only `precipitation` is bars (and thus never
   *  gets a confidence band). */
  render: "line" | "bars";
}

export const DATA_VAR_META: Record<DataVarId, DataVarMeta> = {
  temperature_2m: { axis: "temp", render: "line" },
  precipitation: { axis: "precip", render: "bars" },
  precipitation_probability: { axis: "pct", render: "line" },
  wind_speed_10m: { axis: "wind", render: "line" },
  cloud_cover: { axis: "pct", render: "line" },
};

// ---------------------------------------------------------------------------
// Unit conversion / formatting
// ---------------------------------------------------------------------------

export interface UnitPrefs {
  temp: "c" | "f";
  precip: "mm" | "in";
  wind: "kmh" | "mph";
}

/** Convert a base-unit value (°C, mm, km/h, %) into the user's chosen unit. */
export function convertVar(v: number | null | undefined, varId: DataVarId, u: UnitPrefs): number | null {
  if (v == null || Number.isNaN(v)) return null;
  switch (varId) {
    case "temperature_2m":
      return u.temp === "f" ? (v * 9) / 5 + 32 : v;
    case "precipitation":
      return u.precip === "in" ? v / 25.4 : v;
    case "wind_speed_10m":
      return u.wind === "mph" ? v / 1.609344 : v;
    default:
      return v; // precipitation_probability, cloud_cover — already %
  }
}

/** Convert a ±stdDev *delta* (base units) into the user's unit. Linear scale
 *  factor only — no offset (a delta of 2 °C is 3.6 °F, not 35.6). */
export function convertDelta(delta: number, varId: DataVarId, u: UnitPrefs): number {
  switch (varId) {
    case "temperature_2m":
      return u.temp === "f" ? (delta * 9) / 5 : delta;
    case "precipitation":
      return u.precip === "in" ? delta / 25.4 : delta;
    case "wind_speed_10m":
      return u.wind === "mph" ? delta / 1.609344 : delta;
    default:
      return delta;
  }
}

export function unitLabel(varId: DataVarId, u: UnitPrefs): string {
  switch (varId) {
    case "temperature_2m":
      return u.temp === "f" ? "°F" : "°C";
    case "precipitation":
      return u.precip === "in" ? "in" : "mm";
    case "wind_speed_10m":
      return u.wind === "mph" ? "mph" : "km/h";
    default:
      return "%";
  }
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
