// Gather a location's runs across a window for the multi-run analysis mode.
// `planRuns` is pure (enumerates which runs to fetch); `gatherRuns` runs the
// fetch + evaluate pipeline with a concurrency cap, abort support, and progress.
// Deps are injectable so the orchestration is testable without the network.

import { fetchHistoricalWeather } from "@/api/omHistoricalWeather";
import { ARCHIVED_MODEL_IDS, fetchSingleRuns } from "@/api/omSingleRuns";
import { addDaysIso } from "@/utils/date";

import { evaluateRun, type RunEvaluation } from "./runEvaluation";

export interface RunRef {
  runDate: string;
  runHour: number;
}

export interface PlanOptions {
  /** Most recent run date to include (ISO date, inclusive). */
  endDate: string;
  /** Days back from `endDate` to include (inclusive of `endDate`). */
  durationDays: number;
  /** Cycles to sample per day: `[0]` (single) or `[0, 6, 12, 18]` (multiple). */
  cycles: readonly number[];
  /** Oldest date allowed — the single-runs archive retention floor. */
  floorDate: string;
}

/** Enumerate the runs to gather, newest day first, bounded by the retention floor. */
export function planRuns(opts: PlanOptions): RunRef[] {
  const refs: RunRef[] = [];
  for (let d = 0; d < opts.durationDays; d++) {
    const runDate = addDaysIso(opts.endDate, -d);
    if (runDate < opts.floorDate) break;
    for (const runHour of opts.cycles) refs.push({ runDate, runHour });
  }
  return refs;
}

export interface GatherDeps {
  fetchRuns: typeof fetchSingleRuns;
  fetchTruth: typeof fetchHistoricalWeather;
  evaluate: typeof evaluateRun;
}

const DEFAULT_DEPS: GatherDeps = { fetchRuns: fetchSingleRuns, fetchTruth: fetchHistoricalWeather, evaluate: evaluateRun };

export interface GatherOptions {
  location: { latitude: number; longitude: number };
  /** Max concurrent fetches; defaults to 3 (polite to open-meteo, reuses the SW cache). */
  concurrency?: number;
  signal?: AbortSignal;
  /** Called after each run settles, with the count done and the total. */
  onProgress?: (done: number, total: number) => void;
}

/** Fetch + evaluate every planned run, capped at `concurrency` in flight. A run
 *  that fails (e.g. every model aged out of the archive) is skipped, not fatal.
 *  Returns the successful evaluations; order is not guaranteed. */
export async function gatherRuns(refs: readonly RunRef[], opts: GatherOptions, deps: GatherDeps = DEFAULT_DEPS): Promise<RunEvaluation[]> {
  const { latitude: lat, longitude: lon } = opts.location;
  const limit = Math.max(1, opts.concurrency ?? 3);
  const out: RunEvaluation[] = [];
  let next = 0;
  let done = 0;

  // Models the single-runs API has already reported unavailable, keyed by run
  // cycle. planRuns yields newest-first, so a model missing from a cycle's newer
  // run has aged out for every older run of that cycle too — skip it up front
  // instead of re-eating a 400 per run. Keying by cycle also keeps a model that
  // simply doesn't publish, say, 06Z from being dropped at 00Z. The map is
  // add-only, so the concurrent workers can share it without races.
  const unavailable = new Map<number, Set<string>>();
  const markUnavailable = (runHour: number, id: string): void => {
    let set = unavailable.get(runHour);
    if (!set) unavailable.set(runHour, (set = new Set()));
    set.add(id);
  };

  const worker = async (): Promise<void> => {
    while (next < refs.length) {
      if (opts.signal?.aborted) return;
      const ref = refs[next++];
      if (!ref) return;
      const skip = unavailable.get(ref.runHour);
      const models = skip ? ARCHIVED_MODEL_IDS.filter((id) => !skip.has(id)) : ARCHIVED_MODEL_IDS;
      // Every model has aged out for this cycle: no request is worth making — for
      // the run or its truth. Older runs of the cycle fall here too and cost nothing.
      if (models.length > 0) {
        try {
          const truthEnd = addDaysIso(ref.runDate, 7);
          // eslint-disable-next-line no-await-in-loop -- a worker pulls jobs sequentially; the pool supplies the parallelism.
          const [runs, truth] = await Promise.all([
            deps.fetchRuns({ lat, lon, runDate: ref.runDate, runHour: ref.runHour, models }, { signal: opts.signal, onModelUnavailable: (id) => markUnavailable(ref.runHour, id) }),
            deps.fetchTruth({ lat, lon, startDate: ref.runDate, endDate: truthEnd }, opts.signal),
          ]);
          const ev = deps.evaluate({ runs, truth, lat, lon, runDate: ref.runDate, runHour: ref.runHour });
          if (ev) out.push(ev);
        } catch (e) {
          if (e instanceof DOMException && e.name === "AbortError") return;
          // A single failed run (missing archive, coverage gap) is skipped, not fatal.
        }
      }
      done += 1;
      opts.onProgress?.(done, refs.length);
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, refs.length) }, () => worker()));
  return out;
}
