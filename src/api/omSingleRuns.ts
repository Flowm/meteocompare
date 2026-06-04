// Typed client for open-meteo's Single Runs API.
// Docs: https://open-meteo.com/en/docs/single-runs-api
//
// This API serves *historical* forecast runs — the actual data each model
// produced at a given run cycle. Distinct from /v1/forecast (live current
// runs) and /v1/archive (reanalysis truth). The response shape is the same
// as the forecast API, so we reuse ForecastResponse and the extract helpers.

import { MODELS } from "@/domain/models";

import type { ForecastResponse } from "./omForecast";
import { extractDailyByModel, extractHourlyByModel } from "./omForecast";

const SINGLE_RUNS_URL = "https://single-runs-api.open-meteo.com/v1/forecast";

// Two model sets, derived from each model's `singleRunAvailability` (see the
// registry). CORE = consistently archived, the reliable fallback. FULL also
// includes `partial` models for max coverage; one of them missing for the chosen
// date 4xx's the whole batch, so we fall back to CORE. `never` models are dropped.
const CORE_MODEL_IDS: string[] = MODELS.filter((m) => m.singleRunAvailability === "core").map((m) => m.id);
const FULL_MODEL_IDS: string[] = MODELS.filter((m) => m.singleRunAvailability !== "never").map((m) => m.id);

const HOURLY_VARS = ["temperature_2m", "precipitation"] as const;

const DAILY_VARS = ["temperature_2m_max", "temperature_2m_min", "precipitation_sum", "weather_code"] as const;

// Astronomical values — ISO local-time strings, not per-model numbers. Kept
// out of DAILY_VARS (which types as numeric) and consumed via extractDailySolar
// to drive the chart's day/night shading. Same split the forecast API uses.
const DAILY_SOLAR_VARS = ["sunrise", "sunset"] as const;

export type SingleRunsHourlyVar = (typeof HOURLY_VARS)[number];
export type SingleRunsDailyVar = (typeof DAILY_VARS)[number];

export interface SingleRunsRequest {
  lat: number;
  lon: number;
  /** ISO local date (`YYYY-MM-DD`). Combined with `T00:00` at request time —
   *  by app convention every verification run is the 00Z cycle. */
  runDate: string;
  /** Optional subset of model ids; defaults to the full registry. */
  models?: string[];
  /** Days forward from the run start; defaults to 7. */
  forecastDays?: number;
}

/** Same shape as the live forecast response — variables are suffixed with
 *  `_<modelId>` when `models=` carries multiple ids. */
export type SingleRunsResponse = ForecastResponse;

function buildUrl(models: string[], req: SingleRunsRequest): string {
  const params = new URLSearchParams({
    latitude: String(req.lat),
    longitude: String(req.lon),
    run: `${req.runDate}T00:00`,
    hourly: HOURLY_VARS.join(","),
    daily: [...DAILY_VARS, ...DAILY_SOLAR_VARS].join(","),
    models: models.join(","),
    forecast_days: String(req.forecastDays ?? 7),
    timezone: "auto",
    wind_speed_unit: "kmh",
    temperature_unit: "celsius",
    precipitation_unit: "mm",
  });
  return `${SINGLE_RUNS_URL}?${params}`;
}

async function fetchModels(models: string[], req: SingleRunsRequest, signal?: AbortSignal): Promise<SingleRunsResponse> {
  const res = await fetch(buildUrl(models, req), { signal });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`open-meteo single-runs ${res.status}: ${text || res.statusText}`);
  }
  return (await res.json()) as SingleRunsResponse;
}

// Try the full set; if the chosen date is missing any of its patchy models (a
// 4xx, or a 200 whose body aborts mid-stream into invalid JSON), retry with the
// reliable core. A caller-supplied subset is taken as-is, no fallback.
export async function fetchSingleRuns(req: SingleRunsRequest, signal?: AbortSignal): Promise<SingleRunsResponse> {
  if (req.models) return fetchModels(req.models, req, signal);
  try {
    return await fetchModels(FULL_MODEL_IDS, req, signal);
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    return fetchModels(CORE_MODEL_IDS, req, signal);
  }
}

export { HOURLY_VARS, DAILY_VARS, extractHourlyByModel, extractDailyByModel };
