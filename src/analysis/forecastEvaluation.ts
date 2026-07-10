// Framework-free evaluation of a live forecast response — the forecast-path
// sibling of runEvaluation.ts. Given an already-fetched forecast, it produces
// the hourly + daily aggregate surfaces (with per-variable predictability), the
// solar series, and the small current-conditions view-model — with no Vue.
// useForecast is a thin reactive wrapper over this, and the raw open-meteo
// ForecastResponse never crosses into a component.

import { DAILY_VARS, extractDailyByModel, extractHourlyByModel, HOURLY_VARS, solarFrom, type DailyVar, type ForecastResponse, type HourlyVar } from "@/api/omForecast";
import type { AggregatePoint } from "@/domain/aggregate";
import { aggregateVariables } from "@/domain/aggregateVariables";
import { applyCalibration, isCalibrated, type CalibrationSet } from "@/domain/calibration";
import { MODEL_IDS, MODELS } from "@/domain/models";
import { dailyBaseVariable } from "@/domain/variables";
import type { VerifiedVariable } from "@/domain/verification";

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
  /** The day cards' predictability view-model, one entry per `times` day. */
  dayPredictability: DayPredictability[];
}

/** One forecast day's predictability collapse (ADR 0009): the two verified
 *  variables — calibrated where a curve exists (ADR 0008) — and their min. */
export interface DayPredictability {
  /** Min of the finite per-variable values; 0 when neither is finite. */
  overall: number;
  /** Per-variable values; null when the day has no finite hourly raw score. */
  temperature: number | null;
  precipitation: number | null;
  temperatureCalibrated: boolean;
  precipitationCalibrated: boolean;
  /** Whether `overall` sits on the calibrated tier scale: at least one finite
   *  part, and every finite part came through a curve — a mixed day stays on
   *  the raw scale, because the min may be the uncalibrated part. */
  calibrated: boolean;
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
  /** Resolved calibration curves for this location (ADR 0008). Absent/null →
   *  the day cards publish the raw heuristic (identity fallback). */
  calibration?: CalibrationSet | null;
}

/** Aggregate one fetched forecast. Returns null when either time axis is empty
 *  (nothing to aggregate — the view gates on both surfaces anyway). */
export function evaluateForecast({ raw, lat, lon, multipliers, calibration }: EvaluateForecastInputs): ForecastEvaluation | null {
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

  const hourly: HourlyAggregate = { times: hourlyTimes, aggregate: hourlyAgg.aggregate, predictability: hourlyAgg.predictability, perModel: hourlyPerModel };

  return {
    hourly,
    daily: {
      times: dailyTimes,
      aggregate: dailyAgg.aggregate,
      predictability: dailyAgg.predictability,
      perModel: dailyPerModel,
      dayPredictability: dailyTimes.map((date, i) => dayPredictabilityFor(hourly, date, i, calibration ?? null)),
    },
    solar: solarFrom(raw),
    current: {
      time: raw.current.time,
      temperature_2m: raw.current.temperature_2m ?? null,
      weather_code: raw.current.weather_code ?? null,
      isDay: (raw.current.is_day ?? 1) === 1,
    },
  };
}

/** The hourly variables whose day-mean raw scores the day cards publish. The
 *  day-mean of the HOURLY raw predictability is deliberately the statistic here
 *  — it is what stored samples carry per verified day, so it is what the
 *  calibration curves are fitted on; feeding the daily-cadence score through a
 *  curve would silently mix two distributions (see the plan doc). */
const DAY_RAW_VARIABLES: Record<VerifiedVariable, HourlyVar> = {
  temperature_2m: "temperature_2m",
  precipitation: "precipitation",
};

/** Day-mean of the finite hourly raw scores for one calendar day, or null when
 *  the day has none (e.g. beyond a short hourly axis). */
function dayMeanRaw(hourly: HourlyAggregate, date: string, variable: VerifiedVariable): number | null {
  let sum = 0;
  let n = 0;
  const series = hourly.predictability[DAY_RAW_VARIABLES[variable]];
  for (let h = 0; h < hourly.times.length; h++) {
    if (!hourly.times[h]?.startsWith(date)) continue;
    const v = series[h];
    if (v != null && Number.isFinite(v)) {
      sum += v;
      n += 1;
    }
  }
  return n === 0 ? null : sum / n;
}

/** One day's predictability view-model: per-variable day-mean raw scores mapped
 *  through the calibration ladder (identity when no curve — ADR 0008), collapsed
 *  to their min (ADR 0009). Weather code is deliberately excluded: its agreement
 *  score partly proxies the precipitation call and is uncalibrated. */
function dayPredictabilityFor(hourly: HourlyAggregate, date: string, dayIndex: number, calibration: CalibrationSet | null): DayPredictability {
  // The day's lead anchor — its window midpoint, matching the verification
  // extraction so fit and apply see the same lead-band assignment.
  const leadHours = dayIndex * 24 + 12;

  const part = (variable: VerifiedVariable): { value: number | null; calibrated: boolean } => {
    const raw = dayMeanRaw(hourly, date, variable);
    if (raw === null) return { value: null, calibrated: false };
    return { value: applyCalibration(calibration, variable, leadHours, raw), calibrated: isCalibrated(calibration, variable, leadHours) };
  };

  const temperature = part("temperature_2m");
  const precipitation = part("precipitation");
  const finite = [temperature, precipitation].filter((p) => p.value !== null);
  return {
    overall: finite.length === 0 ? 0 : Math.min(...finite.map((p) => p.value as number)),
    temperature: temperature.value,
    precipitation: precipitation.value,
    temperatureCalibrated: temperature.calibrated,
    precipitationCalibrated: precipitation.calibrated,
    calibrated: finite.length > 0 && finite.every((p) => p.calibrated),
  };
}
