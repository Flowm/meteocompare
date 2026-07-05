import type { AggregatePoint } from "./aggregate";
import { effectiveModelCount } from "./models";
import { clamp01, meanFinite } from "./num";
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

/** Penalises forecasts built from fewer than ~3 *independent* contributing
 *  models, using the effective (lineage-discounted) count so a cluster of
 *  same-family models (e.g. the ICON variants) does not read as independent
 *  corroboration. See effectiveModelCount and ADR 0006. */
function modelCountFactor(point: AggregatePoint): number {
  return Math.min(1, effectiveModelCount(Object.keys(point.weights)) / 3);
}

export function predictabilityFor(point: AggregatePoint, variable: Variable, leadHours: number, resolution: "hourly" | "daily" = "hourly"): number {
  const mcf = modelCountFactor(point);
  if (variable === "weather_code") {
    return weatherCodePredictability(point) * mcf;
  }
  if (variable === "wind_direction_10m") {
    return clamp01((1 - point.stdDev / typicalSpread("wind_direction_10m", leadHours, "hourly")) * mcf);
  }
  if (Number.isNaN(point.value)) return 0;
  const spreadScore = clamp01(1 - point.stdDev / typicalSpread(variable, leadHours, resolution));
  return clamp01(spreadScore * mcf);
}

function weatherCodePredictability(point: AggregatePoint): number {
  const aggSlug = severitySlug(point.value);
  let agreementW = 0;
  for (const [id, w] of Object.entries(point.weights)) {
    const v = point.perModel[id];
    if (v == null) continue;
    if (severitySlug(v) === aggSlug) agreementW += w;
  }
  return clamp01(agreementW);
}

/** UI-side "overall predictability": the unweighted mean of the finite per-variable
 *  parts (non-finite parts — e.g. a variable with no data — are skipped, not
 *  counted as zero). Returns 0 when nothing is finite. This is the single
 *  definition of the collapse CONTEXT.md flags as "overall predictability (under
 *  review)"; the forecast view's badge and the daily strip both route through it
 *  so they can never drift apart. */
export function overallPredictability(parts: readonly (number | null | undefined)[]): number {
  return meanFinite(parts);
}

export type PredictabilityTier = "high" | "mid" | "low";

export function predictabilityTier(c: number): PredictabilityTier {
  if (c >= 0.7) return "high";
  if (c >= 0.4) return "mid";
  return "low";
}
