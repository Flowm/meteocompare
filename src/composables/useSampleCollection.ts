import { computed, ref, shallowRef, type Ref } from "vue";

import { gatherRuns, planRuns } from "@/analysis/collectSample";
import type { RunEvaluation } from "@/analysis/runEvaluation";
import { aggregateSample, type LocationSample, type ModelSampleStats } from "@/analysis/sample";
import { loadSample, mergeRuns, sampleKey, saveSample } from "@/analysis/sampleStore";

import type { Location } from "./useLocation";

export interface SampleControls {
  durationDays: number;
  /** 1 → 00Z only; 4 → all cycles (00/06/12/18 Z). */
  cyclesPerDay: 1 | 4;
}

export interface UseSampleCollectionReturn {
  /** Successfully evaluated runs from the last gather (in-memory, not yet stored). */
  runs: Ref<RunEvaluation[]>;
  /** Per-model performance across `runs` (the multi-run view renders this). */
  stats: Ref<ModelSampleStats[]>;
  gathering: Ref<boolean>;
  progress: Ref<{ done: number; total: number }>;
  error: Ref<string | null>;
  /** Total runs now stored for the location after the last `store()`, else null. */
  storedCount: Ref<number | null>;
  gather: (controls: SampleControls) => Promise<void>;
  store: () => Promise<void>;
  cancel: () => void;
}

/** Drives the multi-run analysis mode: gather a location's runs over a window
 *  (explicit, abortable), then persist them on demand. `endDate` is the run-date
 *  window end (the analysis page reuses its date picker); `floorDate` is the
 *  archive retention floor. */
export function useSampleCollection(location: Ref<Location>, endDate: Ref<string>, floorDate: string): UseSampleCollectionReturn {
  // shallowRef, not ref: the gathered runs are immutable snapshots, replaced
  // wholesale on each gather. Keeping them non-reactive avoids deep-proxying
  // large objects and — crucially — lets IndexedDB structured-clone them on
  // store (a reactive Proxy throws DataCloneError).
  const runs = shallowRef<RunEvaluation[]>([]);
  const stats = computed<ModelSampleStats[]>(() => aggregateSample(runs.value));
  const gathering = ref(false);
  const progress = ref({ done: 0, total: 0 });
  const error = ref<string | null>(null);
  const storedCount = ref<number | null>(null);
  let controller: AbortController | null = null;

  async function gather(controls: SampleControls): Promise<void> {
    controller?.abort();
    controller = new AbortController();
    const { signal } = controller;
    gathering.value = true;
    error.value = null;
    storedCount.value = null;
    runs.value = [];
    const cycles = controls.cyclesPerDay === 4 ? [0, 6, 12, 18] : [0];
    const refs = planRuns({ endDate: endDate.value, durationDays: controls.durationDays, cycles, floorDate });
    progress.value = { done: 0, total: refs.length };
    try {
      const got = await gatherRuns(refs, {
        location: { latitude: location.value.latitude, longitude: location.value.longitude },
        signal,
        onProgress: (done, total) => {
          if (!signal.aborted) progress.value = { done, total };
        },
      });
      if (!signal.aborted) runs.value = got;
    } catch (e) {
      if (!signal.aborted) error.value = e instanceof Error ? e.message : String(e);
    } finally {
      // A superseded gather (its controller already aborted) must not flip the
      // flag for the gather that replaced it.
      if (!signal.aborted) gathering.value = false;
    }
  }

  async function store(): Promise<void> {
    if (!runs.value.length) return;
    error.value = null;
    try {
      const key = sampleKey(location.value.latitude, location.value.longitude);
      const existing = await loadSample(key);
      const merged = mergeRuns(existing?.runs ?? [], runs.value);
      const sample: LocationSample = {
        location: { latitude: location.value.latitude, longitude: location.value.longitude, name: location.value.name },
        runs: merged,
        gatheredAt: new Date().toISOString(),
      };
      await saveSample(key, sample);
      storedCount.value = merged.length;
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    }
  }

  function cancel(): void {
    controller?.abort();
    gathering.value = false;
  }

  return { runs, stats, gathering, progress, error, storedCount, gather, store, cancel };
}
