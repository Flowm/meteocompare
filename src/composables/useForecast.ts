import { computed, onScopeDispose, ref, shallowRef, watch, type Ref } from "vue";

import { fetchForecast, extractHourlyByModel, extractDailyByModel, extractDailySolar, type ForecastResponse, type HourlyVar, type DailyVar } from "@/api/omForecast";
import type { AggregatePoint } from "@/domain/aggregate";
import { aggregateVariables } from "@/domain/aggregateVariables";
import { MODELS, MODEL_IDS } from "@/domain/models";
import type { Variable } from "@/domain/weighting";

import type { Location } from "./useLocation";

const HOURLY: HourlyVar[] = ["temperature_2m", "precipitation", "precipitation_probability", "weather_code", "wind_speed_10m", "wind_direction_10m", "cloud_cover"];

const DAILY: DailyVar[] = [
  "weather_code",
  "temperature_2m_max",
  "temperature_2m_min",
  "precipitation_sum",
  "precipitation_probability_max",
  "wind_speed_10m_max",
  "wind_direction_10m_dominant",
];

/** Map a daily variable to its base variable family (drives weighting + confidence). */
function dailyBase(v: DailyVar): Variable {
  switch (v) {
    case "temperature_2m_max":
    case "temperature_2m_min":
      return "temperature_2m";
    case "precipitation_sum":
      return "precipitation";
    case "precipitation_probability_max":
      return "precipitation_probability";
    case "wind_speed_10m_max":
      return "wind_speed_10m";
    case "wind_direction_10m_dominant":
      return "wind_direction_10m";
    case "weather_code":
      return "weather_code";
  }
}

// Structurally assignable to HourlySeries (the unified chart contract):
// `aggregate`/`perModel` are keyed by the same variable ids, just over the
// full forecast variable set. `confidence` is extra (used by daily cards).
export interface HourlyAggregate {
  times: string[];
  aggregate: Record<HourlyVar, AggregatePoint[]>;
  confidence: Record<HourlyVar, number[]>;
  perModel: Record<HourlyVar, Record<string, (number | null)[]>>;
}

export interface DailyAggregate {
  times: string[];
  series: Record<DailyVar, AggregatePoint[]>;
  confidence: Record<DailyVar, number[]>;
  perModel: Record<DailyVar, Record<string, (number | null)[]>>;
}

export interface UseForecastReturn {
  loading: Ref<boolean>;
  error: Ref<string | null>;
  lastUpdated: Ref<Date | null>;
  raw: Ref<ForecastResponse | null>;
  hourly: Ref<HourlyAggregate | null>;
  daily: Ref<DailyAggregate | null>;
  solar: Ref<{ sunrise: string[]; sunset: string[] } | null>;
  refresh: () => Promise<void>;
}

export function useForecast(location: Ref<Location>): UseForecastReturn {
  const loading = ref(false);
  const error = ref<string | null>(null);
  const lastUpdated = ref<Date | null>(null);
  const raw = shallowRef<ForecastResponse | null>(null);

  let inflight: AbortController | null = null;

  async function refresh(): Promise<void> {
    inflight?.abort();
    inflight = new AbortController();
    loading.value = true;
    error.value = null;
    try {
      const data = await fetchForecast({ lat: location.value.latitude, lon: location.value.longitude }, inflight.signal);
      raw.value = data;
      lastUpdated.value = new Date();
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      error.value = e instanceof Error ? e.message : String(e);
      raw.value = null;
    } finally {
      loading.value = false;
    }
  }

  watch(
    () => [location.value.latitude, location.value.longitude] as const,
    () => void refresh(),
    { immediate: true },
  );

  // The forecast SW cache uses StaleWhileRevalidate: the initial fetch resolves with
  // the stale response (or nothing on cold cache), and the SW broadcasts when the
  // background revalidation produces fresher data. Re-run refresh so the UI swaps in.
  if (typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel("open-meteo-forecast-update");
    channel.addEventListener("message", (event: MessageEvent) => {
      const data = event.data as { type?: string; payload?: { updatedURL?: string } } | null;
      if (data?.type !== "CACHE_UPDATED") return;
      const url = data.payload?.updatedURL ?? "";
      const lat = location.value.latitude.toString();
      const lon = location.value.longitude.toString();
      if (url.includes(`latitude=${lat}`) && url.includes(`longitude=${lon}`)) void refresh();
    });
    onScopeDispose(() => channel.close());
  }

  const hourly = computed<HourlyAggregate | null>(() => {
    const data = raw.value;
    if (!data) return null;
    const times = data.hourly.time;
    const firstHourlyTime = times[0];
    if (firstHourlyTime === undefined) return null;
    const baseTime = new Date(firstHourlyTime);
    const perModel = {} as Record<HourlyVar, Record<string, (number | null)[]>>;
    for (const v of HOURLY) perModel[v] = extractHourlyByModel(data, v, MODEL_IDS);
    const { aggregate, confidence } = aggregateVariables({
      times,
      perModel,
      vars: HOURLY.map((v) => ({ key: v, family: v })),
      models: MODELS,
      lat: location.value.latitude,
      lon: location.value.longitude,
      baseTime,
      cadence: "hourly",
    });
    return { times, aggregate, confidence, perModel } as HourlyAggregate;
  });

  const daily = computed<DailyAggregate | null>(() => {
    const data = raw.value;
    if (!data) return null;
    const times = data.daily.time;
    const firstDailyTime = times[0];
    if (firstDailyTime === undefined) return null;
    const baseTime = new Date(firstDailyTime);
    const perModel = {} as Record<DailyVar, Record<string, (number | null)[]>>;
    for (const v of DAILY) perModel[v] = extractDailyByModel(data, v, MODEL_IDS);
    // Daily cadence anchors confidence at lead = dayIndex*24 + 12, and each daily
    // variable is weighted/scored under its base family (e.g. max → temperature_2m).
    const { aggregate: series, confidence } = aggregateVariables({
      times,
      perModel,
      vars: DAILY.map((v) => ({ key: v, family: dailyBase(v) })),
      models: MODELS,
      lat: location.value.latitude,
      lon: location.value.longitude,
      baseTime,
      cadence: "daily",
    });
    return { times, series, confidence, perModel } as DailyAggregate;
  });

  const solar = computed(() => {
    const data = raw.value;
    if (!data) return null;
    return extractDailySolar(data, MODEL_IDS);
  });

  return { loading, error, lastUpdated, raw, hourly, daily, solar, refresh };
}
