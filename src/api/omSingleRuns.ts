// Typed client for open-meteo's Single Runs API.
// Docs: https://open-meteo.com/en/docs/single-runs-api
//
// This API serves *historical* forecast runs — the actual data each model
// produced at a given run cycle. Distinct from /v1/forecast (live current
// runs) and /v1/archive (reanalysis truth). The response shape is the same
// as the forecast API, so we reuse ForecastResponse and the extract helpers.

import { MODEL_IDS } from "@/domain/models";

import type { ForecastResponse } from "./omForecast";
import { extractDailyByModel, extractHourlyByModel } from "./omForecast";

const SINGLE_RUNS_URL = "https://single-runs-api.open-meteo.com/v1/forecast";

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

export async function fetchSingleRuns(req: SingleRunsRequest, signal?: AbortSignal): Promise<SingleRunsResponse> {
  const params = new URLSearchParams({
    latitude: String(req.lat),
    longitude: String(req.lon),
    run: `${req.runDate}T00:00`,
    hourly: HOURLY_VARS.join(","),
    daily: [...DAILY_VARS, ...DAILY_SOLAR_VARS].join(","),
    models: (req.models ?? MODEL_IDS).join(","),
    forecast_days: String(req.forecastDays ?? 7),
    timezone: "auto",
    wind_speed_unit: "kmh",
    temperature_unit: "celsius",
    precipitation_unit: "mm",
  });

  const url = `${SINGLE_RUNS_URL}?${params}`;
  const res = await fetch(url, { signal });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`open-meteo single-runs ${res.status}: ${text || res.statusText}`);
  }
  return (await res.json()) as SingleRunsResponse;
}

export { HOURLY_VARS, DAILY_VARS, extractHourlyByModel, extractDailyByModel };
