/** Persisted calculations must share this version. Bump it when weighting,
 *  verification, alignment, or calibration changes invalidate existing results.
 *  Versions through 2 predate the truth corrections; version 3 used stale builtins. */
export const ANALYSIS_VERSION = 4;

/** Old and unknown recipes cannot supply current fitted defaults. */
export function currentAnalysis<T>(data: T, version: number | undefined): T | null {
  return version === ANALYSIS_VERSION ? data : null;
}
