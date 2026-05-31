import type { AggregatePoint } from "./aggregate";
import { severitySlug } from "./weatherCodes";
import type { Variable } from "./weighting";

/** Expected inter-model standard deviation under normal conditions.
 *  Daily accumulated variables (precipitation_sum) use "daily" resolution. */
function typicalSpread(variable: Variable, leadHours: number, resolution: "hourly" | "daily"): number {
  switch (variable) {
    case "temperature_2m": {
      if (leadHours <= 24) return 1;
      if (leadHours <= 72) return 1 + ((leadHours - 24) / 48) * 1;
      if (leadHours <= 168) return 2 + ((leadHours - 72) / 96) * 1.5;
      return 3.5;
    }
    case "precipitation":
      if (resolution === "daily") return leadHours <= 48 ? 5 : 10; // mm/day
      return leadHours <= 48 ? 1.5 : 2.5; // mm/h
    case "precipitation_probability":
      return 25;
    case "wind_speed_10m":
      return leadHours <= 48 ? 4 : 7;
    case "wind_direction_10m":
      return leadHours <= 48 ? 30 : 70;
    case "cloud_cover":
      return 25;
    case "weather_code":
      return 1; // unused — weather_code uses agreement, not spread
  }
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** Penalises forecasts built from fewer than 3 contributing models.
 *  1 model → ⅓, 2 models → ⅔, 3+ models → 1. */
function modelCountFactor(point: AggregatePoint): number {
  return Math.min(1, Object.keys(point.weights).length / 3);
}

export function confidenceFor(point: AggregatePoint, variable: Variable, leadHours: number, resolution: "hourly" | "daily" = "hourly"): number {
  const mcf = modelCountFactor(point);
  if (variable === "weather_code") {
    return weatherCodeConfidence(point) * mcf;
  }
  if (variable === "wind_direction_10m") {
    return clamp01((1 - point.stdDev / typicalSpread("wind_direction_10m", leadHours, "hourly")) * mcf);
  }
  if (Number.isNaN(point.value)) return 0;
  const spreadScore = clamp01(1 - point.stdDev / typicalSpread(variable, leadHours, resolution));
  return clamp01(spreadScore * mcf);
}

function weatherCodeConfidence(point: AggregatePoint): number {
  const aggSlug = severitySlug(point.value);
  let agreementW = 0;
  for (const [id, w] of Object.entries(point.weights)) {
    const v = point.perModel[id];
    if (v == null) continue;
    if (severitySlug(v) === aggSlug) agreementW += w;
  }
  return clamp01(agreementW);
}

export function bandWidth(point: AggregatePoint, variable: Variable): number {
  if (variable === "weather_code") return 0;
  return point.stdDev;
}

/** UI-side "overall confidence": the unweighted mean of the finite per-variable
 *  parts (non-finite parts — e.g. a variable with no data — are skipped, not
 *  counted as zero). Returns 0 when nothing is finite. This is the single
 *  definition of the collapse CONTEXT.md flags as "overall confidence (under
 *  review)"; the forecast view's badge and the daily strip both route through it
 *  so they can never drift apart. */
export function overallConfidence(parts: readonly (number | null | undefined)[]): number {
  let sum = 0;
  let n = 0;
  for (const v of parts) {
    if (v != null && Number.isFinite(v)) {
      sum += v;
      n += 1;
    }
  }
  return n === 0 ? 0 : sum / n;
}

export type ConfidenceTier = "high" | "mid" | "low";

export function confidenceTier(c: number): ConfidenceTier {
  if (c >= 0.7) return "high";
  if (c >= 0.4) return "mid";
  return "low";
}
