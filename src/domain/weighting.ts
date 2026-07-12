// The shipping weight recipe. `modelWeight` is the fitted weight ladder (ADR
// 0011): the hand-tuned per-class lead-time decay is gone — lead-time authority
// now lives entirely in the fitted per-model, per-band multipliers of
// analysis/defaultWeights.DEFAULT_WEIGHTS, resolved through weightLadder. See
// docs/adr/0011-fitted-weight-ladder.md.

import { DEFAULT_WEIGHTS } from "@/analysis/defaultWeights";

import type { ModelDef } from "./models";
import { regionBonus } from "./models";
import type { Variable } from "./variables";
import { bandIndexFor, resolveMultiplier, variableBoost } from "./weightLadder";

// The Variable union now lives in variables.ts (the descriptor table's key);
// re-exported here so existing `from "./weighting"` importers keep working.
export type { Variable };
// variableBoost moved to weightLadder (so this module can depend on it without a
// cycle); re-exported here for callers that still import it `from "./weighting"`.
export { variableBoost };

/** One model's blend weight at a lead time (ADR 0011, the fitted ladder recipe):
 *
 *    (1 + regionBonus) × variableBoost × builtin[model][band] × pooled[model]
 *
 *  `builtin[model][band]` is the shipped default tier (DEFAULT_WEIGHTS), resolved
 *  per lead band down `resolveMultiplier`'s ladder (per-model → per-class → 1) —
 *  the SOLE lead-time authority, replacing the deleted hand-tuned decay. The
 *  optional `multipliers` is the device (per-location) tier: per-model *pooled*
 *  residuals the user opted into, applied as a flat factor across bands (ADR 0011
 *  rejected a per-band device tier). 0 beyond the model's archive cutoff and for
 *  negative leads. */
export function modelWeight(model: ModelDef, leadHours: number, lat: number, lon: number, variable: Variable, multipliers?: Record<string, number>): number {
  if (leadHours < 0 || leadHours > model.maxLeadHours) return 0;
  const base = 1 + regionBonus(model, lat, lon);
  const builtin = resolveMultiplier(model.id, model.kind, bandIndexFor(leadHours), undefined, DEFAULT_WEIGHTS ?? undefined);
  const pooled = multipliers?.[model.id] ?? 1;
  return base * variableBoost(model, variable) * builtin * pooled;
}

/** Compute normalized weights (sum = 1) given a list of models and a context.
 *  Models whose raw weight is 0 are dropped — they don't cover this lead time. */
export function normalizedWeights(models: ModelDef[], leadHours: number, lat: number, lon: number, variable: Variable, multipliers?: Record<string, number>): Map<string, number> {
  const raw = new Map<string, number>();
  let total = 0;
  for (const m of models) {
    const w = modelWeight(m, leadHours, lat, lon, variable, multipliers);
    if (w > 0) {
      raw.set(m.id, w);
      total += w;
    }
  }
  if (total === 0) return raw;
  for (const [id, w] of raw) raw.set(id, w / total);
  return raw;
}
