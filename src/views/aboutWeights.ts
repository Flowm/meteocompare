// Share-of-the-vote model for the About page's §02 default-weights diagram.
//
// The diagram answers one reader question — "whose voice does the aggregate
// listen to, and how does that change from day 1 to day 10?" — so it plots the
// NORMALISED share of the blend each model class commands per lead-time band,
// not the raw per-band multipliers (which are meaningless before normalisation).
//
// Shares are computed straight from the shipped machinery so the plot cannot
// drift from a refit: each band is read at its MIDPOINT lead, every registered
// model whose horizon reaches that lead resolves its exact production ladder
// multiplier (per-model → per-class → 1, via weightLadder.resolveMultiplier over
// DEFAULT_WEIGHTS), and the multipliers are summed by class and normalised.
//
// Simplifying assumptions vs. the live recipe `(1 + regionBonus) × variableBoost
// × builtin[model][band] × pooled` — stated in the figure caption, so the plot
// never claims to be the exact weights at the reader's location:
//   • no region bonus  (a location inside no model's home region),
//   • no precipitation boost  (variableBoost = 1),
//   • no device tier   (pooled = 1, i.e. no local training),
//   • the full roster available.
// Under those, a model's effective weight is exactly its resolved ladder
// multiplier, which is what this module normalises.

import { DEFAULT_WEIGHTS } from "@/analysis/defaultWeights";
import { MODELS, type ModelKind } from "@/domain/models";
import { LEAD_BANDS, type LeadBand } from "@/domain/scorecard";
import { bandIndexFor, resolveMultiplier } from "@/domain/weightLadder";

/** The class ordering the diagram stacks left→right: the short-range specialists
 *  (convection-allowing, then regional mid-res) sit on the left so their share
 *  visibly retreats toward the long-range bands, while the long-horizon models
 *  (global, AI, ensemble mean) hold the right. */
export const VOTE_KIND_ORDER: readonly ModelKind[] = ["regional-cam", "regional-mid", "global", "ai", "ensemble-mean"];

export interface ClassVote {
  /** Fraction of the band's total vote this class commands (0..1). */
  share: number;
  /** Registered models of this class present in the band. */
  count: number;
}

export interface BandVote {
  band: LeadBand;
  /** Representative lead hour the band is read at (its midpoint). */
  midLead: number;
  /** Total registered models present in the band (the roster shrinks with lead). */
  memberCount: number;
  byClass: Record<ModelKind, ClassVote>;
}

/** Per-band normalised vote share by model class, or `null` before any default
 *  fit has shipped (mirrors the old chart's empty-state guard). */
export function computeBandVotes(): BandVote[] | null {
  const builtin = DEFAULT_WEIGHTS;
  if (!builtin) return null;

  return LEAD_BANDS.map((band) => {
    const midLead = (band.start + band.end) / 2;
    const bandIndex = bandIndexFor(midLead);

    const weightByKind = new Map<ModelKind, number>();
    const countByKind = new Map<ModelKind, number>();
    let total = 0;

    for (const model of MODELS) {
      // Same horizon gate as weighting.modelWeight: a model contributes only
      // where its lead reaches. At the band midpoint this is exactly the
      // "covers the majority of the band" membership rule.
      if (midLead > model.maxLeadHours) continue;
      const mult = resolveMultiplier(model.id, model.kind, bandIndex, undefined, builtin);
      weightByKind.set(model.kind, (weightByKind.get(model.kind) ?? 0) + mult);
      countByKind.set(model.kind, (countByKind.get(model.kind) ?? 0) + 1);
      total += mult;
    }

    const byClass = Object.fromEntries(
      VOTE_KIND_ORDER.map((kind) => {
        const count = countByKind.get(kind) ?? 0;
        const weight = weightByKind.get(kind) ?? 0;
        return [kind, { share: total > 0 ? weight / total : 0, count }];
      }),
    ) as Record<ModelKind, ClassVote>;

    let memberCount = 0;
    for (const c of countByKind.values()) memberCount += c;

    return { band, midLead, memberCount, byClass };
  });
}
