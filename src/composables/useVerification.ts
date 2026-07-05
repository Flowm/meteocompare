import { computed, type Ref } from "vue";

import { loadWeights } from "@/analysis/learnedWeightsStore";
import { evaluateRun, type RunEvaluation, type VerificationHourly } from "@/analysis/runEvaluation";
import { extractSolar, fetchHistoricalWeather } from "@/api/omHistoricalWeather";
import { fetchSingleRuns } from "@/api/omSingleRuns";
import type { ModelDef } from "@/domain/models";
import type { ScorecardRow } from "@/domain/scorecard";
import type { DailyVerification } from "@/domain/verification";
import { addDaysIso } from "@/utils/date";

import { useAbortableResource } from "./useAbortableResource";
import { useApiKey } from "./useApiKey";
import type { Location } from "./useLocation";
import { useSettings } from "./useSettings";

/** Re-exported from the framework-free analysis layer, where the run evaluation
 *  is now computed (see `@/analysis/runEvaluation`). */
export type { VerificationHourly };

export interface UseVerificationReturn {
  loading: Ref<boolean>;
  error: Ref<string | null>;
  hourly: Ref<VerificationHourly | null>;
  daily: Ref<DailyVerification[] | null>;
  /** Per-model (+ aggregate) full-window scores, sorted by Overall composite.
   *  The per-model lens of the verification page — see CONTEXT.md "Per-model
   *  scorecard". Distinct from `daily`, which scores only the aggregate per day. */
  scorecard: Ref<ScorecardRow[] | null>;
  /** Subset of MODELS that returned non-null data (temp or precip) for this run date. */
  availableModels: Ref<ModelDef[]>;
  /** Sunrise/sunset (astronomical, location-local) for the chart's day/night
   *  shading. Null until the single-runs response lands. */
  solar: Ref<{ sunrise: string[]; sunset: string[] } | null>;
  refresh: () => Promise<void>;
}

export function useVerification(location: Ref<Location>, runDate: Ref<string>, runCycle: Ref<number>): UseVerificationReturn {
  const { useTrainedWeights } = useSettings();
  // The commercial API key switches which host both requests hit, so it joins
  // location + runDate as a fetch dependency (flipping it refetches the run).
  const { apiKey } = useApiKey();
  // The runs + truth pair is fetched together (so a superseded date/location
  // change aborts both); the helper owns the abort + superseded-loading guard.
  const { data, loading, error, refresh } = useAbortableResource(
    async (signal) => {
      // Fetch truth with a 1-day-wider window than the forecast's 7 days so the
      // TZ-shifted forecast window is fully covered regardless of UTC offset.
      const truthEndDate = addDaysIso(runDate.value, 7);
      const [runs, truth] = await Promise.all([
        fetchSingleRuns({ lat: location.value.latitude, lon: location.value.longitude, runDate: runDate.value, runHour: runCycle.value }, { signal }),
        fetchHistoricalWeather({ lat: location.value.latitude, lon: location.value.longitude, startDate: runDate.value, endDate: truthEndDate }, signal),
      ]);
      return { runs, truth };
    },
    () => [location.value.latitude, location.value.longitude, runDate.value, runCycle.value, apiKey.value],
  );

  // All scoring lives in the framework-free analysis layer now; the composable
  // just feeds it the fetched pair and slices the result into reactive refs.
  // The evaluation no longer depends on the toggle: it always builds the
  // default surfaces and, when tuned weights exist, the tuned ones alongside.
  const evaluation = computed<RunEvaluation | null>(() => {
    const runs = data.value?.runs;
    const truth = data.value?.truth;
    if (!runs || !truth) return null;
    // Compute a default-vs-tuned comparison whenever this location has stored
    // trained weights — independent of the live "use trained weights" toggle.
    const tunedMultipliers = loadWeights(location.value.latitude, location.value.longitude)?.multipliers;
    return evaluateRun({
      runs,
      truth,
      lat: location.value.latitude,
      lon: location.value.longitude,
      runDate: runDate.value,
      runHour: runCycle.value,
      tunedMultipliers,
    });
  });

  // The toggle mirrors the live forecast: when it's on and tuned surfaces exist,
  // the chart + daily cards draw the tuned aggregate; otherwise the default one.
  // Flipping the toggle now swaps precomputed surfaces — no re-evaluation. The
  // scorecard exposes both rows regardless, so it never reads the toggle.
  const useTuned = computed(() => useTrainedWeights.value && evaluation.value?.tunedHourly != null);
  const hourly = computed<VerificationHourly | null>(() => {
    const ev = evaluation.value;
    if (!ev) return null;
    return useTuned.value && ev.tunedHourly ? ev.tunedHourly : ev.hourly;
  });
  const daily = computed<DailyVerification[] | null>(() => {
    const ev = evaluation.value;
    if (!ev) return null;
    return useTuned.value && ev.tunedDaily ? ev.tunedDaily : ev.daily;
  });
  const scorecard = computed<ScorecardRow[] | null>(() => evaluation.value?.scorecard ?? null);
  const availableModels = computed<ModelDef[]>(() => evaluation.value?.availableModels ?? []);
  // Sunrise/sunset ride along on the truth (archive) response — single-runs
  // can't serve daily solar under our run-cycle timezone (see omSingleRuns).
  const solar = computed(() => (data.value?.truth ? extractSolar(data.value.truth) : null));

  return { loading, error, hourly, daily, scorecard, availableModels, solar, refresh };
}
