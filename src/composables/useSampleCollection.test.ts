import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { nextTick, ref } from "vue";

import type { GatherDeps } from "@/analysis/collectSample";
import type { RunEvaluation } from "@/analysis/runEvaluation";
import type { LocationSample } from "@/analysis/sample";
import { installFakeIndexedDB } from "@/analysis/testFakeIdb";

import type { Location } from "./useLocation";
import { useSampleCollection } from "./useSampleCollection";

const LOCATION: Location = { latitude: 47.26, longitude: 11.39, name: "Innsbruck" };

/** A minimal RunEvaluation — the empty scorecard makes aggregateSample yield no
 *  stats, which is all these tests need (they exercise the gather lifecycle, not
 *  the scoring). `marker` lets a test tell one gather's runs from another's. */
function mkRun(runDate: string, runHour: number, marker: string): RunEvaluation {
  return { runDate, runHour, marker, hourly: {}, daily: [], scorecard: [], availableModels: [] } as unknown as RunEvaluation;
}

/** GatherDeps whose fetchRuns blocks until the test resolves the captured gate —
 *  so we can interleave a second gather / a cancel while the first is in flight.
 *  evaluate returns a marked run so we can assert which gather's data landed. */
function controllableDeps(marker: string): { deps: GatherDeps; release: () => void; releaseCount: () => number } {
  const gates: Array<() => void> = [];
  const deps: GatherDeps = {
    fetchRuns: () => new Promise((resolve) => gates.push(() => resolve({} as never))),
    fetchTruth: () => Promise.resolve({} as never),
    evaluate: ({ runDate, runHour }) => mkRun(runDate, runHour ?? 0, marker),
  };
  return {
    deps,
    release: () => {
      for (const g of gates.splice(0)) g();
    },
    releaseCount: () => gates.length,
  };
}

describe("useSampleCollection", () => {
  let fake: ReturnType<typeof installFakeIndexedDB>;

  beforeEach(() => {
    fake = installFakeIndexedDB();
  });
  afterEach(() => fake.restore());

  const controls = { durationDays: 1, cyclesPerDay: 1 } as const;

  it("gathers, exposing gathering + progress, then lands the runs", async () => {
    const { deps, release } = controllableDeps("A");
    const c = useSampleCollection(ref(LOCATION), ref("2026-06-01"), "2026-01-01", deps);

    const p = c.gather(controls);
    await nextTick();
    expect(c.gathering.value).toBe(true);
    expect(c.progress.value.total).toBe(1);

    release();
    await p;
    expect(c.gathering.value).toBe(false);
    expect(c.runs.value).toHaveLength(1);
    expect((c.runs.value[0] as unknown as { marker: string }).marker).toBe("A");
  });

  it("a gather superseded by a second gather cannot clobber the newer state", async () => {
    // Two gathers on the same collection: gather #1 is superseded by gather #2.
    // Each fetchRuns call resolves a tagged payload; evaluate reads the tag, so
    // the run carries the marker of the gather that produced it — no fragile
    // shared queue. We release the stale gather LATE to prove it can't overwrite.
    const gates: Array<() => void> = [];
    let call = 0;
    const deps: GatherDeps = {
      fetchRuns: () => {
        const tag = `gather-${++call}`;
        return new Promise((resolve) => gates.push(() => resolve({ __tag: tag } as unknown as never)));
      },
      fetchTruth: () => Promise.resolve({} as never),
      evaluate: ({ runs, runDate, runHour }) => mkRun(runDate, runHour ?? 0, (runs as unknown as { __tag: string }).__tag),
    };
    const c = useSampleCollection(ref(LOCATION), ref("2026-06-01"), "2026-01-01", deps);

    const p1 = c.gather(controls); // #1
    await nextTick();
    const p2 = c.gather(controls); // #2 supersedes #1 (aborts #1's signal)
    await nextTick();

    // Resolve #2 first so its runs land, then #1 late — its aborted signal must
    // prevent it writing over #2's runs.
    const [g1, g2] = gates;
    g2!();
    await p2;
    g1!();
    await p1;

    expect(c.gathering.value).toBe(false);
    expect(c.runs.value).toHaveLength(1);
    expect((c.runs.value[0] as unknown as { marker: string }).marker).toBe("gather-2");
  });

  it("cancel() stops the flags and resets progress to 0/0", async () => {
    const { deps } = controllableDeps("A");
    const c = useSampleCollection(ref(LOCATION), ref("2026-06-01"), "2026-01-01", deps);

    void c.gather(controls);
    await nextTick();
    expect(c.gathering.value).toBe(true);
    expect(c.progress.value.total).toBe(1);

    c.cancel();
    await nextTick();
    expect(c.gathering.value).toBe(false);
    expect(c.progress.value).toEqual({ done: 0, total: 0 });
  });

  it("store() merges via mergeRuns and reports storedCount", async () => {
    const { deps, release } = controllableDeps("A");
    const c = useSampleCollection(ref(LOCATION), ref("2026-06-01"), "2026-01-01", deps);

    const p = c.gather(controls);
    await nextTick();
    release();
    await p;
    expect(c.runs.value).toHaveLength(1);

    await c.store();
    expect(c.storedCount.value).toBe(1);

    // A second store of the same run de-dupes (mergeRuns keys by date+cycle).
    await c.store();
    expect(c.storedCount.value).toBe(1);

    // And it actually persisted through the sample store.
    const persisted: LocationSample[] = await import("@/analysis/sampleStore").then((m) => m.listSamples());
    expect(persisted).toHaveLength(1);
    expect(persisted[0]?.runs).toHaveLength(1);
  });
});
