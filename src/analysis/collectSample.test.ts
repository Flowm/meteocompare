import { describe, it, expect } from "vitest";

import { ARCHIVED_MODEL_IDS } from "@/api/omSingleRuns";

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

  it("carries a model dropped on a newer run forward to older runs of the same cycle", async () => {
    const seen = new Map<string, string[]>();
    const deps: GatherDeps = {
      ...okDeps(),
      fetchRuns: (req, opts) => {
        seen.set(req.runDate, req.models ?? []);
        // The newest run discovers ecmwf_ifs has aged out of the archive.
        if (req.runDate === "2026-06-03") opts?.onModelUnavailable?.("ecmwf_ifs");
        return Promise.resolve({} as never);
      },
    };
    // concurrency 1 → strict newest-first, so the drop is known before older runs start.
    await gatherRuns(refs, { location: { latitude: 1, longitude: 2 }, concurrency: 1 }, deps);

    expect(seen.get("2026-06-03")).toContain("ecmwf_ifs");
    expect(seen.get("2026-06-02")).not.toContain("ecmwf_ifs");
    expect(seen.get("2026-06-01")).not.toContain("ecmwf_ifs");
  });

  it("keeps the unavailability memo independent per run cycle", async () => {
    const twoCycles = planRuns({ endDate: "2026-06-03", durationDays: 2, cycles: [0, 6], floorDate: "2026-01-01" });
    const seen: { runDate: string; runHour: number; models: string[] }[] = [];
    const deps: GatherDeps = {
      ...okDeps(),
      fetchRuns: (req, opts) => {
        seen.push({ runDate: req.runDate, runHour: req.runHour ?? 0, models: req.models ?? [] });
        // Only the 06Z cycle loses the model; 00Z must be unaffected.
        if (req.runDate === "2026-06-03" && req.runHour === 6) opts?.onModelUnavailable?.("ecmwf_ifs");
        return Promise.resolve({} as never);
      },
    };
    await gatherRuns(twoCycles, { location: { latitude: 1, longitude: 2 }, concurrency: 1 }, deps);

    const models = (runDate: string, runHour: number) => seen.find((s) => s.runDate === runDate && s.runHour === runHour)?.models ?? [];
    expect(models("2026-06-02", 6)).not.toContain("ecmwf_ifs"); // carried forward within 06Z
    expect(models("2026-06-02", 0)).toContain("ecmwf_ifs"); // 00Z stays untouched
  });

  it("makes no request for a run once every model is unavailable for its cycle", async () => {
    let runFetches = 0;
    let truthFetches = 0;
    const progress: number[] = [];
    const deps: GatherDeps = {
      ...okDeps(),
      fetchRuns: (req, opts) => {
        runFetches += 1;
        // The newest run reports every model gone, exhausting the cycle.
        if (req.runDate === "2026-06-03") for (const id of ARCHIVED_MODEL_IDS) opts?.onModelUnavailable?.(id);
        return Promise.resolve({} as never);
      },
      fetchTruth: () => {
        truthFetches += 1;
        return Promise.resolve({} as never);
      },
    };
    await gatherRuns(refs, { location: { latitude: 1, longitude: 2 }, concurrency: 1, onProgress: (d) => progress.push(d) }, deps);

    // Only the newest run hit the network; the two older runs were skipped outright.
    expect(runFetches).toBe(1);
    expect(truthFetches).toBe(1);
    // Progress still advances for the skipped runs so the bar completes.
    expect(progress.at(-1)).toBe(3);
  });
});
