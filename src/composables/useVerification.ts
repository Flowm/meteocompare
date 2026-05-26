import { computed, ref, shallowRef, watch, type Ref } from "vue";

import { extractDailySolar } from "@/api/omForecast";
import { extractHourly as extractTruthHourly, fetchHistoricalWeather, type HistoricalWeatherResponse } from "@/api/omHistoricalWeather";
import { extractDailyByModel, extractHourlyByModel, fetchSingleRuns, type SingleRunsResponse } from "@/api/omSingleRuns";
import { aggregateSeries } from "@/domain/aggregate";
import { confidenceFor } from "@/domain/confidence";
import { MODEL_IDS, MODELS, type ModelDef } from "@/domain/models";
import { buildDailyVerification, type DailyVerification } from "@/domain/verification";
import { addDaysIso } from "@/utils/date";

import type { DataVarId, HourlySeries } from "./hourlySeries";
import type { Location } from "./useLocation";

/** Conforms to the unified chart contract (HourlySeries) — temperature and
 *  precipitation only, the two variables ERA5-Seamless provides truth for. */
export interface VerificationHourly extends HourlySeries {
  /** Per-hour aggregate per-variable confidence — input to the daily card's
   *  calibration display. Keyed by variable id. */
  confidence: Partial<Record<DataVarId, number[]>>;
}

export interface UseVerificationReturn {
  loading: Ref<boolean>;
  error: Ref<string | null>;
  hourly: Ref<VerificationHourly | null>;
  daily: Ref<DailyVerification[] | null>;
  /** Per-day aggregate WMO weather codes, indexed by dayIndex. Used purely for
   *  the forecast-row icon on each card; never scored against truth (CONTEXT.md
   *  flags this — ERA5-Seamless has no weather_code). */
  weatherCodes: Ref<number[]>;
  /** Subset of MODELS that returned non-null data (temp or precip) for this run date. */
  availableModels: Ref<ModelDef[]>;
  /** Sunrise/sunset (astronomical, location-local) for the chart's day/night
   *  shading. Null until the single-runs response lands. */
  solar: Ref<{ sunrise: string[]; sunset: string[] } | null>;
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
      const truthEndDate = addDaysIso(runDate.value, 7);
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

    // Re-keyed into the unified HourlySeries shape: variable id → series.
    // Adding wind/cloud truth later (see CONTEXT.md "Truth") becomes a
    // data-only change here — no new fields.
    return {
      times,
      aggregate: { temperature_2m: aggregateTemp, precipitation: aggregatePrecip },
      perModel: { temperature_2m: perModelTemp, precipitation: perModelPrecip },
      truth: { temperature_2m: truthTemp, precipitation: truthPrecip },
      confidence: { temperature_2m: confidenceTemp, precipitation: confidencePrecip },
    };
  });

  const daily = computed<DailyVerification[] | null>(() => {
    const h = hourly.value;
    if (!h) return null;
    // buildDailyVerification keeps its flat, tested signature — we just feed it
    // from the re-keyed maps. The verification scoring domain stays frozen.
    return buildDailyVerification({
      runDate: runDate.value,
      times: h.times,
      aggregateTemp: h.aggregate.temperature_2m ?? [],
      aggregatePrecip: h.aggregate.precipitation ?? [],
      confidenceTemp: h.confidence.temperature_2m ?? [],
      confidencePrecip: h.confidence.precipitation ?? [],
      perModelTemp: h.perModel.temperature_2m ?? {},
      perModelPrecip: h.perModel.precipitation ?? {},
      truthTemp: h.truth?.temperature_2m ?? [],
      truthPrecip: h.truth?.precipitation ?? [],
    });
  });

  const solar = computed(() => {
    const runs = runsResp.value;
    if (!runs) return null;
    return extractDailySolar(runs, MODEL_IDS);
  });

  const weatherCodes = computed<number[]>(() => {
    const runs = runsResp.value;
    if (!runs) return [];
    const dailyTimes = runs.daily.time;
    const firstDailyTime = dailyTimes[0];
    if (!firstDailyTime) return [];
    const baseTime = new Date(firstDailyTime);
    // Same severity-weighted-mode aggregation as the forecast view's daily strip,
    // reusing aggregateSeries with the weather_code variable handler.
    const byModel = extractDailyByModel(runs, "weather_code", MODEL_IDS);
    const agg = aggregateSeries(dailyTimes, byModel, {
      variable: "weather_code",
      models: MODELS,
      lat: location.value.latitude,
      lon: location.value.longitude,
      baseTime,
    });
    return agg.map((p) => Math.round(p.value));
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

  return { loading, error, hourly, daily, weatherCodes, availableModels, solar, refresh };
}
