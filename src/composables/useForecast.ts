import { computed, onScopeDispose, ref, type Ref } from "vue";

import { resolveCalibration } from "@/analysis/calibrationStore";
import { evaluateForecast, type CurrentConditions, type DailyAggregate, type ForecastEvaluation, type HourlyAggregate } from "@/analysis/forecastEvaluation";
import { loadWeights } from "@/analysis/learnedWeightsStore";
import { fetchForecast, type ForecastResponse } from "@/api/omForecast";
import { FORECAST_UPDATE_CHANNEL, type ForecastCacheUpdatedMessage } from "@/swMessages";

import { useAbortableResource } from "./useAbortableResource";
import { useApiKey } from "./useApiKey";
import type { Location } from "./useLocation";
import { useSettings } from "./useSettings";

export interface UseForecastReturn {
  loading: Ref<boolean>;
  error: Ref<string | null>;
  lastUpdated: Ref<Date | null>;
  current: Ref<CurrentConditions | null>;
  hourly: Ref<HourlyAggregate | null>;
  daily: Ref<DailyAggregate | null>;
  solar: Ref<{ sunrise: string[]; sunset: string[] } | null>;
  refresh: () => Promise<void>;
}

/** Thin reactive wrapper over the framework-free forecast evaluation
 *  (`@/analysis/forecastEvaluation`) — it owns fetch, abort/supersede,
 *  the trained-weights toggle, and the SW cache-refresh channel; all
 *  extraction + aggregation lives in `evaluateForecast`. */
export function useForecast(location: Ref<Location>): UseForecastReturn {
  const lastUpdated = ref<Date | null>(null);
  // Switching the commercial API key on/off changes which host every request
  // hits, so it's a fetch dependency — flipping it refetches the current view.
  const { apiKey } = useApiKey();

  // When the user opts in, apply this location's trained weight multipliers to
  // the live aggregate (training page / ADR 0007). Off → undefined → the shipped
  // default weights alone, byte-for-byte unchanged.
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
    const channel = new BroadcastChannel(FORECAST_UPDATE_CHANNEL);
    channel.addEventListener("message", (event: MessageEvent) => {
      const data = event.data as ForecastCacheUpdatedMessage | null;
      if (data?.type !== "CACHE_UPDATED") return;
      const url = data.payload?.updatedURL ?? "";
      const lat = location.value.latitude.toString();
      const lon = location.value.longitude.toString();
      if (url.includes(`latitude=${lat}`) && url.includes(`longitude=${lon}`)) void refresh();
    });
    onScopeDispose(() => channel.close());
  }

  // The calibration ladder resolves per location (ADR 0008) and is always on —
  // no curve resolves to the raw heuristic, so there is nothing to toggle.
  const calibration = computed(() => resolveCalibration(location.value.latitude, location.value.longitude));

  const evaluation = computed<ForecastEvaluation | null>(() => {
    const data = raw.value;
    if (!data) return null;
    return evaluateForecast({ raw: data, lat: location.value.latitude, lon: location.value.longitude, multipliers: multipliers.value, calibration: calibration.value });
  });

  const current = computed(() => evaluation.value?.current ?? null);
  const hourly = computed(() => evaluation.value?.hourly ?? null);
  const daily = computed(() => evaluation.value?.daily ?? null);
  const solar = computed(() => evaluation.value?.solar ?? null);

  return { loading, error, lastUpdated, current, hourly, daily, solar, refresh };
}
