import { useLocalStorage } from "@vueuse/core";
import { computed } from "vue";

import type { DataVarId } from "./hourlySeries";

export type TemperatureUnit = "c" | "f";
export type PrecipitationUnit = "mm" | "in";
export type WindUnit = "kmh" | "mph";

/** The user's chosen units, as a plain value object. The single shape every
 *  conversion + formatting helper takes — `useUnits().prefs` exposes it live. */
export interface UnitPrefs {
  temp: TemperatureUnit;
  precip: PrecipitationUnit;
  wind: WindUnit;
}

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;

// ---------------------------------------------------------------------------
// Unit conversion — the single source of truth for the °C/°F, mm/in, km/h/mph
// arithmetic. Both the chart (chartOption) and the cards (useUnits formatters,
// LocationBanner) route through these so the factors can never drift apart.
// ---------------------------------------------------------------------------

/** Convert a base-unit value (°C, mm, km/h, %) into the user's chosen unit.
 *  Returns null for null/NaN so callers can render a placeholder. */
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

/** Axis/suffix label for a variable under the chosen units. */
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

/** Format a number with an explicit leading `+` for non-negatives (the `-` is
 *  intrinsic). Used for signed error / bias readouts. Stateless. */
export function signed(n: number, digits = 1): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(digits)}`;
}

/** Format a percentage. Stateless — hoisted out of the composable. */
export function formatPercent(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "–";
  return `${Math.round(v)}%`;
}

/** Convert a 0–360° bearing into an 8-point compass label (N, NE, E, …). */
export function compassPoint(deg: number | null | undefined): string {
  if (deg == null || Number.isNaN(deg)) return "–";
  const idx = Math.round((((deg % 360) + 360) % 360) / 45) % 8;
  return COMPASS[idx] ?? "–";
}

export function useUnits() {
  const temp = useLocalStorage<TemperatureUnit>("meteocompare:unit:temp", "c");
  const precip = useLocalStorage<PrecipitationUnit>("meteocompare:unit:precip", "mm");
  const wind = useLocalStorage<WindUnit>("meteocompare:unit:wind", "kmh");

  /** Live view of the chosen units — pass straight to convertVar/unitLabel. */
  const prefs = computed<UnitPrefs>(() => ({ temp: temp.value, precip: precip.value, wind: wind.value }));

  // Formatters = canonical conversion + unit suffix. Temperature glues the
  // degree symbol on directly; precip/wind take a hair of space before the unit.
  const formatTemp = computed(() => (v: number | null | undefined, digits = 0): string => {
    const x = convertVar(v, "temperature_2m", prefs.value);
    return x == null ? "–" : `${x.toFixed(digits)}${unitLabel("temperature_2m", prefs.value)}`;
  });

  const formatPrecip = computed(() => (v: number | null | undefined, digits = 1): string => {
    const x = convertVar(v, "precipitation", prefs.value);
    return x == null ? "–" : `${x.toFixed(digits)} ${unitLabel("precipitation", prefs.value)}`;
  });

  const formatWind = computed(() => (v: number | null | undefined, digits = 0): string => {
    const x = convertVar(v, "wind_speed_10m", prefs.value);
    return x == null ? "–" : `${x.toFixed(digits)} ${unitLabel("wind_speed_10m", prefs.value)}`;
  });

  return { temp, precip, wind, prefs, formatTemp, formatPrecip, formatWind, formatPercent, compassPoint };
}
