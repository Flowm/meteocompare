// Typed client for open-meteo's Historical Weather (archive) API.
// Docs: https://open-meteo.com/en/docs/historical-weather-api
//
// We always request ERA5-Seamless as the truth source — see
// docs/adr/0001-era5-seamless-as-sole-ground-truth.md.

import { buildOpenMeteoUrl } from "./openMeteo";

const HISTORICAL_WEATHER_URL = "https://archive-api.open-meteo.com/v1/archive";

const TRUTH_MODEL_ID = "era5_seamless";

const HOURLY_VARS = ["temperature_2m", "precipitation"] as const;

// Sunrise/sunset are astronomical (a function of lat/lon/date), so ERA5's values
// are identical to any forecast model's. We source the chart's day/night solar
// here rather than from single-runs, whose `daily=` param the run-cycle timezone
// constraint makes unusable (see omSingleRuns). The archive has no run= constraint.
const DAILY_SOLAR_VARS = ["sunrise", "sunset"] as const;

export type HistoricalHourlyVar = (typeof HOURLY_VARS)[number];

export interface HistoricalWeatherRequest {
  lat: number;
  lon: number;
  /** ISO local date (`YYYY-MM-DD`), inclusive. */
  startDate: string;
  /** ISO local date (`YYYY-MM-DD`), inclusive. */
  endDate: string;
}

export interface HistoricalWeatherResponse {
  latitude: number;
  longitude: number;
  elevation: number;
  utc_offset_seconds: number;
  timezone: string;
  timezone_abbreviation: string;
  /** Open-meteo's archive endpoint returns variables under their bare names
   *  (e.g. `temperature_2m`), not suffixed with the model id, even when
   *  `models=` is set — verified against the live response. */
  hourly: { time: string[] } & Partial<Record<HistoricalHourlyVar, (number | null)[]>>;
  hourly_units: Record<string, string>;
  /** Present when `daily=` is requested. The archive returns solar under bare
   *  names (no model-id suffix), like its hourly variables. */
  daily?: { time: string[] } & Partial<Record<string, string[]>>;
}

export async function fetchHistoricalWeather(req: HistoricalWeatherRequest, signal?: AbortSignal): Promise<HistoricalWeatherResponse> {
  const params = new URLSearchParams({
    latitude: String(req.lat),
    longitude: String(req.lon),
    start_date: req.startDate,
    end_date: req.endDate,
    hourly: HOURLY_VARS.join(","),
    daily: DAILY_SOLAR_VARS.join(","),
    models: TRUTH_MODEL_ID,
    timezone: "auto",
    temperature_unit: "celsius",
    precipitation_unit: "mm",
  });

  const url = buildOpenMeteoUrl(HISTORICAL_WEATHER_URL, params);
  const res = await fetch(url, { signal });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`open-meteo historical-weather ${res.status}: ${text || res.statusText}`);
  }
  return (await res.json()) as HistoricalWeatherResponse;
}

/** Pull an hourly truth series for one variable. */
export function extractHourly(resp: HistoricalWeatherResponse, variable: HistoricalHourlyVar): (number | null)[] {
  return resp.hourly[variable] ?? [];
}

/** Sunrise/sunset for the chart's day/night shading, from the archive's daily
 *  block. Astronomical, so model-independent (see DAILY_SOLAR_VARS). Null when
 *  the daily block is absent (older responses / an unrequested field). */
export function extractSolar(resp: HistoricalWeatherResponse): { sunrise: string[]; sunset: string[] } | null {
  const daily = resp.daily;
  if (!daily) return null;
  // Archive uses bare names; fall back to the suffixed form defensively.
  const sunrise = daily.sunrise ?? daily[`sunrise_${TRUTH_MODEL_ID}`];
  const sunset = daily.sunset ?? daily[`sunset_${TRUTH_MODEL_ID}`];
  return sunrise && sunset ? { sunrise, sunset } : null;
}

export { HOURLY_VARS, TRUTH_MODEL_ID };
