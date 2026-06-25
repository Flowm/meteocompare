import { computed, onScopeDispose, ref, type Ref } from "vue";

import { loadWeights } from "@/analysis/learnedWeightsStore";
import { fetchForecast, extractHourlyByModel, extractDailyByModel, solarFrom, type ForecastResponse, type HourlyVar, type DailyVar } from "@/api/omForecast";
import type { AggregatePoint } from "@/domain/aggregate";
import { aggregateVariables } from "@/domain/aggregateVariables";
import { MODELS, MODEL_IDS } from "@/domain/models";
import { overallPredictability } from "@/domain/predictability";
import type { Variable } from "@/domain/weighting";

import { useAbortableResource } from "./useAbortableResource";
import { useApiKey } from "./useApiKey";
import type { Location } from "./useLocation";
import { useSettings } from "./useSettings";

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

/** Map a daily variable to its base variable family (drives weighting + predictability). */
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
// full forecast variable set. `predictability` is extra (used by daily cards).
export interface HourlyAggregate {
  times: string[];
  aggregate: Record<HourlyVar, AggregatePoint[]>;
  predictability: Record<HourlyVar, number[]>;
  perModel: Record<HourlyVar, Record<string, (number | null)[]>>;
}

export interface DailyAggregate {
  times: string[];
  series: Record<DailyVar, AggregatePoint[]>;
  predictability: Record<DailyVar, number[]>;
  perModel: Record<DailyVar, Record<string, (number | null)[]>>;
}

/** The forecast view's per-day "overall predictability" collapse: the unweighted
 *  mean of the day's temperature, precipitation, and weather-code predictabilities.
 *  The single definition of *which* variables compose it — CONTEXT.md flags this
 *  collapse as "overall predictability (under review)", so it lives in one place
 *  rather than inlined in each card. */
export function dailyOverallPredictability(daily: DailyAggregate, i: number): number {
  return overallPredictability([daily.predictability.temperature_2m_max[i], daily.predictability.precipitation_sum[i], daily.predictability.weather_code[i]]);
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
  const lastUpdated = ref<Date | null>(null);
  // Switching the commercial API key on/off changes which host every request
  // hits, so it's a fetch dependency — flipping it refetches the current view.
  const { apiKey } = useApiKey();

  // When the user opts in, apply this location's trained weight multipliers to
  // the live aggregate (training page / ADR 0007). Off → undefined → the
  // heuristic weighting, byte-for-byte unchanged.
  const { useTrainedWeights } = useSettings();
  const multipliers = computed(() => (useTrainedWeights.value ? loadWeights(location.value.latitude, location.value.longitude)?.multipliers : undefined));

  // Re-fetches on location change; the superseded-request guard lives in the
  // helper. `lastUpdated` is stamped here, inside the fetcher, so it only moves
  // on a non-aborted success.
  const {
    data: raw,
    loading,
    error,
    refresh,
  } = useAbortableResource<ForecastResponse>(
    async (signal) => {
      const data = await fetchForecast({ lat: location.value.latitude, lon: location.value.longitude }, signal);
      lastUpdated.value = new Date();
      return data;
    },
    () => [location.value.latitude, location.value.longitude, apiKey.value],
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
    const { aggregate, predictability } = aggregateVariables({
      times,
      perModel,
      vars: HOURLY.map((v) => ({ key: v, family: v })),
      models: MODELS,
      lat: location.value.latitude,
      lon: location.value.longitude,
      baseTime,
      cadence: "hourly",
      multipliers: multipliers.value,
    });
    return { times, aggregate, predictability, perModel };
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
    // Daily cadence anchors predictability at lead = dayIndex*24 + 12, and each daily
    // variable is weighted/scored under its base family (e.g. max → temperature_2m).
    const { aggregate: series, predictability } = aggregateVariables({
      times,
      perModel,
      vars: DAILY.map((v) => ({ key: v, family: dailyBase(v) })),
      models: MODELS,
      lat: location.value.latitude,
      lon: location.value.longitude,
      baseTime,
      cadence: "daily",
      multipliers: multipliers.value,
    });
    return { times, series, predictability, perModel };
  });

  const solar = computed(() => solarFrom(raw.value));

  return { loading, error, lastUpdated, raw, hourly, daily, solar, refresh };
}
