// Typed client for the open-meteo forecast API.
// Docs: https://open-meteo.com/en/docs

import { MODEL_IDS } from '@/domain/models'

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast'
const CACHE_TTL_MS = 30 * 60 * 1000

const HOURLY_VARS = [
  'temperature_2m',
  'precipitation',
  'precipitation_probability',
  'weather_code',
] as const

const DAILY_VARS = [
  'weather_code',
  'temperature_2m_max',
  'temperature_2m_min',
  'precipitation_sum',
  'precipitation_probability_max',
] as const

const CURRENT_VARS = ['temperature_2m', 'precipitation', 'weather_code'] as const

export type HourlyVar = (typeof HOURLY_VARS)[number]
export type DailyVar = (typeof DAILY_VARS)[number]
export type CurrentVar = (typeof CURRENT_VARS)[number]

export interface ForecastRequest {
  lat: number
  lon: number
  /** Optional subset of model ids; defaults to the full registry. */
  models?: string[]
  forecastDays?: number
}

export interface ForecastResponse {
  latitude: number
  longitude: number
  elevation: number
  generationtime_ms: number
  utc_offset_seconds: number
  timezone: string
  timezone_abbreviation: string
  hourly: { time: string[] } & Partial<Record<string, (number | null)[]>>
  hourly_units: Record<string, string>
  daily: { time: string[] } & Partial<Record<string, (number | null)[]>>
  daily_units: Record<string, string>
  current: { time: string } & Partial<Record<string, number | null>>
  current_units: Record<string, string>
}

interface CacheEntry {
  data: ForecastResponse
  expiresAt: number
}

const cache = new Map<string, CacheEntry>()

function cacheKey(req: Required<ForecastRequest>): string {
  return `${req.lat.toFixed(3)},${req.lon.toFixed(3)}|${req.models.join(',')}|${req.forecastDays}`
}

export async function fetchForecast(req: ForecastRequest, signal?: AbortSignal): Promise<ForecastResponse> {
  const full: Required<ForecastRequest> = {
    lat: req.lat,
    lon: req.lon,
    models: req.models ?? MODEL_IDS,
    forecastDays: req.forecastDays ?? 10,
  }
  const key = cacheKey(full)
  const now = Date.now()
  const hit = cache.get(key)
  if (hit && hit.expiresAt > now) return hit.data

  const params = new URLSearchParams({
    latitude: String(full.lat),
    longitude: String(full.lon),
    hourly: HOURLY_VARS.join(','),
    daily: DAILY_VARS.join(','),
    current: CURRENT_VARS.join(','),
    models: full.models.join(','),
    forecast_days: String(full.forecastDays),
    timezone: 'auto',
    wind_speed_unit: 'kmh',
    temperature_unit: 'celsius',
    precipitation_unit: 'mm',
  })

  const url = `${FORECAST_URL}?${params}`
  const res = await fetch(url, { signal })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`open-meteo forecast ${res.status}: ${text || res.statusText}`)
  }
  const data = (await res.json()) as ForecastResponse
  cache.set(key, { data, expiresAt: now + CACHE_TTL_MS })
  return data
}

/** Pull a per-model hourly series for one base variable.
 *  open-meteo suffixes each variable with the model id (e.g. temperature_2m_ecmwf_ifs025). */
export function extractHourlyByModel(
  resp: ForecastResponse,
  variable: HourlyVar,
  modelIds: string[],
): Record<string, (number | null)[]> {
  const out: Record<string, (number | null)[]> = {}
  for (const id of modelIds) {
    const key = `${variable}_${id}`
    const arr = resp.hourly[key]
    if (arr) out[id] = arr
  }
  return out
}

export function extractDailyByModel(
  resp: ForecastResponse,
  variable: DailyVar,
  modelIds: string[],
): Record<string, (number | null)[]> {
  const out: Record<string, (number | null)[]> = {}
  for (const id of modelIds) {
    const key = `${variable}_${id}`
    const arr = resp.daily[key]
    if (arr) out[id] = arr
  }
  return out
}

export { HOURLY_VARS, DAILY_VARS, CURRENT_VARS }
