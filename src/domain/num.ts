export const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

/** Mean of the finite values, skipping null/undefined/NaN; `0` when none are
 *  finite. The shared reduction behind verification's `meanFinite` (which
 *  re-exports it with its own domain doc — see there for what the empty-case 0
 *  means). */
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
