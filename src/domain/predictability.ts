import type { AggregatePoint } from "./aggregate";
import { effectiveModelCount } from "./models";
import { clamp01 } from "./num";
import { VARIABLES, type Variable } from "./variables";
import { severitySlug } from "./weatherCodes";

/** Expected inter-model standard deviation under normal conditions, read from
 *  the descriptor table. Daily accumulated variables (precipitation_sum) use
 *  "daily" resolution. */
function typicalSpread(variable: Variable, leadHours: number, resolution: "hourly" | "daily"): number {
  return VARIABLES[variable].typicalSpread(leadHours, resolution);
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
  if (VARIABLES[variable].predictability === "agreement") {
    return weatherCodePredictability(point) * mcf;
  }
  if (variable === "wind_direction_10m") {
    // Angular spread has no daily accumulation, so its typical-spread band is
    // always read at "hourly" resolution regardless of the caller's cadence —
    // and it skips the numeric-mean's NaN/spreadScore-clamp path.
    return clamp01((1 - point.stdDev / typicalSpread("wind_direction_10m", leadHours, "hourly")) * mcf);
  }
  // No contributing models at this timestep → nothing to be predictable about.
  if (point.value === null) return 0;
  const spreadScore = clamp01(1 - point.stdDev / typicalSpread(variable, leadHours, resolution));
  return clamp01(spreadScore * mcf);
}

function weatherCodePredictability(point: AggregatePoint): number {
  if (point.value === null) return 0;
  const aggSlug = severitySlug(point.value);
  let agreementW = 0;
  for (const [id, w] of Object.entries(point.weights)) {
    const v = point.perModel[id];
    if (v == null) continue;
    if (severitySlug(v) === aggSlug) agreementW += w;
  }
  return clamp01(agreementW);
}

export type PredictabilityTier = "high" | "mid" | "low";

/** Which scale a predictability value lives on: `calibrated` = a verified hit
 *  frequency from a calibration curve; `raw` = the agreement heuristic. */
export type PredictabilityScale = "raw" | "calibrated";

/** Tier cutoffs per scale (ADR 0008). The calibrated scale follows NWS
 *  confidence conventions (warnings anchor near 80%, watches near 50%); the raw
 *  scale keeps the cutoffs tuned to the heuristic score's distribution — one
 *  set for both would either mark coin-flips "mid" or make untrained locations
 *  read uniformly worse. */
export const TIER_CUTOFFS: Record<PredictabilityScale, { high: number; mid: number }> = {
  raw: { high: 0.7, mid: 0.4 },
  calibrated: { high: 0.8, mid: 0.5 },
};

export function predictabilityTier(c: number, scale: PredictabilityScale = "raw"): PredictabilityTier {
  const cut = TIER_CUTOFFS[scale];
  if (c >= cut.high) return "high";
  if (c >= cut.mid) return "mid";
  return "low";
}
