// Per-model scorecard. Scores each model (and the aggregate, as a ranked
// reference row) over the FULL run window — distinct from the daily breakdown,
// which scores only the aggregate per 24 h day. Reuses the pure stat primitives
// in verification.ts; the only new ideas here are the fixed-scale 0..100
// composite and the lead-time-band breakdown.
//
// The composite methodology — fixed per-variable reference anchors, equal
// per-metric weights, coverage-fair normalisation — is documented in
// docs/adr/0004-per-model-composite-score.md.

import { type AggregatePoint } from "./aggregate";
import { clamp01 } from "./num";
import { bias, classifyHours, coveredPrecipSums, HOURS_PER_DAY, mae, timingScore, type HourClassification, type VerifiedVariable, type VerifyChannel } from "./verification";

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

export interface LeadBand {
  label: string;
  /** Inclusive start lead hour. */
  start: number;
  /** Exclusive end lead hour. */
  end: number;
}

/** Coarse bands for the per-model skill-decay-over-lead-time breakdown. The
 *  7–10d band exists because the forecast page shows 240 h and the fitted
 *  weight multipliers must cover it (ADR 0011); only the long-range models
 *  reach it, so its scorecard column is mostly a coverage gap. */
export const LEAD_BANDS: readonly LeadBand[] = [
  { label: "0–2d", start: 0, end: 48 },
  { label: "2–4d", start: 48, end: 96 },
  { label: "4–7d", start: 96, end: 168 },
  { label: "7–10d", start: 168, end: 240 },
];

/** Sentinel id used for the aggregate's row (it is not a Model — CONTEXT.md). */
export const AGGREGATE_ROW_ID = "__aggregate__";

/** Sentinel id for the optional second aggregate row computed with the location's
 *  tuned weights (training page), shown alongside the default-weight aggregate. */
export const AGGREGATE_TUNED_ROW_ID = "__aggregate_tuned__";

/** Sentinel id for the aggregate row computed with the superseded pre-ADR-0011
 *  heuristic recipe (domain/legacyWeighting), always shown on the verification
 *  page as a comparator against the shipping fitted-ladder aggregate. */
export const AGGREGATE_LEGACY_ROW_ID = "__aggregate_legacy__";

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
  /** One channel per verified variable (aggregate + per-model + truth). A
   *  channel aggregate point's `value` is already `number | null` (null = no
   *  contributing models), read straight through. No predictability: it is
   *  defined only over the aggregate and the scorecard carries none (CONTEXT.md
   *  "Per-model scorecard"). */
  channels: Record<VerifiedVariable, VerifyChannel>;
  /** Optional second aggregate per variable computed with the location's tuned
   *  weights — when present, scored as an extra "Aggregate (tuned)" row for
   *  comparison against the default-weight aggregate. */
  tuned?: Record<VerifiedVariable, readonly AggregatePoint[]>;
  /** Optional aggregate per variable computed with the superseded pre-ADR-0011
   *  heuristic weights (domain/legacyWeighting) — scored as an extra
   *  "Aggregate (legacy)" comparator row. Mirrors `tuned`, but the verification
   *  page always supplies it (no stored weights needed). */
  legacy?: Record<VerifiedVariable, readonly AggregatePoint[]>;
}

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
  // Coverage-aligned: truth summed only over hours the forecast covers, so a
  // model that drops out isn't charged for the rain it never forecast.
  const { forecastSum, truthSum } = coveredPrecipSums(fPrecip, tPrecip);
  const amountError = anyPrecip ? forecastSum - truthSum : NaN;
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
  // Scoring is deliberately per-variable-specific: read each channel by its
  // known key, don't genericise.
  const temp = input.channels.temperature_2m;
  const precip = input.channels.precipitation;
  const truthTemp = temp.truth.slice(0, n);
  const truthPrecip = precip.truth.slice(0, n);

  const rows: ScorecardRow[] = [];

  const modelIds = new Set<string>([...Object.keys(temp.perModel), ...Object.keys(precip.perModel)]);
  for (const id of modelIds) {
    const fTemp = (temp.perModel[id] ?? []).slice(0, n);
    const fPrecip = (precip.perModel[id] ?? []).slice(0, n);
    rows.push(buildRow(id, false, fTemp, fPrecip, truthTemp, truthPrecip, n));
  }

  const aggTemp = temp.aggregate.slice(0, n).map((p) => p.value);
  const aggPrecip = precip.aggregate.slice(0, n).map((p) => p.value);
  rows.push(buildRow(AGGREGATE_ROW_ID, true, aggTemp, aggPrecip, truthTemp, truthPrecip, n));

  if (input.tuned) {
    const tunedTemp = input.tuned.temperature_2m.slice(0, n).map((p) => p.value);
    const tunedPrecip = input.tuned.precipitation.slice(0, n).map((p) => p.value);
    rows.push(buildRow(AGGREGATE_TUNED_ROW_ID, true, tunedTemp, tunedPrecip, truthTemp, truthPrecip, n));
  }

  if (input.legacy) {
    const legacyTemp = input.legacy.temperature_2m.slice(0, n).map((p) => p.value);
    const legacyPrecip = input.legacy.precipitation.slice(0, n).map((p) => p.value);
    rows.push(buildRow(AGGREGATE_LEGACY_ROW_ID, true, legacyTemp, legacyPrecip, truthTemp, truthPrecip, n));
  }

  rows.sort((a, b) => rankKey(b.overall.composite) - rankKey(a.overall.composite));
  return rows;
}
