import { computed, type Ref } from "vue";

import { searchLocations } from "@/api/geocoding";

import { useAbortableResource } from "./useAbortableResource";

/** Debounce requests, but invalidate old results immediately on each edit. */
export function useLocationSearch(query: Ref<string>, search = searchLocations) {
  const resource = useAbortableResource(
    async (signal) => {
      const text = query.value.trim();
      if (text.length < 2) return [];
      await new Promise<void>((resolve, reject) => {
        const abort = (): void => {
          clearTimeout(timer);
          reject(new DOMException("Aborted", "AbortError"));
        };
        const timer = setTimeout(() => {
          signal.removeEventListener("abort", abort);
          resolve();
        }, 250);
        signal.addEventListener("abort", abort, { once: true });
      });
      signal.throwIfAborted();
      return search(text, signal);
    },
    () => [query.value],
  );
  return {
    results: computed(() => resource.data.value ?? []),
    isSearching: computed(() => query.value.trim().length >= 2 && resource.loading.value),
    searchError: resource.error,
  };
}
