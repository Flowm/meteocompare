/** Persisted calculations must share this version. Bump it when weighting,
 *  verification, alignment, or calibration changes invalidate existing results.
 *  Versions through 2 predate the missing-truth and timezone corrections. */
export const ANALYSIS_VERSION = 3;
