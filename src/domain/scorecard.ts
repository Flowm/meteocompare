// Per-model scorecard. Scores each model (and the aggregate, as a ranked
// reference row) over the FULL run window — distinct from the daily breakdown,
// which scores only the aggregate per 24 h day. Reuses the pure stat primitives
// in verification.ts; the only new ideas here are the fixed-scale 0..100
// composite and the lead-time-band breakdown.
//
// The composite methodology — fixed per-variable reference anchors, equal
// per-metric weights, coverage-fair normalisation — is documented in
// docs/adr/0004-per-model-composite-score.md.

import { aggregateValue, type AggregatePoint } from "./aggregate";
import { bias, classifyHours, mae, sumNonNull, timingScore, type HourClassification } from "./verification";

// ---------------------------------------------------------------------------
// Fixed reference scales + weights (tunable — see ADR 0004)
// ---------------------------------------------------------------------------

/** Temperature MAE (°C) at which the goodness term hits 0. Mirrors the
 *  educated-guess "typical spread" anchors in predictability.ts. */
export const TEMP_MAE_REF_BAD = 5;

/** |amount error| per covered day (mm/day) at which the goodness term hits 0.
 *  Per-day so the anchor is independent of window length and of coverage. */
export const AMOUNT_REF_BAD_PER_DAY = 5;

/** Equal-per-metric blend weights. Precipitation has two of the three metrics,
 *  so the composite leans ~⅔ precip — a deliberate, documented choice. The
 *  blend renormalises over whichever metrics are scorable in a given scope, so
 *  the absolute magnitudes only matter relative to each other. */
export const COMPOSITE_WEIGHTS = { tempMae: 1 / 3, amountError: 1 / 3, timingScore: 1 / 3 } as const;

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

const HOURS_PER_DAY = 24;

// ---------------------------------------------------------------------------
// Lead-time bands
// ---------------------------------------------------------------------------

export interface LeadBand {
  label: string;
  /** Inclusive start lead hour. */
  start: number;
  /** Exclusive end lead hour. */
  end: number;
}

/** Coarse bands for the per-model skill-decay-over-lead-time trio. */
export const LEAD_BANDS: readonly LeadBand[] = [
  { label: "0–2d", start: 0, end: 48 },
  { label: "2–4d", start: 48, end: 96 },
  { label: "4–7d", start: 96, end: 168 },
];

/** Sentinel id used for the aggregate's row (it is not a Model — CONTEXT.md). */
export const AGGREGATE_ROW_ID = "__aggregate__";

/** Sentinel id for the optional second aggregate row computed with the location's
 *  tuned weights (training page), shown alongside the default-weight aggregate. */
export const AGGREGATE_TUNED_ROW_ID = "__aggregate_tuned__";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScorecardMetrics {
  /** Signed temperature bias (°C); `NaN` when no overlapping pair exists. */
  tempBias: number;
  /** Temperature MAE (°C); `NaN` when no overlapping pair exists. */
  tempMae: number;
  /** Signed precip amount error (forecast − truth sum, mm); `NaN` when the
   *  forecast carried no precipitation data in scope. */
  amountError: number;
  /** Timing skill, Critical Success Index hits/(hits+misses+false_alarms);
   *  `NaN` only when nothing happened on either side (all correct-dry). */
  timingScore: number;
  /** 0..100 blend of the scorable goodness terms; `NaN` when none are scorable. */
  composite: number;
}

export interface ScorecardRow {
  /** Model id, or `AGGREGATE_ROW_ID`. */
  id: string;
  isAggregate: boolean;
  /** Full-window metrics + composite. */
  overall: ScorecardMetrics;
  /** Composite per `LEAD_BANDS` entry; `null` when that band has no data. */
  bandComposites: (number | null)[];
  /** Hours with a non-null forecast value (temp or precip) in the window. */
  coveredHours: number;
  /** Window length in hours. */
  totalHours: number;
  /** `true` when the entity does not cover the full window. */
  partial: boolean;
  /** Full-window per-hour precip classification — drives the timing matrix. */
  hourlyClassification: HourClassification[];
}

export interface ScorecardInput {
  /** Lead-hour axis covering the full window (e.g. 168 entries). */
  times: readonly string[];
  /** Aggregate forecast points; the `NaN` "no contributing models" sentinel is
   *  mapped back to `null` (same convention as verification.ts). */
  aggregateTemp: readonly AggregatePoint[];
  aggregatePrecip: readonly AggregatePoint[];
  /** Optional second aggregate computed with the location's tuned weights — when
   *  present, scored as an extra "Aggregate (tuned)" row for comparison. */
  tunedAggregateTemp?: readonly AggregatePoint[];
  tunedAggregatePrecip?: readonly AggregatePoint[];
  /** Per-model raw hourly forecast values, keyed by model id. */
  perModelTemp: Readonly<Record<string, readonly (number | null)[]>>;
  perModelPrecip: Readonly<Record<string, readonly (number | null)[]>>;
  /** ERA5-Seamless truth, one entry per hour. */
  truthTemp: readonly (number | null)[];
  truthPrecip: readonly (number | null)[];
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/** Score one scope (full window or a band slice) into metrics + composite.
 *  Each metric maps to a 0..1 goodness; the composite blends only the metrics
 *  that are scorable in the scope, renormalising the weights accordingly:
 *  - temperature drops out when the entity has no temp data in scope,
 *  - amount + timing drop out when there is no precip data,
 *  - timing alone drops out on a dry scope (no truth-wet hours) while amount
 *    still penalises false precipitation. */
export function scoreScope(
  fTemp: readonly (number | null)[],
  tTemp: readonly (number | null)[],
  fPrecip: readonly (number | null)[],
  tPrecip: readonly (number | null)[],
): ScorecardMetrics {
  const tempBias = bias(fTemp, tTemp);
  const tempMae = mae(fTemp, tTemp);

  const anyPrecip = fPrecip.some((v) => v != null);
  const amountError = anyPrecip ? sumNonNull(fPrecip) - sumNonNull(tPrecip) : NaN;
  const thr = anyPrecip ? timingScore(classifyHours(fPrecip, tPrecip)) : NaN;

  const terms: Array<{ w: number; g: number }> = [];
  if (Number.isFinite(tempMae)) {
    terms.push({ w: COMPOSITE_WEIGHTS.tempMae, g: clamp01(1 - tempMae / TEMP_MAE_REF_BAD) });
  }
  if (Number.isFinite(amountError)) {
    // Normalise the summed error by covered precip-days so coverage and window
    // length don't distort it (a 48 h model isn't credited for the dry hours it
    // never forecast).
    const coveredDays = fPrecip.filter((v) => v != null).length / HOURS_PER_DAY;
    const perDay = coveredDays > 0 ? Math.abs(amountError) / coveredDays : Math.abs(amountError);
    terms.push({ w: COMPOSITE_WEIGHTS.amountError, g: clamp01(1 - perDay / AMOUNT_REF_BAD_PER_DAY) });
  }
  if (Number.isFinite(thr)) {
    terms.push({ w: COMPOSITE_WEIGHTS.timingScore, g: thr });
  }

  const wsum = terms.reduce((s, t) => s + t.w, 0);
  const composite = wsum === 0 ? NaN : (terms.reduce((s, t) => s + t.w * t.g, 0) / wsum) * 100;

  return { tempBias, tempMae, amountError, timingScore: thr, composite };
}

function buildRow(
  id: string,
  isAggregate: boolean,
  fTemp: readonly (number | null)[],
  fPrecip: readonly (number | null)[],
  tTemp: readonly (number | null)[],
  tPrecip: readonly (number | null)[],
  n: number,
): ScorecardRow {
  const overall = scoreScope(fTemp, tTemp, fPrecip, tPrecip);

  const bandComposites = LEAD_BANDS.map((b) => {
    const start = b.start;
    const end = Math.min(b.end, n);
    if (end <= start) return null;
    const m = scoreScope(fTemp.slice(start, end), tTemp.slice(start, end), fPrecip.slice(start, end), tPrecip.slice(start, end));
    return Number.isFinite(m.composite) ? m.composite : null;
  });

  let coveredHours = 0;
  for (let i = 0; i < n; i++) if (fTemp[i] != null || fPrecip[i] != null) coveredHours += 1;

  return {
    id,
    isAggregate,
    overall,
    bandComposites,
    coveredHours,
    totalHours: n,
    partial: coveredHours < n,
    hourlyClassification: classifyHours(fPrecip, tPrecip),
  };
}

const rankKey = (c: number): number => (Number.isFinite(c) ? c : -Infinity);

/** Build one scorecard row per model plus the aggregate, sorted by Overall
 *  composite (best first; unscorable rows sink). The aggregate is ranked inline
 *  like a model — the UI marks it distinctly (CONTEXT.md: it is not a Model). */
export function buildModelScorecard(input: ScorecardInput): ScorecardRow[] {
  const n = input.times.length;
  const truthTemp = input.truthTemp.slice(0, n);
  const truthPrecip = input.truthPrecip.slice(0, n);

  const rows: ScorecardRow[] = [];

  const modelIds = new Set<string>([...Object.keys(input.perModelTemp), ...Object.keys(input.perModelPrecip)]);
  for (const id of modelIds) {
    const fTemp = (input.perModelTemp[id] ?? []).slice(0, n);
    const fPrecip = (input.perModelPrecip[id] ?? []).slice(0, n);
    rows.push(buildRow(id, false, fTemp, fPrecip, truthTemp, truthPrecip, n));
  }

  const aggTemp = input.aggregateTemp.slice(0, n).map(aggregateValue);
  const aggPrecip = input.aggregatePrecip.slice(0, n).map(aggregateValue);
  rows.push(buildRow(AGGREGATE_ROW_ID, true, aggTemp, aggPrecip, truthTemp, truthPrecip, n));

  if (input.tunedAggregateTemp && input.tunedAggregatePrecip) {
    const tunedTemp = input.tunedAggregateTemp.slice(0, n).map(aggregateValue);
    const tunedPrecip = input.tunedAggregatePrecip.slice(0, n).map(aggregateValue);
    rows.push(buildRow(AGGREGATE_TUNED_ROW_ID, true, tunedTemp, tunedPrecip, truthTemp, truthPrecip, n));
  }

  rows.sort((a, b) => rankKey(b.overall.composite) - rankKey(a.overall.composite));
  return rows;
}
