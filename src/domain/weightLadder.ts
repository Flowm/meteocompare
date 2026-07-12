// Fitted weight ladder (ADR 0011) — the parameterization + resolution that
// REPLACED the hand-tuned lead-time decay with fitted per-model, per-lead-band
// multipliers, organised as a ladder parallel to the calibration ladder
// (analysis/calibrationStore.resolveCalibration).
//
// WIRED IN (WP4): the shipping recipe weighting.modelWeight resolves its builtin
// tier here (resolveMultiplier over analysis/defaultWeights.DEFAULT_WEIGHTS), so
// the per-model, per-band offline fit (bandWeights.fitBuiltinSet) is the app's
// SOLE lead-time authority — there is no leadFactorForKind any more. The device
// tier stays per-model (pooled) multipliers (ADR 0011 rejected the per-band
// device tier), which modelWeight applies as a flat multiplier; ladderModelWeight
// below takes the full DeviceBandWeights shape that the offline fitting and tests
// exercise.
//
// The recipe is the "skeleton-free" one:
//   w = (1 + regionBonus) × variableBoost × resolveMultiplier(model, band, …)
// maxLeadHours cutoffs, regionBonus and variableBoost are out of scope of the
// fitted tiers and stay as modelWeight uses them. variableBoost lives here (not in
// weighting) so weighting can depend on this module without a cycle.

import { regionBonus, type ModelDef, type ModelKind } from "./models";
import { LEAD_BANDS, type LeadBand } from "./scorecard";
import { VARIABLES, type Variable } from "./variables";

/** Variable-specific boost — CAMs get a precipitation bonus. The per-variable
 *  factor comes from the descriptor table's `camBoost` (1.3 on precipitation +
 *  precipitation_probability, absent elsewhere). Shared by both the fitted ladder
 *  (ladderModelWeight) and the shipping recipe (weighting.modelWeight) so the two
 *  can't drift. */
export function variableBoost(model: ModelDef, variable: Variable): number {
  if (model.kind !== "regional-cam") return 1;
  return VARIABLES[variable].camBoost ?? 1;
}

/** Provenance for a shipped {@link BuiltinWeightSet}, mirroring
 *  defaultCalibration.ts's `DefaultCalibrationMeta` (ADR 0010): the caller
 *  supplies these — this module never reads the clock or randomness. */
export interface BuiltinWeightMeta {
  generatedAt: string;
  locations: string[];
  runDates: string[];
  /** The band partition the set was fitted against — recorded so a reader can
   *  detect a partition change against the current LEAD_BANDS (a slot-count or
   *  edge mismatch invalidates the fit, like calibration's length-tolerance). */
  bands: LeadBand[];
}

/** The shipped default weight tier (ADR 0011): fitted offline, pooled over
 *  reference locations — the weights sibling of `DEFAULT_CALIBRATION`. Two
 *  sub-tiers resolved per band: a per-model fit, and a per-class fallback for
 *  models the offline fit never saw (open-meteo archives a new model only from
 *  its addition date, so this window is structural). One slot per band; `null` =
 *  that (model|class, band) failed its data gate and inherits down the ladder. */
export interface BuiltinWeightSet {
  /** modelId → one multiplier slot per band (`null` = unfitted). */
  perModel: Record<string, (number | null)[]>;
  /** model class → one multiplier slot per band (`null` = unfitted). */
  perClass: Partial<Record<ModelKind, (number | null)[]>>;
  meta: BuiltinWeightMeta;
}

/** The device (per-location residual) tier: a pooled per-model multiplier plus
 *  optional per-band refinements. Fitted as residuals ON TOP of the builtin tier
 *  (the panels bake builtin into their base), so these values are centered on 1
 *  (ADR 0011: a band's deviation shrinks toward the model's pooled multiplier,
 *  which shrinks toward 1). `bands[id][b] = null` inherits the pooled value. */
export interface DeviceBandWeights {
  pooled: Record<string, number>;
  bands: Record<string, (number | null)[]>;
}

/** The band slot whose `[start, end)` contains `leadHours`; clamps above the
 *  last band (leads past the partition reuse its final slot, mirroring
 *  calibration.bandIndexFor). Accepts ANY partition, not just LEAD_BANDS — the
 *  experiment's per-day ablation arms pass a finer one. Bands are assumed
 *  contiguous and ascending (as LEAD_BANDS is). */
export function bandIndexFor(leadHours: number, bands: readonly LeadBand[] = LEAD_BANDS): number {
  for (let i = 0; i < bands.length; i++) {
    const band = bands[i];
    if (band && leadHours < band.end) return i;
  }
  return bands.length - 1;
}

/** Resolve one model's weight multiplier for one band, combining the two fitted
 *  ladder tiers. Each tier resolves independently and per band, with
 *  fall-through — a `null` slot drops to the next source FOR THAT BAND ONLY:
 *
 *    builtin: perModel[id][band] → perClass[kind][band] → 1
 *    device:  bands[id][band]    → pooled[id]           → 1
 *
 *  and the two resolved tiers multiply (ADR 0011's recipe:
 *  `× builtin[model][band] × device[model][band]`), so a device residual REFINES
 *  — never erases — the builtin default it was fitted on top of, and an absent
 *  tier contributes a neutral 1. This is what keeps "what we train == what we
 *  score" exact across the builtin/device boundary: the device panels bake
 *  `builtinResolved` into their base, fit a residual `m`, and here that same
 *  `builtinResolved × m` is reproduced. */
export function resolveMultiplier(modelId: string, kind: ModelKind, bandIndex: number, device?: DeviceBandWeights, builtin?: BuiltinWeightSet): number {
  const builtinResolved = builtin?.perModel[modelId]?.[bandIndex] ?? builtin?.perClass[kind]?.[bandIndex] ?? 1;
  const deviceResolved = device?.bands[modelId]?.[bandIndex] ?? device?.pooled[modelId] ?? 1;
  return builtinResolved * deviceResolved;
}

/** The ladder weight recipe (ADR 0011), the drop-in replacement for
 *  `weighting.modelWeight` once the gate passes. `(1 + regionBonus) ×
 *  variableBoost × resolveMultiplier`, gated to 0 beyond the model's archive
 *  cutoff and for negative leads. There is NO leadFactorForKind — the fitted
 *  multipliers are the sole lead-time authority. `bands` may be any partition
 *  (it only maps `leadHours` → band index); defaults to LEAD_BANDS. */
export function ladderModelWeight(
  model: ModelDef,
  leadHours: number,
  lat: number,
  lon: number,
  variable: Variable,
  device?: DeviceBandWeights,
  builtin?: BuiltinWeightSet,
  bands: readonly LeadBand[] = LEAD_BANDS,
): number {
  if (leadHours < 0 || leadHours > model.maxLeadHours) return 0;
  const base = 1 + regionBonus(model, lat, lon);
  const bandIndex = bandIndexFor(leadHours, bands);
  return base * variableBoost(model, variable) * resolveMultiplier(model.id, model.kind, bandIndex, device, builtin);
}
