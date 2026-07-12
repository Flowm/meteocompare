// Framework-free evaluation of a single forecast run against truth — the
// decoupled "analysis unit" (docs/plans/frontend-model-training.md, Phase 1).
// Given an already-fetched single-runs response and its ERA5-Seamless truth,
// it produces the aggregate + predictability hourly view-model, the per-day
// verification, the per-model scorecard, and the available-model set — with no
// Vue. useVerification is now a thin reactive wrapper over this, and the
// multi-run sampler (later phases) calls it per run.

import { extractHourly as extractTruthHourly, type HistoricalWeatherResponse } from "@/api/omHistoricalWeather";
import { extractHourlyByModel, type SingleRunsResponse } from "@/api/omSingleRuns";
import type { DataVarId, HourlySeries } from "@/composables/hourlySeries";
import { aggregateSeries } from "@/domain/aggregate";
import { aggregateVariables, type VarSpec } from "@/domain/aggregateVariables";
import { legacyNormalizedWeights } from "@/domain/legacyWeighting";
import { MODEL_IDS, MODELS, type ModelDef } from "@/domain/models";
import { buildModelScorecard, type ScorecardRow } from "@/domain/scorecard";
import { buildDailyVerification, VERIFIED_VARIABLES, type DailyVerification, type VerifiedVariable } from "@/domain/verification";

/** The aggregation specs for the verified-variable set, derived from the single
 *  domain source (`VERIFIED_VARIABLES`). Every verified variable is its own
 *  weighting family, and all plumbing below iterates the same list — adding a
 *  scored variable starts in domain/verification, not here. */
const VERIFY_VARS: readonly VarSpec<VerifiedVariable>[] = VERIFIED_VARIABLES.map((v) => ({ key: v, family: v }));

/** Build a `Record` keyed by the verified-variable set — the loop that replaced
 *  the per-variable hardcoding at every plumbing site below. */
function perVerifiedVariable<T>(build: (v: VerifiedVariable) => T): Record<VerifiedVariable, T> {
  return Object.fromEntries(VERIFIED_VARIABLES.map((v) => [v, build(v)])) as Record<VerifiedVariable, T>;
}

/** Conforms to the unified chart contract (HourlySeries) — temperature and
 *  precipitation only, the two variables we currently verify. ERA5-Seamless
 *  also provides wind and cloud-cover truth; scoring them is a later,
 *  data-only change (see CONTEXT.md "Truth"). */
export interface VerificationHourly extends HourlySeries {
  /** Per-hour aggregate per-variable predictability — input to the daily card's
   *  predictability-vs-error display. Keyed by variable id. */
  predictability: Partial<Record<DataVarId, number[]>>;
}

/** Everything one (location, run) yields once scored — self-identifying via
 *  `runDate` so a multi-run sample is just `RunEvaluation[]`. */
export interface RunEvaluation {
  runDate: string;
  /** Run cycle hour (00 / 06 / 12 / 18 Z). With runDate, the run's identity. */
  runHour: number;
  /** Displayed surfaces built from the DEFAULT-weight aggregate. Always present,
   *  so a stored sample (which carries no tuned data) has valid `hourly`/`daily`. */
  hourly: VerificationHourly;
  daily: DailyVerification[];
  /** The same two surfaces recomputed from the TUNED aggregate — present only
   *  when `tunedMultipliers` were supplied. A cheap pure recompute; the UI
   *  swaps to these when the "use trained weights" toggle is on (see
   *  useVerification). Optional + additive so every already-stored sample stays
   *  valid with no migration (record-versioned since Phase 2). */
  tunedHourly?: VerificationHourly;
  tunedDaily?: DailyVerification[];
  scorecard: ScorecardRow[];
  availableModels: ModelDef[];
}

export interface EvaluateRunInputs {
  runs: SingleRunsResponse;
  truth: HistoricalWeatherResponse;
  lat: number;
  lon: number;
  /** ISO local date of the run. */
  runDate: string;
  /** Run cycle hour (00 / 06 / 12 / 18 Z); defaults to 0. Identifies the run with runDate. */
  runHour?: number;
  /** When the location has stored tuned weights, additionally compute the
   *  tuned aggregate: as the "Aggregate (tuned)" scorecard row and as the
   *  optional `tunedHourly`/`tunedDaily` surfaces the UI can swap to. */
  tunedMultipliers?: Record<string, number>;
}

/** Score one fetched run against its truth. Returns null when the run carried no
 *  hours (nothing to align or score). */
export function evaluateRun({ runs, truth, lat, lon, runDate, runHour = 0, tunedMultipliers }: EvaluateRunInputs): RunEvaluation | null {
  const times = runs.hourly.time;
  const firstTime = times[0];
  if (!firstTime) return null;
  const baseTime = new Date(firstTime);

  // Per-model series straight off the single-runs response. Aggregate +
  // predictability via the shared pipeline; lead-time decay keys off baseTime.
  const perModel = perVerifiedVariable((v) => extractHourlyByModel(runs, v, MODEL_IDS));
  const { aggregate, predictability } = aggregateVariables({
    times,
    perModel,
    vars: VERIFY_VARS,
    models: MODELS,
    lat,
    lon,
    baseTime,
    cadence: "hourly",
  });

  // A second aggregate under the location's tuned weights (when stored): the
  // scorecard's "Aggregate (tuned)" row is built from it, and — when present —
  // so are the optional tunedHourly/tunedDaily surfaces below. The scorecard
  // always compares default vs tuned.
  const tuned = tunedMultipliers
    ? aggregateVariables({
        times,
        perModel,
        vars: VERIFY_VARS,
        models: MODELS,
        lat,
        lon,
        baseTime,
        cadence: "hourly",
        multipliers: tunedMultipliers,
      })
    : null;

  // Align truth to the run's time axis by ISO-string lookup; the two APIs can
  // return their hours offset by UTC-shift, which the map handles cleanly.
  const truthIndex = new Map<string, number>();
  truth.hourly.time.forEach((t, i) => truthIndex.set(t, i));
  const alignedTruth = perVerifiedVariable((v) => {
    const arr = extractTruthHourly(truth, v);
    return times.map((t): number | null => {
      const i = truthIndex.get(t);
      return i == null ? null : (arr[i] ?? null);
    });
  });

  // Build the hourly + daily surfaces for one aggregate pass. The default pass
  // always runs; the tuned pass runs only when tuned weights exist. perModel and
  // truth are shared references across both — only the aggregate + its
  // predictability differ. A cheap pure recompute, so the UI toggle swaps
  // precomputed surfaces instead of re-running the evaluation.
  const surfacesFor = (agg: typeof aggregate, pred: typeof predictability): { hourly: VerificationHourly; daily: DailyVerification[] } => ({
    hourly: {
      times,
      aggregate: agg,
      perModel,
      truth: alignedTruth,
      predictability: pred,
    },
    daily: buildDailyVerification({
      runDate,
      times,
      channels: perVerifiedVariable((v) => ({ aggregate: agg[v] ?? [], perModel: perModel[v] ?? {}, truth: alignedTruth[v], predictability: pred[v] ?? [] })),
    }),
  });

  const { hourly, daily } = surfacesFor(aggregate, predictability);
  const tunedSurfaces = tuned ? surfacesFor(tuned.aggregate, tuned.predictability) : null;

  // A third aggregate under the superseded pre-ADR-0011 heuristic recipe,
  // scored as the always-present "Aggregate (legacy)" comparator row. Reuses the
  // per-model series already extracted above — only the weight function differs
  // (injected here, so the production aggregate path never sees legacyWeighting).
  // Scorecard-only: no hourly/daily surfaces or predictability are built from it.
  const legacyAgg = perVerifiedVariable((v) => aggregateSeries(times, perModel[v] ?? {}, { variable: v, models: MODELS, lat, lon, baseTime, normalize: legacyNormalizedWeights }));

  // Scorecard: the default-weight aggregate row, a tuned row (when stored) for
  // the inline comparison, and the always-present legacy row.
  const tunedAgg = tuned?.aggregate;
  const scorecard = buildModelScorecard({
    times,
    channels: perVerifiedVariable((v) => ({ aggregate: aggregate[v] ?? [], perModel: perModel[v] ?? {}, truth: alignedTruth[v] })),
    tuned: tunedAgg ? perVerifiedVariable((v) => tunedAgg[v] ?? []) : undefined,
    legacy: legacyAgg,
  });

  return {
    runDate,
    runHour,
    hourly,
    daily,
    ...(tunedSurfaces ? { tunedHourly: tunedSurfaces.hourly, tunedDaily: tunedSurfaces.daily } : {}),
    scorecard,
    availableModels: availableModelsOf(runs),
  };
}

/** Models that returned a non-null value for at least one verified variable. */
function availableModelsOf(runs: SingleRunsResponse): ModelDef[] {
  const ids = new Set<string>();
  for (const id of MODEL_IDS) {
    const hasData = VERIFIED_VARIABLES.some((v) => runs.hourly[`${v}_${id}`]?.some((x) => x != null));
    if (hasData) ids.add(id);
  }
  return MODELS.filter((m) => ids.has(m.id));
}
