// Typed client for the open-meteo forecast API.
// Docs: https://open-meteo.com/en/docs

import { MODEL_IDS } from "@/domain/models";

import { baseParams, buildOpenMeteoUrl, fetchOpenMeteoJson } from "./openMeteo";

const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";

// open-meteo only derives precipitation_probability from ensemble members, so
// deterministic models return all-null. Where a model has an ensemble-backed
// "seamless" sibling we fetch that sibling purely for the probability variables
// and read its series under the deterministic id — no extra aggregation vote.
// DWD: icon_seamless routes to ICON(-EU/-D2)-EPS, available globally to ~7 days,
// matching icon_global's coverage, so its probability grafts onto icon_global.
const PROBABILITY_SOURCE: Readonly<Record<string, string>> = { icon_global: "icon_seamless" };
const PROBABILITY_VARS = new Set<string>(["precipitation_probability", "precipitation_probability_max"]);

/** The model-id suffix to read a (variable, model) pair from. For probability
 *  variables on models with an ensemble-backed source, redirects to that source. */
function sourceSuffix(variable: string, id: string): string {
  return PROBABILITY_VARS.has(variable) ? (PROBABILITY_SOURCE[id] ?? id) : id;
}

/** Registry ids plus the extra ensemble sources fetched only for probability. */
export const FETCH_MODEL_IDS: string[] = [...new Set([...MODEL_IDS, ...Object.values(PROBABILITY_SOURCE)])];

const HOURLY_VARS = ["temperature_2m", "precipitation", "precipitation_probability", "weather_code", "wind_speed_10m", "wind_direction_10m", "cloud_cover"] as const;

const DAILY_VARS = [
  "weather_code",
  "temperature_2m_max",
  "temperature_2m_min",
  "precipitation_sum",
  "precipitation_probability_max",
  "wind_speed_10m_max",
  "wind_direction_10m_dominant",
] as const;

// Astronomical values — not per-model, returned as ISO local-time strings.
const DAILY_SOLAR_VARS = ["sunrise", "sunset"] as const;

const CURRENT_VARS = ["temperature_2m", "precipitation", "weather_code", "wind_speed_10m", "wind_direction_10m", "is_day"] as const;

export type HourlyVar = (typeof HOURLY_VARS)[number];
export type DailyVar = (typeof DAILY_VARS)[number];
export type CurrentVar = (typeof CURRENT_VARS)[number];

export interface ForecastRequest {
  lat: number;
  lon: number;
  /** Defaults to the full registry. */
  models?: string[];
  forecastDays?: number;
}

// The forecast `daily` block. Numeric per-model columns keyed by `<var>_<id>`,
// plus the astronomical solar columns — which are ISO-time `string[]`, bare or
// suffixed per model when `models=` is set. The solar keys are typed via
// template-literal + explicit-key records intersected with the numeric one, so
// extractDailySolar reads them as `string[]` without a widening cast while
// numeric callers (extractDailyByModel) keep their `(number | null)[]` columns.
type DailyBlock = { time: string[] } & Partial<Record<`sunrise_${string}` | `sunset_${string}` | "sunrise" | "sunset", string[]>> & Partial<Record<string, (number | null)[]>>;

export interface ForecastResponse {
  latitude: number;
  longitude: number;
  elevation: number;
  generationtime_ms: number;
  utc_offset_seconds: number;
  timezone: string;
  timezone_abbreviation: string;
  hourly: { time: string[] } & Partial<Record<string, (number | null)[]>>;
  hourly_units: Record<string, string>;
  daily: DailyBlock;
  daily_units: Record<string, string>;
  current: { time: string; interval: number } & Partial<Record<string, number | null>>;
  current_units: Record<string, string>;
}

export async function fetchForecast(req: ForecastRequest, signal?: AbortSignal): Promise<ForecastResponse> {
  const full: Required<ForecastRequest> = {
    lat: req.lat,
    lon: req.lon,
    models: req.models ?? FETCH_MODEL_IDS,
    forecastDays: req.forecastDays ?? 10,
  };

  const params = baseParams(full.lat, full.lon, {
    hourly: HOURLY_VARS.join(","),
    daily: [...DAILY_VARS, ...DAILY_SOLAR_VARS].join(","),
    current: CURRENT_VARS.join(","),
    models: full.models.join(","),
    forecast_days: String(full.forecastDays),
  });

  const url = buildOpenMeteoUrl(FORECAST_URL, params);
  return fetchOpenMeteoJson<ForecastResponse>(url, "forecast", signal);
}

/** Pull a per-model hourly series for one base variable.
 *  open-meteo suffixes each variable with the model id (e.g. temperature_2m_ecmwf_ifs). */
export function extractHourlyByModel(resp: ForecastResponse, variable: HourlyVar, modelIds: string[]): Record<string, (number | null)[]> {
  const out: Record<string, (number | null)[]> = {};
  for (const id of modelIds) {
    const key = `${variable}_${sourceSuffix(variable, id)}`;
    const arr = resp.hourly[key];
    if (arr) out[id] = arr;
  }
  return out;
}

export function extractDailyByModel(resp: ForecastResponse, variable: DailyVar, modelIds: string[]): Record<string, (number | null)[]> {
  const out: Record<string, (number | null)[]> = {};
  for (const id of modelIds) {
    const key = `${variable}_${sourceSuffix(variable, id)}`;
    const arr = resp.daily[key];
    if (arr) out[id] = arr;
  }
  return out;
}

/** Astronomical sunrise/sunset are identical across models (computed from lat/lon),
 *  but open-meteo suffixes them per model when `models=` is set. Pick any. */
export function extractDailySolar(resp: ForecastResponse, modelIds: string[]): { sunrise: string[]; sunset: string[] } | null {
  const daily = resp.daily;
  for (const id of modelIds) {
    const sunrise = daily[`sunrise_${id}`];
    const sunset = daily[`sunset_${id}`];
    if (sunrise && sunset) return { sunrise, sunset };
  }
  const { sunrise, sunset } = daily;
  if (sunrise && sunset) return { sunrise, sunset };
  return null;
}

/** Solar series for the registry models from a (possibly absent) response.
 *  Null until the response lands — the shape both data composables expose for
 *  the chart's day/night shading, so the registry-ids + null-guard live once. */
export function solarFrom(resp: ForecastResponse | null): { sunrise: string[]; sunset: string[] } | null {
  return resp ? extractDailySolar(resp, MODEL_IDS) : null;
}

export { HOURLY_VARS, DAILY_VARS, CURRENT_VARS };
