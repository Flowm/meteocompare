// Verification-page comparator ONLY — the superseded pre-ADR-0011 heuristic
// weight recipe, kept verbatim so the scorecard can score it as the
// "Aggregate (legacy)" row against the shipping fitted ladder.
//
// Do NOT import this from any production aggregate path. ADR 0011 makes the
// fitted ladder the sole lead-time authority and the hand-tuned per-class decay
// below is exactly what it replaced; the only caller is the verification
// evaluation, which injects it as an alternative weight function.
//
// The recipe is arm 0 of the ladder experiment: no trained/device multipliers,
// so it is (1 + regionBonus) × leadFactor × variableBoost, as the old
// modelWeight composed it.
//
// TEMPORARY: kept only while confidence in the fitted ladder builds — delete
// this module (and the Aggregate (legacy) row) once the comparison has served
// its purpose. See docs/research/weight-ladder-legacy-comparison.md for the
// verdict so far (ladder wins ~65% of runs, median +0.9 composite).

import type { ModelDef } from "./models";
import { regionBonus } from "./models";
import { VARIABLES, type Variable } from "./variables";

/** Gentle decay past 3 days: full weight ≤72 h, easing to a 0.4 floor by 240 h.
 *  Shared by global NWP and the AI / ensemble-mean products. */
function longRangeDecay(leadHours: number): number {
  return leadHours <= 72 ? 1.0 : Math.max(0.4, 1 - ((leadHours - 72) / 168) * 0.6);
}

/** The lead-time decay *shape* for a model class, in [0, 1], ignoring the
 *  per-model archive cutoff. legacyModelWeight applies the maxLeadHours cutoff on
 *  top. */
export function leadFactorForKind(kind: ModelDef["kind"], leadHours: number): number {
  if (leadHours < 0) return 0;
  switch (kind) {
    case "regional-cam":
      // Full weight ≤24 h, linear → 0 by 60 h.
      if (leadHours <= 24) return 1;
      return Math.max(0, 1 - (leadHours - 24) / 36);
    case "regional-mid":
      // Full weight ≤48 h, linear → 0.3 by 120 h.
      if (leadHours <= 48) return 1;
      if (leadHours >= 120) return 0.3;
      return 1 - ((leadHours - 48) / 72) * 0.7;
    case "global":
      return longRangeDecay(leadHours);
    case "ai":
    case "ensemble-mean":
      // AI and ensemble-mean products are useful independent signals, but they
      // should not overwhelm the deterministic NWP aggregate with a full vote.
      // Kept at 0.75 of the global curve, as the superseded recipe had it.
      return 0.75 * longRangeDecay(leadHours);
  }
}

/** Per-model lead-time decay, in [0, 1]: the class-decay shape gated by the
 *  model's own archive cutoff. */
function leadFactor(model: ModelDef, leadHours: number): number {
  if (leadHours > model.maxLeadHours) return 0;
  return leadFactorForKind(model.kind, leadHours);
}

/** Variable-specific boost — CAMs get the descriptor table's `camBoost` (1.3 on
 *  precipitation, absent elsewhere); everything else is 1. */
function variableBoost(model: ModelDef, variable: Variable): number {
  if (model.kind !== "regional-cam") return 1;
  return VARIABLES[variable].camBoost ?? 1;
}

/** One model's blend weight under the pre-ADR-0011 heuristic recipe:
 *  `(1 + regionBonus) × leadFactor × variableBoost`. No trained/device
 *  multiplier — this is the heuristic default (experiment arm 0). */
export function legacyModelWeight(model: ModelDef, leadHours: number, lat: number, lon: number, variable: Variable): number {
  return (1 + regionBonus(model, lat, lon)) * leadFactor(model, leadHours) * variableBoost(model, variable);
}

/** Normalized weights (sum = 1) for the legacy recipe. Signature matches the
 *  production `normalizedWeights` (minus multipliers) so the verification
 *  aggregate can inject it as a drop-in weight function. Models whose raw weight
 *  is 0 are dropped — they don't cover this lead time. */
export function legacyNormalizedWeights(models: ModelDef[], leadHours: number, lat: number, lon: number, variable: Variable): Map<string, number> {
  const raw = new Map<string, number>();
  let total = 0;
  for (const m of models) {
    const w = legacyModelWeight(m, leadHours, lat, lon, variable);
    if (w > 0) {
      raw.set(m.id, w);
      total += w;
    }
  }
  if (total === 0) return raw;
  for (const [id, w] of raw) raw.set(id, w / total);
  return raw;
}
