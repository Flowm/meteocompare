// Verification scoring. Takes hourly forecast + truth pairs and emits
// per-day (per-variable, per-model and aggregate) score records.
//
// The methodology — Amount + Timing for precipitation with ±1 h tolerance,
// bias + MAE for temperature — is documented in
// docs/adr/0002-two-part-precipitation-score.md.

import { type AggregatePoint } from "./aggregate";
import { meanFinite as sharedMeanFinite } from "./num";

/** Threshold above which a precipitation reading counts as "wet" (mm/h). */
export const WET_THRESHOLD_MM_PER_H = 0.1;

/** Timing tolerance for the precipitation hit/miss classification (hours). */
export const TIMING_TOLERANCE_HOURS = 1;

/** Hours per verification day. The page exposes one verification card per 24 h. */
export const HOURS_PER_DAY = 24;

export type HourClassification = "hit" | "miss" | "false_alarm" | "correct_dry" | "no_data";

export interface TemperatureScores {
  /** Signed mean error (forecast minus truth), °C. */
  bias: number;
  /** Mean absolute error, °C. */
  mae: number;
  /** Aggregate per-variable predictability averaged over the day. `NaN` for per-model rows
   *  (the per-variable predictability formula is defined only over the aggregate). */
  predictability: number;
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
  /** Aggregate per-variable predictability averaged over the day. `NaN` for per-model rows. */
  predictability: number;
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

/** The variables the verification path scores — the single source the fetch
 *  lists (omSingleRuns, omHistoricalWeather truth) and `runEvaluation`'s
 *  plumbing all derive from. Today temperature and precipitation, the two
 *  ERA5-Seamless provides truth for (CONTEXT.md "Truth", ADR 0001). Wind and
 *  cloud-cover truth exist; adding one starts with a new id here — the
 *  `Record<VerifiedVariable, …>` channel types then point the compiler at the
 *  one remaining decision, its per-variable metrics. */
export const VERIFIED_VARIABLES = ["temperature_2m", "precipitation"] as const;

export type VerifiedVariable = (typeof VERIFIED_VARIABLES)[number];

/** One verified variable's inputs for a single (run, location): the aggregate
 *  best-estimate surface, every model's raw hourly series, and the aligned
 *  ERA5-Seamless truth. Replaces the flat `…Temp`/`…Precip` field pairs so a
 *  new variable is a new key, not two new fields at every call site. */
export interface VerifyChannel {
  /** Aggregate forecast points, one per hour; `value` is already `number | null`. */
  aggregate: readonly AggregatePoint[];
  perModel: Readonly<Record<string, readonly (number | null)[]>>;
  /** ERA5-Seamless truth, one entry per hour. */
  truth: readonly (number | null)[];
}

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

/** Forecast and truth precipitation sums restricted to the hours the forecast
 *  actually covers (a non-null forecast value). Truth in hours the forecast
 *  never provided is ignored, so a model that drops out mid-window is judged
 *  only on the rain during the hours it forecast — not charged for rain it had
 *  no chance to predict. Mirrors how `bias()`/`mae()` only score overlapping
 *  pairs. The two sums are coverage-aligned, so `forecastSum − truthSum` is a
 *  fair amount error. */
export function coveredPrecipSums(forecast: readonly (number | null)[], truth: readonly (number | null)[]): { forecastSum: number; truthSum: number } {
  let forecastSum = 0;
  let truthSum = 0;
  for (let i = 0; i < forecast.length; i++) {
    const f = forecast[i];
    if (f == null) continue;
    forecastSum += f;
    const t = truth[i];
    if (t != null) truthSum += t;
  }
  return { forecastSum, truthSum };
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
 *  — this is the daily mean predictability helper, where 0 means "no information".
 *  Thin alias over the shared `meanFinite` reduction in num.ts. */
export function meanFinite(values: readonly number[]): number {
  return sharedMeanFinite(values);
}

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
 *  - `no_data` — the forecast (or truth) has no value at this hour, so there is
 *                nothing to evaluate. These hours are excluded from the timing
 *                score (`timingScore` ignores them), so a model is never
 *                penalised for hours it never forecast; the strip still gets a
 *                label for every hour. Mirrors how `bias()`/`mae()` skip pairs
 *                where either side is null. */
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
    // No forecast (or no truth) at this hour — nothing to score. Excluded from
    // the timing CSI rather than counted as a miss/correct-dry.
    if (forecast[i] == null || truth[i] == null) {
      result.push("no_data");
      continue;
    }
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

function scoreTemperature(forecast: readonly (number | null)[], truth: readonly (number | null)[], predictability: number): TemperatureScores | null {
  const b = bias(forecast, truth);
  const m = mae(forecast, truth);
  if (Number.isNaN(b) || Number.isNaN(m)) return null;
  return {
    bias: b,
    mae: m,
    predictability,
    forecastMin: minNonNull(forecast),
    forecastMax: maxNonNull(forecast),
    truthMin: minNonNull(truth),
    truthMax: maxNonNull(truth),
  };
}

function scorePrecipitation(forecast: readonly (number | null)[], truth: readonly (number | null)[], predictability: number): PrecipitationScores | null {
  // No forecast data at all is unscorable, not a dry forecast. Treating null as
  // 0 mm/h would yield `amountError = −truthSum` — indistinguishable from a
  // model that confidently predicted a dry week. Mirrors how temperature reaches
  // the same answer implicitly, via `bias()`/`mae()` returning NaN.
  const anyForecast = forecast.some((v) => v != null);
  if (!anyForecast) return null;
  const classification = classifyHours(forecast, truth);
  // Sum truth only over the hours the forecast covers (coverage-aligned), so a
  // model that drops out mid-day isn't charged for the rain it never forecast.
  const { forecastSum, truthSum } = coveredPrecipSums(forecast, truth);
  return {
    amountError: forecastSum - truthSum,
    timingScore: timingScore(classification),
    predictability,
    forecastSum,
    truthSum,
    hourlyClassification: classification,
  };
}

/** A verify channel plus the per-hour aggregate predictability the daily card
 *  pairs each day's error with — the calibration lens (CONTEXT.md "Daily
 *  breakdown"). Predictability rides on the channel because it is defined only
 *  over the aggregate and only the daily builder consumes it. */
export interface DailyChannel extends VerifyChannel {
  predictability: readonly number[];
}

export interface BuildDailyOptions {
  runDate: string;
  /** Hourly time axis covering the full run window (e.g. 168 entries for 7 days). */
  times: readonly string[];
  /** One channel per verified variable. Read explicitly per variable below —
   *  the scoring stays temperature-vs-precipitation specific. */
  channels: Record<VerifiedVariable, DailyChannel>;
}

/** Reduce the hourly run window to one verification record per 24 h day.
 *  Trailing partial days (less than HOURS_PER_DAY of data) are dropped — better
 *  to omit a half-day card than to show a misleading "amountError ÷ 12 hours". */
export function buildDailyVerification(opts: BuildDailyOptions): DailyVerification[] {
  const numDays = Math.floor(opts.times.length / HOURS_PER_DAY);
  const out: DailyVerification[] = [];

  // Scoring is deliberately per-variable-specific (scoreTemperature vs
  // scorePrecipitation): read each channel by its known key, don't genericise.
  const temp = opts.channels.temperature_2m;
  const precip = opts.channels.precipitation;

  for (let day = 0; day < numDays; day++) {
    const start = day * HOURS_PER_DAY;
    const end = start + HOURS_PER_DAY;

    const aggT = temp.aggregate.slice(start, end).map((p) => p.value);
    const aggP = precip.aggregate.slice(start, end).map((p) => p.value);
    const truthT = temp.truth.slice(start, end);
    const truthP = precip.truth.slice(start, end);

    const dailyPredT = meanFinite(temp.predictability.slice(start, end));
    const dailyPredP = meanFinite(precip.predictability.slice(start, end));

    const aggregate: VariableScores = {
      temperature: scoreTemperature(aggT, truthT, dailyPredT),
      precipitation: scorePrecipitation(aggP, truthP, dailyPredP),
    };

    const perModel: Record<string, VariableScores> = {};
    const modelIds = new Set<string>([...Object.keys(temp.perModel), ...Object.keys(precip.perModel)]);
    for (const id of modelIds) {
      const fT = (temp.perModel[id] ?? []).slice(start, end);
      const fP = (precip.perModel[id] ?? []).slice(start, end);
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
