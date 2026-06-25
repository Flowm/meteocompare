// Framework-free evaluation of a single forecast run against truth — the
// decoupled "analysis unit" (docs/plans/frontend-model-training.md, Phase 1).
// Given an already-fetched single-runs response and its ERA5-Seamless truth,
// it produces the aggregate + predictability hourly view-model, the per-day
// verification, the per-model scorecard, the daily weather-code icons, and the
// available-model set — with no Vue. useVerification is now a thin reactive
// wrapper over this, and the multi-run sampler (later phases) calls it per run.

import { extractHourly as extractTruthHourly, type HistoricalWeatherResponse } from "@/api/omHistoricalWeather";
import { extractDailyByModel, extractHourlyByModel, type SingleRunsResponse } from "@/api/omSingleRuns";
import type { DataVarId, HourlySeries } from "@/composables/hourlySeries";
import { aggregateVariables } from "@/domain/aggregateVariables";
import { MODEL_IDS, MODELS, type ModelDef } from "@/domain/models";
import { buildModelScorecard, type ScorecardRow } from "@/domain/scorecard";
import { buildDailyVerification, type DailyVerification } from "@/domain/verification";

/** Conforms to the unified chart contract (HourlySeries) — temperature and
 *  precipitation only, the two variables we currently verify. ERA5-Seamless
 *  also provides wind and cloud-cover truth; scoring them is a later,
 *  data-only change (see CONTEXT.md "Truth"). */
export interface VerificationHourly extends HourlySeries {
  /** Per-hour aggregate per-variable predictability — input to the daily card's
   *  predictability-vs-error display. Keyed by variable id. */
  predictability: Partial<Record<DataVarId, number[]>>;
}

/** Everything one (location, run) yields once scored — self-identifying via
 *  `runDate` so a multi-run sample is just `RunEvaluation[]`. */
export interface RunEvaluation {
  runDate: string;
  /** Run cycle hour (00 / 06 / 12 / 18 Z). With runDate, the run's identity. */
  runHour: number;
  hourly: VerificationHourly;
  daily: DailyVerification[];
  scorecard: ScorecardRow[];
  weatherCodes: number[];
  availableModels: ModelDef[];
}

export interface EvaluateRunInputs {
  runs: SingleRunsResponse;
  truth: HistoricalWeatherResponse;
  lat: number;
  lon: number;
  /** ISO local date of the run. */
  runDate: string;
  /** Run cycle hour (00 / 06 / 12 / 18 Z); defaults to 0. Identifies the run with runDate. */
  runHour?: number;
  /** When the location has stored tuned weights, also compute an "Aggregate
   *  (tuned)" scorecard row from these per-model multipliers, for comparison. */
  tunedMultipliers?: Record<string, number>;
}

/** Score one fetched run against its truth. Returns null when the run carried no
 *  hours (nothing to align or score). */
export function evaluateRun({ runs, truth, lat, lon, runDate, runHour = 0, tunedMultipliers }: EvaluateRunInputs): RunEvaluation | null {
  const times = runs.hourly.time;
  const firstTime = times[0];
  if (!firstTime) return null;
  const baseTime = new Date(firstTime);

  // Per-model series straight off the single-runs response. Aggregate +
  // predictability via the shared pipeline; lead-time decay keys off baseTime.
  const perModel = {
    temperature_2m: extractHourlyByModel(runs, "temperature_2m", MODEL_IDS),
    precipitation: extractHourlyByModel(runs, "precipitation", MODEL_IDS),
  };
  const { aggregate, predictability } = aggregateVariables({
    times,
    perModel,
    vars: [
      { key: "temperature_2m", family: "temperature_2m" },
      { key: "precipitation", family: "precipitation" },
    ],
    models: MODELS,
    lat,
    lon,
    baseTime,
    cadence: "hourly",
  });

  // Align truth to the run's time axis by ISO-string lookup; the two APIs can
  // return their hours offset by UTC-shift, which the map handles cleanly.
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

  const hourly: VerificationHourly = {
    times,
    aggregate,
    perModel,
    truth: { temperature_2m: truthTemp, precipitation: truthPrecip },
    predictability,
  };

  const daily = buildDailyVerification({
    runDate,
    times,
    aggregateTemp: aggregate.temperature_2m ?? [],
    aggregatePrecip: aggregate.precipitation ?? [],
    predictabilityTemp: predictability.temperature_2m ?? [],
    predictabilityPrecip: predictability.precipitation ?? [],
    perModelTemp: perModel.temperature_2m ?? {},
    perModelPrecip: perModel.precipitation ?? {},
    truthTemp,
    truthPrecip,
  });

  // A second aggregate under the location's tuned weights, scored inline for
  // a default-vs-tuned comparison (only when tuned weights are supplied).
  const tunedAgg = tunedMultipliers
    ? aggregateVariables({
        times,
        perModel,
        vars: [
          { key: "temperature_2m", family: "temperature_2m" },
          { key: "precipitation", family: "precipitation" },
        ],
        models: MODELS,
        lat,
        lon,
        baseTime,
        cadence: "hourly",
        multipliers: tunedMultipliers,
      }).aggregate
    : null;

  const scorecard = buildModelScorecard({
    times,
    aggregateTemp: aggregate.temperature_2m ?? [],
    aggregatePrecip: aggregate.precipitation ?? [],
    tunedAggregateTemp: tunedAgg?.temperature_2m,
    tunedAggregatePrecip: tunedAgg?.precipitation,
    perModelTemp: perModel.temperature_2m ?? {},
    perModelPrecip: perModel.precipitation ?? {},
    truthTemp,
    truthPrecip,
  });

  return {
    runDate,
    runHour,
    hourly,
    daily,
    scorecard,
    weatherCodes: aggregateWeatherCodes(runs, lat, lon),
    availableModels: availableModelsOf(runs),
  };
}

/** Per-day aggregate WMO weather codes for the forecast-row icon. Same
 *  severity-weighted-mode aggregation as the forecast view; predictability is
 *  agreement-based (lead-independent) and dropped here. */
function aggregateWeatherCodes(runs: SingleRunsResponse, lat: number, lon: number): number[] {
  const dailyTimes = runs.daily.time;
  const firstDailyTime = dailyTimes[0];
  if (!firstDailyTime) return [];
  const baseTime = new Date(firstDailyTime);
  const { aggregate } = aggregateVariables({
    times: dailyTimes,
    perModel: { weather_code: extractDailyByModel(runs, "weather_code", MODEL_IDS) },
    vars: [{ key: "weather_code", family: "weather_code" }],
    models: MODELS,
    lat,
    lon,
    baseTime,
    cadence: "daily",
  });
  return (aggregate.weather_code ?? []).map((p) => Math.round(p.value));
}

/** Models that returned a non-null value (temperature OR precipitation) for this run. */
function availableModelsOf(runs: SingleRunsResponse): ModelDef[] {
  const ids = new Set<string>();
  for (const id of MODEL_IDS) {
    const tempArr = runs.hourly[`temperature_2m_${id}`];
    const precipArr = runs.hourly[`precipitation_${id}`];
    const hasTemp = tempArr && tempArr.some((x) => x != null);
    const hasPrecip = precipArr && precipArr.some((x) => x != null);
    if (hasTemp || hasPrecip) ids.add(id);
  }
  return MODELS.filter((m) => ids.has(m.id));
}
