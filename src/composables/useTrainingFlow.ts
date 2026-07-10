// The training page's flow — load the location's stored sample, fit, persist,
// and keep the device-wide stored-weights inventory current. Extracted from
// TrainingView.vue so the transitions (stale-load guard, the fit→apply source
// check, reach edits, inventory ordering) are testable without a DOM; the view
// renders this state. Mirrors how useSampleCollection wraps collectSample.

import { computed, ref, watch, type ComputedRef, type Ref } from "vue";

import { calibrationPoints } from "@/analysis/calibrationSample";
import { refitPooledCalibration } from "@/analysis/calibrationStore";
import { fitWeights, MIN_TRAIN_RUNS, MIN_VAL_RUNS, type FitResult } from "@/analysis/learnedWeights";
import { clearWeightsByKey, listWeights, saveWeights, setReach, type StoredWeights, type WeightEntry } from "@/analysis/learnedWeightsStore";
import type { LocationSample } from "@/analysis/sample";
import { loadSample, sampleKey } from "@/analysis/sampleStore";
import { fitCalibrationSet } from "@/domain/calibration";

import type { Location } from "./useLocation";

/** Minimum stored runs before a fit is attempted (train + held-out validation). */
export const MIN_RUNS = MIN_TRAIN_RUNS + MIN_VAL_RUNS;

/** One row of the device-wide stored-weights inventory. */
export interface TrainedWeightsRow {
  key: string;
  name: string;
  detail?: string;
  latitude?: number;
  longitude?: number;
  trainedAt: string;
  improvement: number;
  radiusKm: number;
  /** Models whose weight was changed from the heuristic. */
  tuned: number;
  isCurrent: boolean;
}

export interface UseTrainingFlowReturn {
  sampleLoading: Ref<boolean>;
  result: Ref<FitResult | null>;
  training: Ref<boolean>;
  justSaved: Ref<boolean>;
  runCount: ComputedRef<number>;
  currentKey: ComputedRef<string>;
  /** The exact-cell stored weights for the current location, if any. */
  stored: ComputedRef<StoredWeights | null>;
  /** Device-wide stored-weights inventory, current location first then newest. */
  overview: ComputedRef<TrainedWeightsRow[]>;
  train: () => Promise<void>;
  apply: () => void;
  setEntryReach: (key: string, radiusKm: number) => void;
  removeEntry: (key: string) => void;
}

export function useTrainingFlow(current: Ref<Location>): UseTrainingFlowReturn {
  const sample = ref<LocationSample | null>(null);
  const sampleLoading = ref(false);
  const result = ref<FitResult | null>(null);
  const training = ref(false);
  const justSaved = ref(false);
  const entries = ref<WeightEntry[]>([]);

  const runCount = computed(() => sample.value?.runs.length ?? 0);
  const currentKey = computed(() => sampleKey(current.value.latitude, current.value.longitude));

  /** The exact-cell entry for the current location (a neighbour's reach never
   *  counts as "stored here" — only a fit trained at this cell does). */
  const stored = computed<StoredWeights | null>(() => entries.value.find((e) => e.key === currentKey.value)?.weights ?? null);

  const overview = computed<TrainedWeightsRow[]>(() =>
    entries.value
      .map((e) => {
        const loc = e.weights.location;
        return {
          key: e.key,
          name: loc?.name ?? e.key,
          detail: loc?.detail,
          latitude: loc?.latitude,
          longitude: loc?.longitude,
          trainedAt: e.weights.trainedAt,
          improvement: e.weights.improvement,
          radiusKm: e.weights.radiusKm ?? 0,
          tuned: Object.values(e.weights.multipliers).filter((m) => Math.abs(m - 1) > 1e-9).length,
          isCurrent: e.key === currentKey.value,
        };
      })
      .toSorted((a, b) => (a.isCurrent === b.isCurrent ? b.trainedAt.localeCompare(a.trainedAt) : a.isCurrent ? -1 : 1)),
  );

  function refreshEntries(): void {
    entries.value = listWeights();
  }

  async function reload(): Promise<void> {
    const lat = current.value.latitude;
    const lon = current.value.longitude;
    result.value = null;
    justSaved.value = false;
    refreshEntries();
    sampleLoading.value = true;
    const key = sampleKey(lat, lon);
    const loaded = await loadSample(key);
    // Ignore a stale load if the location changed while awaiting.
    if (sampleKey(current.value.latitude, current.value.longitude) === key) {
      sample.value = loaded;
      sampleLoading.value = false;
    }
  }
  watch(current, () => void reload(), { immediate: true });

  async function train(): Promise<void> {
    if (!sample.value) return;
    training.value = true;
    justSaved.value = false;
    await new Promise((r) => setTimeout(r, 16)); // let the spinner paint before the synchronous fit
    try {
      result.value = fitWeights(sample.value);
    } finally {
      training.value = false;
    }
  }

  function apply(): void {
    const r = result.value;
    if (!r?.ok) return;
    // Insurance against a location swap between fit and apply: the fit is tagged
    // with the sample's grid key, so never persist it under a different cell.
    if (r.sourceKey !== currentKey.value) return;
    const loc = current.value;
    const trainedAt = new Date().toISOString();
    // Preserve any reach already set for this location across re-fits.
    saveWeights(loc.latitude, loc.longitude, {
      multipliers: r.multipliers,
      trainedAt,
      improvement: r.improvement,
      location: { name: loc.name, detail: loc.detail, latitude: loc.latitude, longitude: loc.longitude },
      radiusKm: stored.value?.radiusKm ?? 0,
      // The calibration curves ride along with the weights (ADR 0008); bands
      // below the data gate stay null and resolve down the ladder at read time.
      calibration: fitCalibrationSet(calibrationPoints(sample.value?.runs ?? [])),
    });
    // Keep the device-pooled tier current too — fire-and-forget (IndexedDB read).
    void refitPooledCalibration(trainedAt);
    justSaved.value = true;
    refreshEntries();
  }

  function setEntryReach(key: string, radiusKm: number): void {
    setReach(key, radiusKm);
    refreshEntries();
  }

  function removeEntry(key: string): void {
    clearWeightsByKey(key);
    if (key === currentKey.value) justSaved.value = false;
    refreshEntries();
  }

  return { sampleLoading, result, training, justSaved, runCount, currentKey, stored, overview, train, apply, setEntryReach, removeEntry };
}
