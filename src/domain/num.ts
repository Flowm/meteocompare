// Small shared numeric helpers for the domain layer.

/** Clamp a value into the unit interval [0, 1]. */
export const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

/** Mean of the finite values, skipping null/undefined/NaN; `0` when none are
 *  finite. The shared reduction behind verification's `meanFinite` and
 *  predictability's `overallPredictability` — both re-export it with their own
 *  domain doc; see those for what the empty-case 0 means in each. */
export function meanFinite(values: readonly (number | null | undefined)[]): number {
  let sum = 0;
  let n = 0;
  for (const v of values) {
    if (v != null && Number.isFinite(v)) {
      sum += v;
      n += 1;
    }
  }
  return n === 0 ? 0 : sum / n;
}
