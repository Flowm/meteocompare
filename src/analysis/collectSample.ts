// Gather a location's runs across a window for the multi-run analysis mode.
// `planRuns` is pure (enumerates which runs to fetch); `gatherRuns` runs the
// fetch + evaluate pipeline with a concurrency cap, abort support, and progress.
// Deps are injectable so the orchestration is testable without the network.

import { fetchHistoricalWeather } from "@/api/omHistoricalWeather";
import { ARCHIVED_MODEL_IDS, fetchSingleRuns } from "@/api/omSingleRuns";
import { addDaysIso, daysBetweenIso } from "@/utils/date";

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

/** How often, walking newest-first, to re-attempt the full model set for a cycle
 *  instead of trusting the accumulated "unavailable" set. Re-confirms availability
 *  as we scroll back and bounds how long a transient gap can suppress a model.
 *  Sized to the default gather duration so a typical gather stays in one window
 *  and never pays a re-probe; only deeper gathers cross a boundary. */
const RECHECK_WINDOW_DAYS = 30;

/** Fetch + evaluate every planned run, capped at `concurrency` in flight. A run
 *  that fails (e.g. every model aged out of the archive) is skipped, not fatal.
 *  Returns the successful evaluations; order is not guaranteed. */
export async function gatherRuns(refs: readonly RunRef[], opts: GatherOptions, deps: GatherDeps = DEFAULT_DEPS): Promise<RunEvaluation[]> {
  const { latitude: lat, longitude: lon } = opts.location;
  const limit = Math.max(1, opts.concurrency ?? 3);
  const out: RunEvaluation[] = [];
  let next = 0;
  let done = 0;

  // Models the single-runs API has reported unavailable, keyed by run cycle *and*
  // re-check window (RECHECK_WINDOW_DAYS). planRuns walks newest-first and archive
  // retention is monotonic in date, so within a window a model gone from a newer
  // run is gone from every older one — prune it up front instead of re-eating a
  // 400 per run. Keying by cycle also keeps a model that skips, say, 06Z from
  // being dropped at 00Z. Re-probing the full set once per window re-confirms
  // availability as we scroll back and bounds how long a transient one-off gap
  // can suppress a model. Add-only within a window, so workers share it race-free.
  const anchorDate = refs[0]?.runDate ?? "";
  const unavailable = new Map<string, Set<string>>();
  const windowKey = (ref: RunRef): string => `${ref.runHour}:${Math.floor(daysBetweenIso(ref.runDate, anchorDate) / RECHECK_WINDOW_DAYS)}`;
  const markUnavailable = (key: string, id: string): void => {
    let set = unavailable.get(key);
    if (!set) unavailable.set(key, (set = new Set()));
    set.add(id);
  };

  // Warm-up gate: the first run to reach a (cycle, window) probes it to completion
  // so its misses land in the memo before the rest of that window fans out. Without
  // it the first `concurrency` runs of a window all start on an empty memo and each
  // rediscover the same unavailable models (one 400 apiece). The gate holds a
  // promise per window that the probing worker resolves once done.
  const windowProbed = new Map<string, Promise<void>>();

  const worker = async (): Promise<void> => {
    while (next < refs.length) {
      if (opts.signal?.aborted) return;
      const ref = refs[next++];
      if (!ref) return;
      const key = windowKey(ref);

      const pending = windowProbed.get(key);
      let releaseProbe: (() => void) | undefined;
      if (pending) {
        // eslint-disable-next-line no-await-in-loop -- let this window's first run seed the memo before we prune.
        await pending;
        if (opts.signal?.aborted) return;
      } else {
        windowProbed.set(
          key,
          new Promise<void>((resolve) => {
            releaseProbe = resolve;
          }),
        );
      }

      try {
        const skip = unavailable.get(key);
        const models = skip ? ARCHIVED_MODEL_IDS.filter((id) => !skip.has(id)) : ARCHIVED_MODEL_IDS;
        // Every model is unavailable for this cycle in this window: no request is
        // worth making — for the run or its truth. Older runs in the window fall
        // here too and cost nothing; the next window re-probes from scratch.
        if (models.length > 0) {
          try {
            const truthEnd = addDaysIso(ref.runDate, 7);
            // eslint-disable-next-line no-await-in-loop -- a worker pulls jobs sequentially; the pool supplies the parallelism.
            const [runs, truth] = await Promise.all([
              deps.fetchRuns({ lat, lon, runDate: ref.runDate, runHour: ref.runHour, models }, { signal: opts.signal, onModelUnavailable: (id) => markUnavailable(key, id) }),
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
      } finally {
        // Release waiters in every exit path (success, skip, error, abort) — the
        // memo is warm and a stuck promise would hang the rest of the window.
        releaseProbe?.();
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, refs.length) }, () => worker()));
  return out;
}
