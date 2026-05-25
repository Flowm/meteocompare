import { computed, ref, shallowRef, watch, type Ref } from "vue";

import { extractHourly as extractTruthHourly, fetchHistoricalWeather, type HistoricalWeatherResponse } from "@/api/omHistoricalWeather";
import { extractHourlyByModel, fetchSingleRuns, type SingleRunsResponse } from "@/api/omSingleRuns";
import { aggregateSeries, type AggregatePoint } from "@/domain/aggregate";
import { confidenceFor } from "@/domain/confidence";
import { MODEL_IDS, MODELS, type ModelDef } from "@/domain/models";
import { buildDailyVerification, type DailyVerification } from "@/domain/verification";

import type { Location } from "./useLocation";

export interface VerificationHourly {
  /** Hourly time axis from the single-runs response (location-local, TZ-shifted). */
  times: string[];
  aggregateTemp: AggregatePoint[];
  aggregatePrecip: AggregatePoint[];
  /** ERA5-Seamless hourly truth, aligned to `times` (null where alignment fails). */
  truthTemp: (number | null)[];
  truthPrecip: (number | null)[];
  perModelTemp: Record<string, (number | null)[]>;
  perModelPrecip: Record<string, (number | null)[]>;
  /** Per-hour aggregate per-variable confidence — input to the daily card's calibration display. */
  confidenceTemp: number[];
  confidencePrecip: number[];
}

export interface UseVerificationReturn {
  loading: Ref<boolean>;
  error: Ref<string | null>;
  hourly: Ref<VerificationHourly | null>;
  daily: Ref<DailyVerification[] | null>;
  /** Subset of MODELS that returned non-null temperature data for this run date. */
  availableModels: Ref<ModelDef[]>;
  refresh: () => Promise<void>;
}

export function useVerification(location: Ref<Location>, runDate: Ref<string>): UseVerificationReturn {
  const loading = ref(false);
  const error = ref<string | null>(null);
  const runsResp = shallowRef<SingleRunsResponse | null>(null);
  const truthResp = shallowRef<HistoricalWeatherResponse | null>(null);

  let inflight: AbortController | null = null;

  async function refresh(): Promise<void> {
    inflight?.abort();
    inflight = new AbortController();
    const signal = inflight.signal;
    loading.value = true;
    error.value = null;
    try {
      // Fetch truth with a 1-day-wider window than the forecast's 7 days so the
      // TZ-shifted forecast window is fully covered regardless of UTC offset.
      const truthEndDate = addDays(runDate.value, 7);
      const [runs, truth] = await Promise.all([
        fetchSingleRuns({ lat: location.value.latitude, lon: location.value.longitude, runDate: runDate.value }, signal),
        fetchHistoricalWeather({ lat: location.value.latitude, lon: location.value.longitude, startDate: runDate.value, endDate: truthEndDate }, signal),
      ]);
      runsResp.value = runs;
      truthResp.value = truth;
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      error.value = e instanceof Error ? e.message : String(e);
      runsResp.value = null;
      truthResp.value = null;
    } finally {
      loading.value = false;
    }
  }

  watch(
    () => [location.value.latitude, location.value.longitude, runDate.value] as const,
    () => void refresh(),
    { immediate: true },
  );

  const hourly = computed<VerificationHourly | null>(() => {
    const runs = runsResp.value;
    const truth = truthResp.value;
    if (!runs || !truth) return null;
    const times = runs.hourly.time;
    const firstTime = times[0];
    if (!firstTime) return null;
    const baseTime = new Date(firstTime);

    // Per-model series straight off the single-runs response.
    const perModelTemp = extractHourlyByModel(runs, "temperature_2m", MODEL_IDS);
    const perModelPrecip = extractHourlyByModel(runs, "precipitation", MODEL_IDS);

    // Aggregate via the existing weighted-mean pipeline. Lead-time decay kicks
    // in correctly because baseTime is the run start.
    const aggregateTemp = aggregateSeries(times, perModelTemp, {
      variable: "temperature_2m",
      models: MODELS,
      lat: location.value.latitude,
      lon: location.value.longitude,
      baseTime,
    });
    const aggregatePrecip = aggregateSeries(times, perModelPrecip, {
      variable: "precipitation",
      models: MODELS,
      lat: location.value.latitude,
      lon: location.value.longitude,
      baseTime,
    });

    // Hourly per-variable aggregate confidence — drives the daily card's
    // confidence-vs-error calibration display.
    const confidenceTemp = aggregateTemp.map((p, i) => confidenceFor(p, "temperature_2m", i));
    const confidencePrecip = aggregatePrecip.map((p, i) => confidenceFor(p, "precipitation", i));

    // Align truth to the run's time axis by ISO-string lookup. The two APIs
    // can return their hours offset by UTC-shift; the map handles it cleanly.
    const truthTimes = truth.hourly.time;
    const truthTempArr = extractTruthHourly(truth, "temperature_2m");
    const truthPrecipArr = extractTruthHourly(truth, "precipitation");
    const truthIndex = new Map<string, number>();
    truthTimes.forEach((t, i) => truthIndex.set(t, i));

    const truthTemp: (number | null)[] = times.map((t) => {
      const i = truthIndex.get(t);
      return i == null ? null : (truthTempArr[i] ?? null);
    });
    const truthPrecip: (number | null)[] = times.map((t) => {
      const i = truthIndex.get(t);
      return i == null ? null : (truthPrecipArr[i] ?? null);
    });

    return { times, aggregateTemp, aggregatePrecip, truthTemp, truthPrecip, perModelTemp, perModelPrecip, confidenceTemp, confidencePrecip };
  });

  const daily = computed<DailyVerification[] | null>(() => {
    const h = hourly.value;
    if (!h) return null;
    return buildDailyVerification({
      runDate: runDate.value,
      times: h.times,
      aggregateTemp: h.aggregateTemp,
      aggregatePrecip: h.aggregatePrecip,
      confidenceTemp: h.confidenceTemp,
      confidencePrecip: h.confidencePrecip,
      perModelTemp: h.perModelTemp,
      perModelPrecip: h.perModelPrecip,
      truthTemp: h.truthTemp,
      truthPrecip: h.truthPrecip,
    });
  });

  const availableModels = computed<ModelDef[]>(() => {
    const runs = runsResp.value;
    if (!runs) return [];
    const ids = new Set<string>();
    for (const id of MODEL_IDS) {
      // Honest availability: include any model that returned a non-null value
      // for at least one variable (temperature OR precipitation). The earlier
      // temp-only check undercounted models that had precip-only data.
      const tempArr = runs.hourly[`temperature_2m_${id}`];
      const precipArr = runs.hourly[`precipitation_${id}`];
      const hasTemp = tempArr && tempArr.some((x) => x != null);
      const hasPrecip = precipArr && precipArr.some((x) => x != null);
      if (hasTemp || hasPrecip) ids.add(id);
    }
    return MODELS.filter((m) => ids.has(m.id));
  });

  return { loading, error, hourly, daily, availableModels, refresh };
}

/** Add `days` to an ISO `YYYY-MM-DD` date using UTC arithmetic so the result
 *  is independent of the browser's timezone. */
function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
