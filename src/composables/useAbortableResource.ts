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
