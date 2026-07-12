// Predictability calibration (ADR 0008): the pure math that turns a set of
// verified (raw predictability, calibration-hit) day outcomes into monotone
// per-variable, per-lead-band calibration curves, and applies a curve to a raw
// score. Everything here operates on plain points — extracting them from stored
// runs lives in analysis/calibrationSample.ts, persistence in the stores.
//
// Fit shape, sized for ~50–100 points per band (see the research digest in
// docs/research/predictability-calibration-literature.md): quantile bins of the
// raw score, per-bin hit rates Beta-smoothed toward the band's base rate, and
// PAVA across the bins for monotonicity. Raw-point isotonic regression is
// deliberately avoided — it overfits below ~1000 points.

import { clamp01 } from "./num";
import { LEAD_BANDS } from "./scorecard";
import type { VerifiedVariable } from "./verification";

/** Temperature calibration-hit tolerance: |daily t_max error| ≤ this (°C). */
export const TEMP_HIT_TOLERANCE_C = 2;

/** Wet-day threshold for the precipitation calibration hit (mm/day) — the
 *  WMO/ETCCDI wet-day definition, and deliberately far above ERA5's drizzle
 *  floor. Distinct from the hourly `WET_THRESHOLD_MM_PER_H` (timing scoring). */
export const WET_DAY_THRESHOLD_MM = 1;

/** Minimum outcomes in a (variable, lead band) before a curve is trusted.
 *  Below this the band stays null — the identity / raw-heuristic fallback.
 *  Sized against serial correlation of consecutive days (effective n is
 *  ~0.5–0.7× nominal). */
export const MIN_POINTS_PER_BAND = 50;

/** Strength of the per-bin shrink toward the band base rate, in pseudo-counts:
 *  `p̂ = (hits + K·base) / (n + K)`. A thin bin says little on its own. */
export const SMOOTHING_PSEUDOCOUNT = 4;

/** One verified day outcome: the raw score the aggregate showed, and whether
 *  the forecast verified "close enough" (a calibration hit — CONTEXT.md). */
export interface CalibrationPoint {
  variable: VerifiedVariable;
  /** Lead-hour anchor of the day (its window midpoint). */
  leadHours: number;
  /** Day-mean of the hourly raw predictability — the statistic stored samples
   *  carry, and therefore the statistic apply-time must feed back in. */
  raw: number;
  hit: boolean;
}

/** One fitted bin: the mean raw score of its points and the smoothed,
 *  monotonicity-adjusted hit rate. */
export interface CalibrationBinPoint {
  raw: number;
  p: number;
}

/** Where a curve's evidence came from — drives the UI's reference-class wording
 *  (ADR 0010). `device`: this device's own verification samples. `builtin`: the
 *  shipped default fitted from global reference locations. */
export type CalibrationSource = "device" | "builtin";

/** A fitted curve for one (variable, lead band): bins ascending in raw. */
export interface CalibrationCurve {
  bins: CalibrationBinPoint[];
  /** Outcomes the fit consumed — surfaced in UI copy ("from N verified days"). */
  n: number;
  /** Evidence provenance; absent = `device` (curves stored before ADR 0010). */
  source?: CalibrationSource;
}

/** Per-variable curves, one slot per `LEAD_BANDS` entry; null = below the data
 *  gate → identity fallback for that band. Sets fitted before a band was added
 *  are SHORTER than `LEAD_BANDS`; every reader indexes by `bandIndexFor`, so a
 *  missing trailing slot reads as `undefined` = the same identity fallback —
 *  length-tolerance is the migration (ADR 0011), no data rewrite needed. */
export interface VariableCalibration {
  bands: (CalibrationCurve | null)[];
}

export type CalibrationSet = Record<VerifiedVariable, VariableCalibration>;

/** The `LEAD_BANDS` slot a lead-hour anchor falls into; clamps below the first
 *  band and beyond the last (days past the last band reuse its curve). */
export function bandIndexFor(leadHours: number): number {
  for (let i = 0; i < LEAD_BANDS.length; i++) {
    const band = LEAD_BANDS[i];
    if (band && leadHours < band.end) return i;
  }
  return LEAD_BANDS.length - 1;
}

/** Weighted pool-adjacent-violators: smallest change to make `values`
 *  non-decreasing (each entry weighted). The classic isotonic step — but over
 *  ~5 smoothed bins, not raw points. */
function pava(values: readonly number[], weights: readonly number[]): number[] {
  // Blocks of pooled indices, merged whenever a violation appears.
  const blocks: { value: number; weight: number; count: number }[] = [];
  for (let i = 0; i < values.length; i++) {
    blocks.push({ value: values[i] ?? 0, weight: weights[i] ?? 0, count: 1 });
    while (blocks.length > 1) {
      const last = blocks[blocks.length - 1];
      const prev = blocks[blocks.length - 2];
      if (!last || !prev || prev.value <= last.value) break;
      const weight = prev.weight + last.weight;
      const value = weight > 0 ? (prev.value * prev.weight + last.value * last.weight) / weight : (prev.value + last.value) / 2;
      blocks.splice(blocks.length - 2, 2, { value, weight, count: prev.count + last.count });
    }
  }
  return blocks.flatMap((b) => Array.from({ length: b.count }, () => b.value));
}

/** Fit one (variable, band) curve from its outcomes, or null below the gate. */
function fitBand(points: readonly { raw: number; hit: boolean }[]): CalibrationCurve | null {
  const usable = points.filter((p) => Number.isFinite(p.raw));
  const n = usable.length;
  if (n < MIN_POINTS_PER_BAND) return null;

  const sorted = usable.toSorted((a, b) => a.raw - b.raw);
  const baseRate = sorted.filter((p) => p.hit).length / n;
  const binCount = n >= 100 ? 5 : 4;

  const rawBins: { raw: number; p: number; weight: number }[] = [];
  for (let b = 0; b < binCount; b++) {
    // Quantile split: contiguous slices of the sorted points, sizes as equal
    // as integer division allows.
    const start = Math.floor((b * n) / binCount);
    const end = Math.floor(((b + 1) * n) / binCount);
    const slice = sorted.slice(start, end);
    if (slice.length === 0) continue;
    const hits = slice.filter((p) => p.hit).length;
    rawBins.push({
      raw: slice.reduce((s, p) => s + p.raw, 0) / slice.length,
      p: (hits + SMOOTHING_PSEUDOCOUNT * baseRate) / (slice.length + SMOOTHING_PSEUDOCOUNT),
      weight: slice.length,
    });
  }

  const monotone = pava(
    rawBins.map((b) => b.p),
    rawBins.map((b) => b.weight),
  );
  return { bins: rawBins.map((b, i) => ({ raw: b.raw, p: clamp01(monotone[i] ?? b.p) })), n };
}

/** Fit the full curve set from verified day outcomes. Every (variable, band)
 *  below the data gate is null — the identity fallback, so a sparse sample
 *  degrades gracefully instead of producing a confident lie. `source` stamps
 *  the curves' provenance (defaults to device — the ADR 0010 builtin fit is
 *  the one caller that differs). */
export function fitCalibrationSet(
  points: readonly CalibrationPoint[],
  variables: readonly VerifiedVariable[] = ["temperature_2m", "precipitation"],
  source?: CalibrationSource,
): CalibrationSet {
  const set = {} as CalibrationSet;
  for (const variable of variables) {
    const bands = LEAD_BANDS.map((_, bandIndex) => {
      const curve = fitBand(points.filter((p) => p.variable === variable && bandIndexFor(p.leadHours) === bandIndex));
      // fitBand returns a fresh object, so stamping in place is safe (and keeps
      // the no-map-spread lint quiet).
      if (curve && source) curve.source = source;
      return curve;
    });
    set[variable] = { bands };
  }
  return set;
}

/** Map a raw score through the resolved curve: linear interpolation between bin
 *  centers, clamped flat beyond the ends. Identity when no curve applies — the
 *  raw heuristic IS the fallback (ADR 0008), so callers never branch. */
export function applyCalibration(set: CalibrationSet | null | undefined, variable: VerifiedVariable, leadHours: number, raw: number): number {
  if (!Number.isFinite(raw)) return raw;
  const curve = set?.[variable]?.bands[bandIndexFor(leadHours)];
  if (!curve || curve.bins.length === 0) return raw;

  const bins = curve.bins;
  const first = bins[0];
  const last = bins[bins.length - 1];
  if (!first || !last) return raw;
  if (raw <= first.raw) return first.p;
  if (raw >= last.raw) return last.p;
  for (let i = 1; i < bins.length; i++) {
    const lo = bins[i - 1];
    const hi = bins[i];
    if (!lo || !hi || raw > hi.raw) continue;
    // Degenerate segment (duplicate centers, e.g. a spike of identical raw
    // scores): take the later bin rather than divide by zero.
    if (hi.raw - lo.raw < 1e-9) return hi.p;
    const t = (raw - lo.raw) / (hi.raw - lo.raw);
    return clamp01(lo.p + t * (hi.p - lo.p));
  }
  return last.p;
}

/** True when a curve exists for this (variable, band) — i.e. the published
 *  value is a calibrated frequency, not the raw heuristic. Drives tier scale
 *  and tooltip copy (ADR 0008). */
export function isCalibrated(set: CalibrationSet | null | undefined, variable: VerifiedVariable, leadHours: number): boolean {
  return calibrationSource(set, variable, leadHours) !== null;
}

/** The provenance of the curve that would calibrate this (variable, band), or
 *  null when none does (raw heuristic). Absence on the curve means `device` —
 *  curves stored before provenance existed. */
export function calibrationSource(set: CalibrationSet | null | undefined, variable: VerifiedVariable, leadHours: number): CalibrationSource | null {
  const curve = set?.[variable]?.bands[bandIndexFor(leadHours)];
  if (!curve || curve.bins.length === 0) return null;
  return curve.source ?? "device";
}
