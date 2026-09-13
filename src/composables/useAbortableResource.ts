import { getCurrentScope, onScopeDispose, ref, shallowRef, watch, type Ref, type ShallowRef } from "vue";

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
 *
 *  The superseded-request guard lives here, once, for both data composables: an
 *  aborted attempt must NOT flip `loading` off while its replacement is still in
 *  flight, or the indicator vanishes mid-fetch.
 *
 *  Fetchers return values without publishing state; only a current request may
 *  publish its result. Include success metadata in the returned value. */
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
      const result = await fetcher(signal);
      if (!signal.aborted) data.value = result;
    } catch (e: unknown) {
      if (signal.aborted) return;
      if (e instanceof DOMException && e.name === "AbortError") return;
      error.value = e instanceof Error ? e.message : String(e);
      data.value = null;
    } finally {
      if (inflight?.signal === signal) loading.value = false;
    }
  }

  watch(
    deps,
    () => {
      data.value = null;
      void refresh();
    },
    { immediate: true, flush: "sync" },
  );

  if (getCurrentScope())
    onScopeDispose(() => {
      inflight?.abort();
      loading.value = false;
    });

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
 *  state inside the task closure. Carries the same superseded-request guard
 *  described above, over `running`/`error` instead of `loading`/`data`;
 *  `cancel()` aborts and clears `running`. */
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
    inflight = null;
    running.value = false;
  }

  return { running, error, run, cancel };
}
