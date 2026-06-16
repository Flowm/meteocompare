// Verification scoring. Takes hourly forecast + truth pairs and emits
// per-day (per-variable, per-model and aggregate) score records.
//
// The methodology — Amount + Timing for precipitation with ±1 h tolerance,
// bias + MAE for temperature — is documented in
// docs/adr/0002-two-part-precipitation-score.md.

import { aggregateValue, type AggregatePoint } from "./aggregate";

/** Threshold above which a precipitation reading counts as "wet" (mm/h). */
export const WET_THRESHOLD_MM_PER_H = 0.1;

/** Timing tolerance for the precipitation hit/miss classification (hours). */
export const TIMING_TOLERANCE_HOURS = 1;

/** Hours per verification day. The page exposes one verification card per 24 h. */
export const HOURS_PER_DAY = 24;

export type HourClassification = "hit" | "miss" | "false_alarm" | "correct_dry";

export interface TemperatureScores {
  /** Signed mean error (forecast minus truth), °C. */
  bias: number;
  /** Mean absolute error, °C. */
  mae: number;
  /** Aggregate per-variable confidence averaged over the day. `NaN` for per-model rows
   *  (the per-variable confidence formula is defined only over the aggregate). */
  confidence: number;
  forecastMin: number;
  forecastMax: number;
  truthMin: number;
  truthMax: number;
}

export interface PrecipitationScores {
  /** Signed daily-sum error (forecast minus truth), mm. */
  amountError: number;
  /** Timing skill as the Critical Success Index `hits / (hits + misses +
   *  false_alarms)`, in `[0, 1]`. Penalises missed rain AND false alarms, so
   *  over-predicting rain no longer scores well. `NaN` only when nothing
   *  happened on either side (all correct-dry) — timing is then undefined. */
  timingScore: number;
  /** Aggregate per-variable confidence averaged over the day. `NaN` for per-model rows. */
  confidence: number;
  forecastSum: number;
  truthSum: number;
  /** Per-hour categorical labels — exactly `HOURS_PER_DAY` entries. */
  hourlyClassification: HourClassification[];
}

export interface VariableScores {
  temperature: TemperatureScores | null;
  precipitation: PrecipitationScores | null;
}

export interface DailyVerification {
  /** ISO date `YYYY-MM-DD` of the run start. */
  runDate: string;
  /** Day index inside the run window, `0`-based. Day 0 starts at hour 0 of the run. */
  dayIndex: number;
  leadHoursStart: number;
  /** Exclusive end. */
  leadHoursEnd: number;
  aggregate: VariableScores;
  /** Keyed by model id (e.g. `"ecmwf_ifs"`). */
  perModel: Record<string, VariableScores>;
}

// ---------------------------------------------------------------------------
// Pure stat primitives
// ---------------------------------------------------------------------------

/** Mean of `(forecast − truth)` over hour pairs where both are non-null.
 *  Returns `NaN` when no overlapping pair exists. */
export function bias(forecast: readonly (number | null)[], truth: readonly (number | null)[]): number {
  let sum = 0;
  let n = 0;
  const len = Math.min(forecast.length, truth.length);
  for (let i = 0; i < len; i++) {
    const f = forecast[i];
    const t = truth[i];
    if (f == null || t == null) continue;
    sum += f - t;
    n += 1;
  }
  return n === 0 ? NaN : sum / n;
}

/** Mean of `|forecast − truth|` over hour pairs where both are non-null. */
export function mae(forecast: readonly (number | null)[], truth: readonly (number | null)[]): number {
  let sum = 0;
  let n = 0;
  const len = Math.min(forecast.length, truth.length);
  for (let i = 0; i < len; i++) {
    const f = forecast[i];
    const t = truth[i];
    if (f == null || t == null) continue;
    sum += Math.abs(f - t);
    n += 1;
  }
  return n === 0 ? NaN : sum / n;
}

/** Sum of non-null values. Nulls treated as missing (skipped), not zero —
 *  important for short-lead models that drop out mid-day. */
export function sumNonNull(values: readonly (number | null)[]): number {
  let s = 0;
  for (const v of values) if (v != null) s += v;
  return s;
}

export function minNonNull(values: readonly (number | null)[]): number {
  let m = Infinity;
  for (const v of values) if (v != null && v < m) m = v;
  return Number.isFinite(m) ? m : NaN;
}

export function maxNonNull(values: readonly (number | null)[]): number {
  let m = -Infinity;
  for (const v of values) if (v != null && v > m) m = v;
  return Number.isFinite(m) ? m : NaN;
}

/** Mean of non-null finite values. Returns `0` when the array is empty/all-NaN
 *  — this is the daily mean confidence helper, where 0 means "no information". */
export function meanFinite(values: readonly number[]): number {
  let s = 0;
  let n = 0;
  for (const v of values) {
    if (Number.isFinite(v)) {
      s += v;
      n += 1;
    }
  }
  return n === 0 ? 0 : s / n;
}

// ---------------------------------------------------------------------------
// Precipitation classification
// ---------------------------------------------------------------------------

/** Classify each hour against truth, using a ±tolerance window for timing
 *  forgiveness. Returns one label per hour:
 *
 *  - `hit` — truth wet at this hour AND forecast wet somewhere in [h−tol, h+tol]
 *  - `miss` — truth wet at this hour AND no forecast wet in [h−tol, h+tol]
 *  - `false_alarm` — truth dry at this hour AND forecast wet at this hour AND
 *                    no truth wet anywhere in [h−tol, h+tol]
 *  - `correct_dry` — anything else (includes "forecast wet at h with adjacent
 *                    truth wet that was already counted as a hit on a neighbour
 *                    hour" — i.e. timing-shifted forecasts don't double-count).
 *
 *  Null values on either side are treated as 0 (dry) for the classification —
 *  the strip needs a label for every hour. */
export function classifyHours(
  forecast: readonly (number | null)[],
  truth: readonly (number | null)[],
  threshold: number = WET_THRESHOLD_MM_PER_H,
  tolerance: number = TIMING_TOLERANCE_HOURS,
): HourClassification[] {
  const n = Math.max(forecast.length, truth.length);
  const fWet = (i: number): boolean => {
    const v = forecast[i];
    return v != null && v >= threshold;
  };
  const tWet = (i: number): boolean => {
    const v = truth[i];
    return v != null && v >= threshold;
  };

  const result: HourClassification[] = [];
  for (let i = 0; i < n; i++) {
    let nearbyForecastWet = false;
    let nearbyTruthWet = false;
    for (let k = i - tolerance; k <= i + tolerance; k++) {
      if (k < 0 || k >= n) continue;
      if (fWet(k)) nearbyForecastWet = true;
      if (tWet(k)) nearbyTruthWet = true;
    }

    if (tWet(i)) {
      result.push(nearbyForecastWet ? "hit" : "miss");
    } else if (fWet(i) && !nearbyTruthWet) {
      result.push("false_alarm");
    } else {
      result.push("correct_dry");
    }
  }
  return result;
}

/** Critical Success Index (a.k.a. threat score): `hits / (hits + misses +
 *  false_alarms)`. Unlike a bare hit rate (POD), this penalises false alarms,
 *  so a forecast that cries wolf — predicting rain that never falls — scores
 *  low instead of being ignored. Returns `NaN` only when nothing happened on
 *  either side (no hits, misses, or false alarms), where timing is undefined. */
export function timingScore(classifications: readonly HourClassification[]): number {
  let hits = 0;
  let misses = 0;
  let falseAlarms = 0;
  for (const c of classifications) {
    if (c === "hit") hits += 1;
    else if (c === "miss") misses += 1;
    else if (c === "false_alarm") falseAlarms += 1;
  }
  const events = hits + misses + falseAlarms;
  return events === 0 ? NaN : hits / events;
}

// ---------------------------------------------------------------------------
// Per-variable score builders
// ---------------------------------------------------------------------------

function scoreTemperature(forecast: readonly (number | null)[], truth: readonly (number | null)[], confidence: number): TemperatureScores | null {
  const b = bias(forecast, truth);
  const m = mae(forecast, truth);
  if (Number.isNaN(b) || Number.isNaN(m)) return null;
  return {
    bias: b,
    mae: m,
    confidence,
    forecastMin: minNonNull(forecast),
    forecastMax: maxNonNull(forecast),
    truthMin: minNonNull(truth),
    truthMax: maxNonNull(truth),
  };
}

function scorePrecipitation(forecast: readonly (number | null)[], truth: readonly (number | null)[], confidence: number): PrecipitationScores | null {
  // If the forecast side has no data at all, there's nothing to score. The
  // earlier behaviour treated null forecasts as 0 mm/h, which produced a
  // misleading `amountError = −truthSum` for models that simply didn't return
  // precipitation data (i.e. claiming the model predicted a completely dry
  // week, when really it predicted nothing). Mirrors how temperature handles
  // the same case implicitly via `bias()`/`mae()` returning NaN.
  const anyForecast = forecast.some((v) => v != null);
  if (!anyForecast) return null;
  const classification = classifyHours(forecast, truth);
  return {
    amountError: sumNonNull(forecast) - sumNonNull(truth),
    timingScore: timingScore(classification),
    confidence,
    forecastSum: sumNonNull(forecast),
    truthSum: sumNonNull(truth),
    hourlyClassification: classification,
  };
}

// ---------------------------------------------------------------------------
// Daily orchestrator
// ---------------------------------------------------------------------------

export interface BuildDailyOptions {
  runDate: string;
  /** Hourly time axis covering the full run window (e.g. 168 entries for 7 days). */
  times: readonly string[];
  /** Aggregate forecast points for temperature, one per hour. */
  aggregateTemp: readonly AggregatePoint[];
  aggregatePrecip: readonly AggregatePoint[];
  /** Per-hour aggregate-level per-variable confidence, one per hour. */
  confidenceTemp: readonly number[];
  confidencePrecip: readonly number[];
  /** Per-model raw hourly forecast values, keyed by model id. */
  perModelTemp: Readonly<Record<string, readonly (number | null)[]>>;
  perModelPrecip: Readonly<Record<string, readonly (number | null)[]>>;
  /** ERA5-Seamless truth, one entry per hour. */
  truthTemp: readonly (number | null)[];
  truthPrecip: readonly (number | null)[];
}

/** Reduce the hourly run window to one verification record per 24 h day.
 *  Trailing partial days (less than HOURS_PER_DAY of data) are dropped — better
 *  to omit a half-day card than to show a misleading "amountError ÷ 12 hours". */
export function buildDailyVerification(opts: BuildDailyOptions): DailyVerification[] {
  const numDays = Math.floor(opts.times.length / HOURS_PER_DAY);
  const out: DailyVerification[] = [];

  for (let day = 0; day < numDays; day++) {
    const start = day * HOURS_PER_DAY;
    const end = start + HOURS_PER_DAY;

    const aggT = opts.aggregateTemp.slice(start, end).map(aggregateValue);
    const aggP = opts.aggregatePrecip.slice(start, end).map(aggregateValue);
    const truthT = opts.truthTemp.slice(start, end);
    const truthP = opts.truthPrecip.slice(start, end);

    const dailyConfT = meanFinite(opts.confidenceTemp.slice(start, end));
    const dailyConfP = meanFinite(opts.confidencePrecip.slice(start, end));

    const aggregate: VariableScores = {
      temperature: scoreTemperature(aggT, truthT, dailyConfT),
      precipitation: scorePrecipitation(aggP, truthP, dailyConfP),
    };

    const perModel: Record<string, VariableScores> = {};
    const modelIds = new Set<string>([...Object.keys(opts.perModelTemp), ...Object.keys(opts.perModelPrecip)]);
    for (const id of modelIds) {
      const fT = (opts.perModelTemp[id] ?? []).slice(start, end);
      const fP = (opts.perModelPrecip[id] ?? []).slice(start, end);
      perModel[id] = {
        temperature: scoreTemperature(fT, truthT, NaN),
        precipitation: scorePrecipitation(fP, truthP, NaN),
      };
    }

    out.push({
      runDate: opts.runDate,
      dayIndex: day,
      leadHoursStart: start,
      leadHoursEnd: end,
      aggregate,
      perModel,
    });
  }
  return out;
}
