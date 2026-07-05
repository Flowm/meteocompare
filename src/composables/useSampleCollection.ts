import { computed, ref, shallowRef, type Ref } from "vue";

import { gatherRuns, planRuns, type GatherDeps } from "@/analysis/collectSample";
import type { RunEvaluation } from "@/analysis/runEvaluation";
import { aggregateSample, type LocationSample, type ModelSampleStats } from "@/analysis/sample";
import { loadSample, mergeRuns, sampleKey, saveSample } from "@/analysis/sampleStore";

import { useAbortableTask } from "./useAbortableResource";
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
 *  archive retention floor. `deps` is injectable so the gather is testable
 *  without the network (see collectSample's GatherDeps). */
export function useSampleCollection(location: Ref<Location>, endDate: Ref<string>, floorDate: string, deps?: GatherDeps): UseSampleCollectionReturn {
  // shallowRef, not ref: the gathered runs are immutable snapshots, replaced
  // wholesale on each gather. Keeping them non-reactive avoids deep-proxying
  // large objects and — crucially — lets IndexedDB structured-clone them on
  // store (a reactive Proxy throws DataCloneError).
  const runs = shallowRef<RunEvaluation[]>([]);
  const stats = computed<ModelSampleStats[]>(() => aggregateSample(runs.value));
  const progress = ref({ done: 0, total: 0 });
  const storedCount = ref<number | null>(null);

  // The abort/superseded guard and the gathering/error flags live in the shared
  // task helper — `gathering` is its `running`. This composable adds only the
  // gather-specific state (runs, progress).
  const task = useAbortableTask();
  const gathering = task.running;
  const error = task.error;

  async function gather(controls: SampleControls): Promise<void> {
    storedCount.value = null;
    runs.value = [];
    const cycles = controls.cyclesPerDay === 4 ? [0, 6, 12, 18] : [0];
    const refs = planRuns({ endDate: endDate.value, durationDays: controls.durationDays, cycles, floorDate });
    // Reset progress to this gather's total up front, so a cancelled or
    // superseded prior gather can never leave a stale "4/30" reading on screen.
    progress.value = { done: 0, total: refs.length };
    await task.run(async (signal) => {
      const got = await gatherRuns(
        refs,
        {
          location: { latitude: location.value.latitude, longitude: location.value.longitude },
          signal,
          onProgress: (done, total) => {
            if (!signal.aborted) progress.value = { done, total };
          },
        },
        deps,
      );
      if (!signal.aborted) runs.value = got;
    });
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
    task.cancel();
    // Reset progress so the UI doesn't keep a stale mid-gather reading (e.g.
    // "4/30 fetched") after cancelling — the drift the hand-rolled cancel() had.
    progress.value = { done: 0, total: 0 };
  }

  return { runs, stats, gathering, progress, error, storedCount, gather, store, cancel };
}
