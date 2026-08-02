// Shared formatting for the three scorecard surfaces — ModelScorecard,
// MultiRunScorecard and ModelTimingMatrix. Row labelling, accent colour and
// score tone are identical across all three; the unit-dependent value formatters
// are shared by the two tables. Split as a pure module plus a thin
// useUnits-wrapping composable so the call sites stay one-liners and the number
// formatting can't drift apart.

import { computed, type ComputedRef } from "vue";

import { convertDelta, convertVar, signed, useUnits } from "@/composables/useUnits";
import { getModel } from "@/domain/models";
import { AGGREGATE_LEGACY_ROW_ID, AGGREGATE_ROW_ID, AGGREGATE_TUNED_ROW_ID } from "@/domain/scorecard";

import { AGG_COLOR, paletteFor } from "./chartOption";

/** Whether the default-aggregate row must be qualified — true once any sibling
 *  aggregate (tuned or legacy) is present, so the default row can't claim the
 *  bare "Aggregate" that means the active weighting elsewhere (chart, forecast
 *  page). The verification page always carries the legacy row, so it always
 *  qualifies. */
export function aggregatesQualified(ids: readonly string[]): boolean {
  return ids.some((id) => id === AGGREGATE_TUNED_ROW_ID || id === AGGREGATE_LEGACY_ROW_ID);
}

/** Row label for a model id or an aggregate row. When a sibling aggregate is
 *  also present every aggregate row is qualified — "Aggregate (default)" /
 *  "(tuned)" / "(legacy)" — so neither the default row nor the comparators claim
 *  the bare "Aggregate". */
export function label(id: string, qualify: boolean): string {
  if (id === AGGREGATE_ROW_ID) return qualify ? "Aggregate (default)" : "Aggregate";
  if (id === AGGREGATE_TUNED_ROW_ID) return "Aggregate (tuned)";
  if (id === AGGREGATE_LEGACY_ROW_ID) return "Aggregate (legacy)";
  return getModel(id)?.label ?? id;
}

/** Swatch/accent colour for a row: the aggregate colour for aggregate rows,
 *  otherwise the model's palette colour. */
export function accent(id: string, isAggregate: boolean): string {
  return isAggregate ? AGG_COLOR : paletteFor(id);
}

/** 0–100 composite → text-colour tone, on the same high/mid/low thresholds
 *  (≥70 / ≥40) the predictability badge uses, so the colour language reads
 *  consistently across surfaces. */
export function scoreTone(c: number): string {
  if (!Number.isFinite(c)) return "text-paper-500";
  if (c >= 70) return "text-predictability-high";
  if (c >= 40) return "text-sodium-200";
  return "text-heat-300";
}

/** Composite score as a rounded integer, em-dash when unscorable. */
export function fmtScore(c: number): string {
  return Number.isFinite(c) ? String(Math.round(c)) : "—";
}

/** Timing (Critical Success Index) as a whole-percent, em-dash when NaN. */
export function fmtTiming(v: number): string {
  return Number.isFinite(v) ? `${Math.round(v * 100)}%` : "—";
}

/** The unit-dependent value formatters, closed over the live unit prefs so the
 *  scorecard call sites stay one-liners. Temperature MAE/bias are *deltas*
 *  (magnitudes/differences), so they convert with convertDelta — never
 *  convertVar, which would add the °F offset. */
export function useScorecardFormat(): {
  fmtTempMae: ComputedRef<(v: number) => string>;
  fmtTempBias: ComputedRef<(v: number) => string>;
  fmtAmount: ComputedRef<(v: number) => string>;
} {
  const { prefs } = useUnits();

  const fmtTempMae = computed(
    () =>
      (v: number): string =>
        Number.isFinite(v) ? convertDelta(v, "temperature_2m", prefs.value).toFixed(1) : "—",
  );
  const fmtTempBias = computed(
    () =>
      (v: number): string =>
        Number.isFinite(v) ? signed(convertDelta(v, "temperature_2m", prefs.value)) : "—",
  );
  const fmtAmount = computed(() => (v: number): string => {
    if (!Number.isFinite(v)) return "—";
    const x = convertVar(v, "precipitation", prefs.value);
    return x == null ? "—" : signed(x);
  });

  return { fmtTempMae, fmtTempBias, fmtAmount };
}
