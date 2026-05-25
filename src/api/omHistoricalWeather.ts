// Typed client for open-meteo's Historical Weather (archive) API.
// Docs: https://open-meteo.com/en/docs/historical-weather-api
//
// We always request ERA5-Seamless as the truth source — see
// docs/adr/0001-era5-seamless-as-sole-ground-truth.md.

const HISTORICAL_WEATHER_URL = "https://archive-api.open-meteo.com/v1/archive";

const TRUTH_MODEL_ID = "era5_seamless";

const HOURLY_VARS = ["temperature_2m", "precipitation"] as const;

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
  /** Open-meteo returns variables either bare (`temperature_2m`) or suffixed
   *  with the model id (`temperature_2m_era5_seamless`) depending on whether
   *  `models=` is set; the permissive shape covers both. */
  hourly: { time: string[] } & Partial<Record<string, (number | null)[]>>;
  hourly_units: Record<string, string>;
}

export async function fetchHistoricalWeather(req: HistoricalWeatherRequest, signal?: AbortSignal): Promise<HistoricalWeatherResponse> {
  const params = new URLSearchParams({
    latitude: String(req.lat),
    longitude: String(req.lon),
    start_date: req.startDate,
    end_date: req.endDate,
    hourly: HOURLY_VARS.join(","),
    models: TRUTH_MODEL_ID,
    timezone: "auto",
    temperature_unit: "celsius",
    precipitation_unit: "mm",
  });

  const url = `${HISTORICAL_WEATHER_URL}?${params}`;
  const res = await fetch(url, { signal });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`open-meteo historical-weather ${res.status}: ${text || res.statusText}`);
  }
  return (await res.json()) as HistoricalWeatherResponse;
}

/** Pull an hourly truth series for one variable, tolerating both the
 *  bare and suffixed key shapes open-meteo may return. */
export function extractHourly(resp: HistoricalWeatherResponse, variable: HistoricalHourlyVar): (number | null)[] {
  const suffixed = resp.hourly[`${variable}_${TRUTH_MODEL_ID}`];
  if (suffixed) return suffixed;
  const bare = resp.hourly[variable];
  return bare ?? [];
}

export { HOURLY_VARS, TRUTH_MODEL_ID };
