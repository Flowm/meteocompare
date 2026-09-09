import { afterEach, describe, expect, it, vi } from "vitest";
import { effectScope, nextTick, ref } from "vue";

import type { GeocodingResult } from "@/api/geocoding";

import { useLocationSearch } from "./useLocationSearch";

afterEach(() => vi.useRealTimers());
describe("location search", () => {
  it.each([false, true])("ignores stale completions after a new query (failure: %s)", async (fail) => {
    vi.useFakeTimers();
    const pending: { resolve: (r: GeocodingResult[]) => void; reject: (e: Error) => void }[] = [];
    const search = vi.fn(() => new Promise<GeocodingResult[]>((resolve, reject) => pending.push({ resolve, reject })));
    const query = ref("Oslo");
    const scope = effectScope();
    const state = scope.run(() => useLocationSearch(query, search))!;
    await vi.advanceTimersByTimeAsync(250);
    query.value = "Paris";
    await vi.advanceTimersByTimeAsync(250);
    const paris = [{ id: 1, name: "Paris", latitude: 48, longitude: 2 }];
    pending[1]!.resolve(paris);
    await nextTick();
    if (fail) pending[0]!.reject(new Error("Old failure"));
    else pending[0]!.resolve([]);
    await nextTick();
    expect(state.results.value).toEqual(paris);
    expect(state.searchError.value).toBeNull();
    expect(state.isSearching.value).toBe(false);
    scope.stop();
  });

  it("cancels debounced requests when the query is cleared or the view closes", async () => {
    vi.useFakeTimers();
    const query = ref("Oslo");
    const search = vi.fn(async () => []);
    const scope = effectScope();
    const state = scope.run(() => useLocationSearch(query, search))!;
    query.value = "";
    await vi.advanceTimersByTimeAsync(250);
    expect(search).not.toHaveBeenCalled();
    expect(state.results.value).toEqual([]);
    expect(state.isSearching.value).toBe(false);
    query.value = "Paris";
    scope.stop();
    await vi.advanceTimersByTimeAsync(250);
    expect(search).not.toHaveBeenCalled();
  });
});
