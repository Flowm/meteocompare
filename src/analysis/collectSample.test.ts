import { describe, it, expect } from "vitest";

import { gatherRuns, planRuns, type GatherDeps } from "./collectSample";
import type { RunEvaluation } from "./runEvaluation";

describe("planRuns", () => {
  it("enumerates run dates newest-first, one ref per cycle", () => {
    const refs = planRuns({ endDate: "2026-06-03", durationDays: 3, cycles: [0], floorDate: "2026-01-01" });
    expect(refs).toEqual([
      { runDate: "2026-06-03", runHour: 0 },
      { runDate: "2026-06-02", runHour: 0 },
      { runDate: "2026-06-01", runHour: 0 },
    ]);
  });

  it("stops at the retention floor", () => {
    const refs = planRuns({ endDate: "2026-06-03", durationDays: 10, cycles: [0], floorDate: "2026-06-02" });
    expect(refs.map((r) => r.runDate)).toEqual(["2026-06-03", "2026-06-02"]);
  });

  it("expands cycles within a day", () => {
    const refs = planRuns({ endDate: "2026-06-03", durationDays: 1, cycles: [0, 6, 12, 18], floorDate: "2026-01-01" });
    expect(refs.map((r) => r.runHour)).toEqual([0, 6, 12, 18]);
  });
});

const okDeps = (): GatherDeps => ({
  fetchRuns: () => Promise.resolve({} as never),
  fetchTruth: () => Promise.resolve({} as never),
  evaluate: ({ runDate, runHour }) => ({ runDate, runHour, scorecard: [] }) as unknown as RunEvaluation,
});

const refs = [
  { runDate: "2026-06-03", runHour: 0 },
  { runDate: "2026-06-02", runHour: 0 },
  { runDate: "2026-06-01", runHour: 0 },
];

describe("gatherRuns", () => {
  it("fetches + evaluates every ref and reports progress", async () => {
    const progress: number[] = [];
    const out = await gatherRuns(refs, { location: { latitude: 1, longitude: 2 }, concurrency: 2, onProgress: (d) => progress.push(d) }, okDeps());
    expect(out.map((r) => r.runDate).toSorted()).toEqual(["2026-06-01", "2026-06-02", "2026-06-03"]);
    expect(progress.at(-1)).toBe(3);
  });

  it("skips runs whose evaluation is null (e.g. empty archive)", async () => {
    const deps: GatherDeps = {
      ...okDeps(),
      evaluate: ({ runDate, runHour }) => (runDate === "2026-06-02" ? null : ({ runDate, runHour, scorecard: [] } as unknown as RunEvaluation)),
    };
    const out = await gatherRuns(refs, { location: { latitude: 1, longitude: 2 } }, deps);
    expect(out).toHaveLength(2);
  });

  it("skips a run whose fetch throws, without failing the gather", async () => {
    const deps: GatherDeps = { ...okDeps(), fetchRuns: (req) => (req.runDate === "2026-06-02" ? Promise.reject(new Error("aged out")) : Promise.resolve({} as never)) };
    const out = await gatherRuns(refs, { location: { latitude: 1, longitude: 2 } }, deps);
    expect(out).toHaveLength(2);
  });
});
