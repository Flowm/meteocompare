// Typed client for the open-meteo forecast API.
// Docs: https://open-meteo.com/en/docs

import { MODEL_IDS } from "@/domain/models";

const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";

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
  /** Optional subset of model ids; defaults to the full registry. */
  models?: string[];
  forecastDays?: number;
}

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
  daily: { time: string[] } & Partial<Record<string, (number | null)[]>>;
  daily_units: Record<string, string>;
  current: { time: string; interval: number } & Partial<Record<string, number | null>>;
  current_units: Record<string, string>;
}

export async function fetchForecast(req: ForecastRequest, signal?: AbortSignal): Promise<ForecastResponse> {
  const full: Required<ForecastRequest> = {
    lat: req.lat,
    lon: req.lon,
    models: req.models ?? MODEL_IDS,
    forecastDays: req.forecastDays ?? 10,
  };

  const params = new URLSearchParams({
    latitude: String(full.lat),
    longitude: String(full.lon),
    hourly: HOURLY_VARS.join(","),
    daily: [...DAILY_VARS, ...DAILY_SOLAR_VARS].join(","),
    current: CURRENT_VARS.join(","),
    models: full.models.join(","),
    forecast_days: String(full.forecastDays),
    timezone: "auto",
    wind_speed_unit: "kmh",
    temperature_unit: "celsius",
    precipitation_unit: "mm",
  });

  const url = `${FORECAST_URL}?${params}`;
  const res = await fetch(url, { signal });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`open-meteo forecast ${res.status}: ${text || res.statusText}`);
  }
  return (await res.json()) as ForecastResponse;
}

/** Pull a per-model hourly series for one base variable.
 *  open-meteo suffixes each variable with the model id (e.g. temperature_2m_ecmwf_ifs025). */
export function extractHourlyByModel(resp: ForecastResponse, variable: HourlyVar, modelIds: string[]): Record<string, (number | null)[]> {
  const out: Record<string, (number | null)[]> = {};
  for (const id of modelIds) {
    const key = `${variable}_${id}`;
    const arr = resp.hourly[key];
    if (arr) out[id] = arr;
  }
  return out;
}

export function extractDailyByModel(resp: ForecastResponse, variable: DailyVar, modelIds: string[]): Record<string, (number | null)[]> {
  const out: Record<string, (number | null)[]> = {};
  for (const id of modelIds) {
    const key = `${variable}_${id}`;
    const arr = resp.daily[key];
    if (arr) out[id] = arr;
  }
  return out;
}

/** Astronomical sunrise/sunset are identical across models (computed from lat/lon),
 *  but open-meteo suffixes them per model when `models=` is set. Pick any. */
export function extractDailySolar(resp: ForecastResponse, modelIds: string[]): { sunrise: string[]; sunset: string[] } | null {
  const daily = resp.daily as { [key: string]: string[] | (number | null)[] | undefined };
  for (const id of modelIds) {
    const sunrise = daily[`sunrise_${id}`] as string[] | undefined;
    const sunset = daily[`sunset_${id}`] as string[] | undefined;
    if (sunrise && sunset) return { sunrise, sunset };
  }
  const sunrise = daily.sunrise as string[] | undefined;
  const sunset = daily.sunset as string[] | undefined;
  if (sunrise && sunset) return { sunrise, sunset };
  return null;
}

export { HOURLY_VARS, DAILY_VARS, CURRENT_VARS };
