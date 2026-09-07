import { describe, it, expect } from "vitest";
import { effectScope, nextTick, ref } from "vue";

import { useAbortableResource, useAbortableTask } from "./useAbortableResource";

describe("useAbortableResource — superseded-request guard", () => {
  it.each([false, true])("ignores a superseded request's late completion (failure: %s)", async (fail) => {
    const pending: { resolve: (v: string) => void; reject: (e: Error) => void }[] = [];
    const dep = ref(0);
    const resource = useAbortableResource(
      () => new Promise<string>((resolve, reject) => pending.push({ resolve, reject })),
      () => [dep.value],
    );
    dep.value++;
    await nextTick();
    pending[1]!.resolve("current");
    await nextTick();
    if (fail) pending[0]!.reject(new Error("stale failure"));
    else pending[0]!.resolve("stale data");
    await nextTick();
    expect(resource.data.value).toBe("current");
    expect(resource.error.value).toBeNull();
    expect(resource.loading.value).toBe(false);
  });

  it("clears the previous location's data synchronously when dependencies change", async () => {
    const dep = ref(0);
    const resource = useAbortableResource(
      () => Promise.resolve("old location"),
      () => [dep.value],
    );
    await nextTick();
    expect(resource.data.value).toBe("old location");
    dep.value++;
    expect(resource.data.value).toBeNull();
  });

  it("aborts on disposal and ignores a late success", async () => {
    const scope = effectScope();
    let resolve!: (value: string) => void;
    let signal!: AbortSignal;
    const resource = scope.run(() =>
      useAbortableResource(
        (s) => {
          signal = s;
          return new Promise<string>((r) => {
            resolve = r;
          });
        },
        () => [],
      ),
    )!;
    scope.stop();
    expect(signal.aborted).toBe(true);
    resolve("disposed");
    await nextTick();
    expect(resource.data.value).toBeNull();
  });

  // The bug class this helper centralizes: a request that has been superseded
  // by a newer one must not flip `loading` off when it (late-)resolves, or the
  // loading indicator would vanish while the replacement is still in flight.
  it("a stale request resolving after a newer one does not clear loading", async () => {
    const resolvers: Array<(v: string) => void> = [];
    const dep = ref(0);

    const { loading, data } = useAbortableResource<string>(
      // Resolves only when the test calls the captured resolver — and ignores
      // the abort signal, so a superseded request still reaches its `finally`.
      () => new Promise<string>((resolve) => resolvers.push(resolve)),
      () => [dep.value],
    );

    // `immediate: true` fires request #0 synchronously on setup.
    expect(loading.value).toBe(true);
    expect(resolvers).toHaveLength(1);

    // Supersede it with request #1.
    dep.value = 1;
    await nextTick();
    expect(resolvers).toHaveLength(2);
    expect(loading.value).toBe(true);

    // The STALE request #0 resolves late — the guard must keep loading on.
    resolvers[0]!("stale");
    await nextTick();
    expect(loading.value).toBe(true);

    // The latest request #1 resolves — now loading clears and its value wins.
    resolvers[1]!("fresh");
    await nextTick();
    expect(loading.value).toBe(false);
    expect(data.value).toBe("fresh");
  });

  it("captures the error message and clears data on failure", async () => {
    const dep = ref(0);
    const { loading, error, data } = useAbortableResource<string>(
      () => Promise.reject(new Error("boom")),
      () => [dep.value],
    );

    await nextTick();
    await nextTick();
    expect(error.value).toBe("boom");
    expect(data.value).toBeNull();
    expect(loading.value).toBe(false);
  });
});

describe("useAbortableTask — superseded-guard", () => {
  it("a stale run resolving after a newer one does not clear running", async () => {
    const resolvers: Array<() => void> = [];
    const task = useAbortableTask();
    const start = (): Promise<void> => task.run(() => new Promise<void>((resolve) => resolvers.push(resolve)));

    void start();
    expect(task.running.value).toBe(true);

    // Supersede run #0 with run #1 — the first controller is aborted.
    void start();
    expect(resolvers).toHaveLength(2);
    expect(task.running.value).toBe(true);

    // The stale run #0 resolves late — running must stay on.
    resolvers[0]!();
    await nextTick();
    expect(task.running.value).toBe(true);

    // The latest run #1 resolves — now running clears.
    resolvers[1]!();
    await nextTick();
    await nextTick();
    expect(task.running.value).toBe(false);
  });

  it("cancel() aborts the in-flight run and clears running", async () => {
    const task = useAbortableTask();
    let seenAbort = false;
    void task.run(
      (signal) =>
        new Promise<void>((_, reject) => {
          signal.addEventListener("abort", () => {
            seenAbort = true;
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
    );
    expect(task.running.value).toBe(true);
    task.cancel();
    await nextTick();
    expect(seenAbort).toBe(true);
    expect(task.running.value).toBe(false);
  });

  it("a superseded run's late failure does not surface over the replacement", async () => {
    const task = useAbortableTask();
    const rejecters: Array<(e: unknown) => void> = [];
    const start = (): Promise<void> => task.run(() => new Promise<void>((_, reject) => rejecters.push(reject)));

    void start();
    void start(); // supersedes #0

    // #0 fails late with a non-abort error — must NOT set error (it's superseded).
    rejecters[0]!(new Error("stale failure"));
    await nextTick();
    expect(task.error.value).toBeNull();
    expect(task.running.value).toBe(true);
  });
});
