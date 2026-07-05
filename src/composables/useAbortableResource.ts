import { ref, shallowRef, watch, type Ref, type ShallowRef } from "vue";

export interface AbortableResource<T> {
  /** Latest successfully-fetched value, or null before the first success / after a failure. */
  data: ShallowRef<T | null>;
  loading: Ref<boolean>;
  error: Ref<string | null>;
  /** Re-run the fetcher, aborting any in-flight request first. */
  refresh: () => Promise<void>;
}

/** Drives a single abortable async resource. Re-runs `fetcher` whenever `deps`
 *  change (and immediately on setup), aborting any in-flight request first.
 *  Captures `loading` / `error`, swallows `AbortError`, and clears `data` on a
 *  genuine failure.
 *
 *  The superseded-request guard lives here, once: a request that has been
 *  replaced by a newer one is aborted, and the aborted attempt must NOT flip
 *  `loading` off while its replacement is still in flight (which would hide the
 *  loading indicator). Both data composables route through this so the guard
 *  can't drift between them.
 *
 *  Forecast-/page-specific success side effects (e.g. a "last updated" stamp)
 *  belong inside the caller's `fetcher` closure, which runs only on a non-aborted
 *  success — keeping this helper generic. */
export function useAbortableResource<T>(fetcher: (signal: AbortSignal) => Promise<T>, deps: () => unknown[]): AbortableResource<T> {
  const data = shallowRef<T | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  let inflight: AbortController | null = null;

  async function refresh(): Promise<void> {
    inflight?.abort();
    inflight = new AbortController();
    const signal = inflight.signal;
    loading.value = true;
    error.value = null;
    try {
      data.value = await fetcher(signal);
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      error.value = e instanceof Error ? e.message : String(e);
      data.value = null;
    } finally {
      if (inflight?.signal === signal) loading.value = false;
    }
  }

  watch(deps, () => void refresh(), { immediate: true });

  return { data, loading, error, refresh };
}

export interface AbortableTask {
  /** True while a run is in flight. Maps to a "gathering"/"busy" flag. */
  running: Ref<boolean>;
  error: Ref<string | null>;
  /** Start a task, aborting any previous run first. The task receives the abort
   *  signal and should honour it; a run that has been superseded (or cancelled)
   *  must not clobber the replacement's state. */
  run: (task: (signal: AbortSignal) => Promise<void>) => Promise<void>;
  /** Abort the in-flight run and reset `running`. */
  cancel: () => void;
}

/** The explicitly-triggered sibling of useAbortableResource: no deps, no
 *  auto-run, no owned data — the caller triggers `run(task)` and manages its own
 *  state inside the task closure. Shares the one superseded-guard: a newer
 *  `run()` aborts the previous, an aborted run must NOT flip `running` off or
 *  overwrite `error` while its replacement is in flight, and `cancel()` aborts
 *  and clears `running`. Both this and useAbortableResource keep the guard in one
 *  place so hand-rolled controller/guard code can't drift (see useSampleCollection). */
export function useAbortableTask(): AbortableTask {
  const running = ref(false);
  const error = ref<string | null>(null);

  let inflight: AbortController | null = null;

  async function run(task: (signal: AbortSignal) => Promise<void>): Promise<void> {
    inflight?.abort();
    inflight = new AbortController();
    const signal = inflight.signal;
    running.value = true;
    error.value = null;
    try {
      await task(signal);
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      // Only the current run may record an error — a superseded run's late
      // failure must not surface over the replacement.
      if (inflight?.signal === signal) error.value = e instanceof Error ? e.message : String(e);
    } finally {
      if (inflight?.signal === signal) running.value = false;
    }
  }

  function cancel(): void {
    inflight?.abort();
    running.value = false;
  }

  return { running, error, run, cancel };
}
