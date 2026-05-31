import type { ModelDef } from "./models";
import { ALL_KNOWN_CODES, severitySlug, type SeveritySlug } from "./weatherCodes";
import { normalizedWeights, type Variable } from "./weighting";

/** A single (model → value) sample at one timestep. Null = model has no value here. */
export type ModelSamples = Record<string, number | null>;

/** Renormalize the accumulated raw weights so the exposed shares sum to 1 (even
 *  after dropping models that were null at this timestep). Mutates and returns
 *  `used` for convenience. */
function normalizeShares(used: Record<string, number>, totalW: number): Record<string, number> {
  for (const id in used) {
    const w = used[id];
    if (w !== undefined) used[id] = w / totalW;
  }
  return used;
}

export interface AggregatePoint {
  /** ISO-like local timestamp from open-meteo. */
  time: string;
  /** Weighted mean (for numeric variables) or modal code (for weather_code). */
  value: number;
  /** Weighted standard deviation of the contributing model values. 0 for weather_code. */
  stdDev: number;
  /** Weights actually used at this timestep (sum = 1 across contributing models). */
  weights: Record<string, number>;
  /** Raw per-model values (including nulls), for the breakdown view & confidence math. */
  perModel: ModelSamples;
}

export interface AggregateOptions {
  variable: Variable;
  models: ModelDef[];
  lat: number;
  lon: number;
  /** Hourly reference time of the *first* timestep (UTC ISO) so we can compute lead-hours. */
  baseTime: Date;
}

function leadHoursAt(time: string, baseTime: Date): number {
  // open-meteo returns timezone-shifted ISO strings without a TZ marker.
  // Both the times array and our cursor are in the same local frame, so a
  // direct millisecond diff is correct.
  const t = new Date(time).getTime();
  return Math.max(0, (t - baseTime.getTime()) / 3_600_000);
}

function weightedMean(perModel: ModelSamples, weights: Map<string, number>): { mean: number; stdDev: number; effectiveWeights: Record<string, number> } {
  let sum = 0;
  let totalW = 0;
  const used: Record<string, number> = {};
  for (const [id, w] of weights) {
    const v = perModel[id];
    if (v == null || Number.isNaN(v)) continue;
    sum += v * w;
    totalW += w;
    used[id] = w;
  }
  if (totalW === 0) {
    return { mean: NaN, stdDev: 0, effectiveWeights: {} };
  }
  const mean = sum / totalW;
  let varSum = 0;
  for (const id in used) {
    const v = perModel[id];
    const w = used[id];
    if (v == null || w === undefined) continue;
    varSum += (w / totalW) * (v - mean) ** 2;
  }
  return { mean, stdDev: Math.sqrt(varSum), effectiveWeights: normalizeShares(used, totalW) };
}

/** Weighted average of angles via unit-vector sum.
 *  stdDev becomes the angular standard deviation in degrees (Mardia / circular). */
function weightedCircularMean(perModel: ModelSamples, weights: Map<string, number>): { mean: number; stdDev: number; effectiveWeights: Record<string, number> } {
  let x = 0;
  let y = 0;
  let totalW = 0;
  const used: Record<string, number> = {};
  for (const [id, w] of weights) {
    const v = perModel[id];
    if (v == null || Number.isNaN(v)) continue;
    const r = (v * Math.PI) / 180;
    x += w * Math.cos(r);
    y += w * Math.sin(r);
    totalW += w;
    used[id] = w;
  }
  if (totalW === 0) {
    return { mean: NaN, stdDev: 0, effectiveWeights: {} };
  }
  const mx = x / totalW;
  const my = y / totalW;
  const meanRad = Math.atan2(my, mx);
  const mean = ((meanRad * 180) / Math.PI + 360) % 360;
  // Mean resultant length R in [0, 1]; closer to 1 = tighter agreement.
  const R = Math.min(1, Math.sqrt(mx * mx + my * my));
  // Circular standard deviation in radians: sqrt(-2 * ln(R)). Convert to degrees.
  const stdDev = R > 0 ? (Math.sqrt(-2 * Math.log(R)) * 180) / Math.PI : 180;
  return { mean, stdDev, effectiveWeights: normalizeShares(used, totalW) };
}

function severityWeightedMode(perModel: ModelSamples, weights: Map<string, number>): { code: number; effectiveWeights: Record<string, number> } {
  const slugTotals = new Map<SeveritySlug, number>();
  const codeTotals = new Map<number, number>();
  const used: Record<string, number> = {};
  let totalW = 0;
  for (const [id, w] of weights) {
    const v = perModel[id];
    if (v == null) continue;
    const slug = severitySlug(v);
    slugTotals.set(slug, (slugTotals.get(slug) ?? 0) + w);
    codeTotals.set(v, (codeTotals.get(v) ?? 0) + w);
    used[id] = w;
    totalW += w;
  }
  if (totalW === 0) return { code: 0, effectiveWeights: {} };

  let bestSlug: SeveritySlug = "clear";
  let bestSlugW = -Infinity;
  for (const [slug, w] of slugTotals) {
    if (w > bestSlugW) {
      bestSlug = slug;
      bestSlugW = w;
    }
  }
  let bestCode = 0;
  let bestCodeW = -Infinity;
  for (const [code, w] of codeTotals) {
    if (severitySlug(code) !== bestSlug) continue;
    if (w > bestCodeW) {
      bestCode = code;
      bestCodeW = w;
    }
  }
  return { code: bestCode, effectiveWeights: normalizeShares(used, totalW) };
}

/** Stitch per-model timeseries into a single aggregate timeseries.
 *  `series[modelId]` is the value array; `times` is the shared time axis. */
export function aggregateSeries(times: string[], series: Record<string, (number | null)[]>, opts: AggregateOptions): AggregatePoint[] {
  const { variable, models, lat, lon, baseTime } = opts;
  const result: AggregatePoint[] = [];
  for (let i = 0; i < times.length; i++) {
    const timeStr = times[i];
    if (timeStr === undefined) continue;
    const leadH = leadHoursAt(timeStr, baseTime);
    const weights = normalizedWeights(models, leadH, lat, lon, variable);
    const perModel: ModelSamples = {};
    for (const m of models) {
      const arr = series[m.id];
      perModel[m.id] = arr ? (arr[i] ?? null) : null;
    }
    if (variable === "weather_code") {
      // Force integer codes; some models may report decimals.
      for (const id in perModel) {
        const v = perModel[id];
        perModel[id] = v == null ? null : Math.round(v);
      }
      const { code, effectiveWeights } = severityWeightedMode(perModel, weights);
      result.push({
        time: timeStr,
        value: code,
        stdDev: 0,
        weights: effectiveWeights,
        perModel,
      });
    } else if (variable === "wind_direction_10m") {
      const { mean, stdDev, effectiveWeights } = weightedCircularMean(perModel, weights);
      result.push({
        time: timeStr,
        value: mean,
        stdDev,
        weights: effectiveWeights,
        perModel,
      });
    } else {
      const { mean, stdDev, effectiveWeights } = weightedMean(perModel, weights);
      result.push({
        time: timeStr,
        value: mean,
        stdDev,
        weights: effectiveWeights,
        perModel,
      });
    }
  }
  return result;
}

export { ALL_KNOWN_CODES };
