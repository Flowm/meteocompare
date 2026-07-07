// Framework-free evaluation of a live forecast response — the forecast-path
// sibling of runEvaluation.ts. Given an already-fetched forecast, it produces
// the hourly + daily aggregate surfaces (with per-variable predictability), the
// solar series, and the small current-conditions view-model — with no Vue.
// useForecast is a thin reactive wrapper over this, and the raw open-meteo
// ForecastResponse never crosses into a component.

import { DAILY_VARS, extractDailyByModel, extractHourlyByModel, HOURLY_VARS, solarFrom, type DailyVar, type ForecastResponse, type HourlyVar } from "@/api/omForecast";
import type { AggregatePoint } from "@/domain/aggregate";
import { aggregateVariables } from "@/domain/aggregateVariables";
import { MODEL_IDS, MODELS } from "@/domain/models";
import { overallPredictability } from "@/domain/predictability";
import { dailyBaseVariable } from "@/domain/variables";

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
  aggregate: Record<DailyVar, AggregatePoint[]>;
  predictability: Record<DailyVar, number[]>;
  perModel: Record<DailyVar, Record<string, (number | null)[]>>;
}

/** The slice of the wire response's `current` block the UI actually renders —
 *  the banner's live reading plus the "data from when" stamp. */
export interface CurrentConditions {
  /** Reference moment the model output is valid for (ISO local time). */
  time: string;
  temperature_2m: number | null;
  weather_code: number | null;
  isDay: boolean;
}

/** Everything one fetched forecast yields once aggregated. */
export interface ForecastEvaluation {
  hourly: HourlyAggregate;
  daily: DailyAggregate;
  solar: { sunrise: string[]; sunset: string[] } | null;
  current: CurrentConditions;
}

export interface EvaluateForecastInputs {
  raw: ForecastResponse;
  lat: number;
  lon: number;
  /** Trained-weight multipliers for this location (ADR 0007). Absent → the
   *  heuristic weighting, byte-for-byte unchanged. */
  multipliers?: Record<string, number>;
}

/** Aggregate one fetched forecast. Returns null when either time axis is empty
 *  (nothing to aggregate — the view gates on both surfaces anyway). */
export function evaluateForecast({ raw, lat, lon, multipliers }: EvaluateForecastInputs): ForecastEvaluation | null {
  const hourlyTimes = raw.hourly.time;
  const dailyTimes = raw.daily.time;
  const firstHourlyTime = hourlyTimes[0];
  const firstDailyTime = dailyTimes[0];
  if (firstHourlyTime === undefined || firstDailyTime === undefined) return null;

  const hourlyPerModel = {} as Record<HourlyVar, Record<string, (number | null)[]>>;
  for (const v of HOURLY_VARS) hourlyPerModel[v] = extractHourlyByModel(raw, v, MODEL_IDS);
  const hourlyAgg = aggregateVariables({
    times: hourlyTimes,
    perModel: hourlyPerModel,
    vars: HOURLY_VARS.map((v) => ({ key: v, family: v })),
    models: MODELS,
    lat,
    lon,
    baseTime: new Date(firstHourlyTime),
    cadence: "hourly",
    multipliers,
  });

  // Daily cadence anchors predictability at lead = dayIndex*24 + 12, and each daily
  // variable is weighted/scored under its base family (e.g. max → temperature_2m).
  const dailyPerModel = {} as Record<DailyVar, Record<string, (number | null)[]>>;
  for (const v of DAILY_VARS) dailyPerModel[v] = extractDailyByModel(raw, v, MODEL_IDS);
  const dailyAgg = aggregateVariables({
    times: dailyTimes,
    perModel: dailyPerModel,
    vars: DAILY_VARS.map((v) => ({ key: v, family: dailyBaseVariable(v) })),
    models: MODELS,
    lat,
    lon,
    baseTime: new Date(firstDailyTime),
    cadence: "daily",
    multipliers,
  });

  return {
    hourly: { times: hourlyTimes, aggregate: hourlyAgg.aggregate, predictability: hourlyAgg.predictability, perModel: hourlyPerModel },
    daily: { times: dailyTimes, aggregate: dailyAgg.aggregate, predictability: dailyAgg.predictability, perModel: dailyPerModel },
    solar: solarFrom(raw),
    current: {
      time: raw.current.time,
      temperature_2m: raw.current.temperature_2m ?? null,
      weather_code: raw.current.weather_code ?? null,
      isDay: (raw.current.is_day ?? 1) === 1,
    },
  };
}

/** The forecast view's per-day "overall predictability" collapse: the unweighted
 *  mean of the day's temperature, precipitation, and weather-code predictabilities.
 *  The single definition of *which* variables compose it — CONTEXT.md flags this
 *  collapse as "overall predictability (under review)", so it lives in one place
 *  rather than inlined in each card. */
export function dailyOverallPredictability(daily: DailyAggregate, i: number): number {
  return overallPredictability([daily.predictability.temperature_2m_max[i], daily.predictability.precipitation_sum[i], daily.predictability.weather_code[i]]);
}
