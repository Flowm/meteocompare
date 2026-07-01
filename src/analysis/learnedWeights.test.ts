import { describe, it, expect } from "vitest";

import { fitWeights, MIN_TRAIN_RUNS, MIN_VAL_RUNS } from "./learnedWeights";
import type { RunEvaluation } from "./runEvaluation";
import type { LocationSample } from "./sample";

const N = 48;

function times(): string[] {
  const base = Date.UTC(2026, 0, 1, 0, 0, 0);
  return Array.from({ length: N }, (_, i) => new Date(base + i * 3_600_000).toISOString().slice(0, 16));
}

// One run where ecmwf_ifs tracks truth exactly and gfs_seamless runs +6 °C warm.
// Both are global with no home region, so they carry equal heuristic weight —
// the only way to improve the aggregate is to up-weight the better model.
function mkRun(runDate: string): RunEvaluation {
  const t = times();
  const truth = Array.from({ length: N }, (_, i) => 10 + Math.sin(i / 3) * 5);
  const warm = truth.map((x) => x + 6);
  const nulls = (): (number | null)[] => Array.from({ length: N }, () => null);
  return {
    runDate,
    runHour: 0,
    hourly: {
      times: t,
      aggregate: {},
      perModel: {
        temperature_2m: { ecmwf_ifs: truth.slice(), gfs_seamless: warm },
        precipitation: { ecmwf_ifs: nulls(), gfs_seamless: nulls() },
      },
      truth: { temperature_2m: truth, precipitation: nulls() },
      predictability: {},
    },
    daily: [],
    scorecard: [],
    availableModels: [],
  } as unknown as RunEvaluation;
}

function sampleOf(nRuns: number): LocationSample {
  return {
    location: { latitude: 48, longitude: 11 },
    runs: Array.from({ length: nRuns }, (_, i) => mkRun(`2026-01-${String(i + 1).padStart(2, "0")}`)),
    gatheredAt: "2026-02-01T00:00:00Z",
  };
}

describe("fitWeights", () => {
  it("refuses to train with too few runs", () => {
    const res = fitWeights(sampleOf(MIN_TRAIN_RUNS + MIN_VAL_RUNS - 1));
    expect(res.ok).toBe(false);
    expect(res.reason).toBeTruthy();
  });

  it("up-weights the consistently better model and improves out-of-sample", () => {
    const res = fitWeights(sampleOf(15));
    expect(res.ok).toBe(true);
    expect(res.nTrain).toBeGreaterThanOrEqual(MIN_TRAIN_RUNS);
    expect(res.nVal).toBeGreaterThanOrEqual(MIN_VAL_RUNS);
    // The accurate model should end up weighted above the biased one.
    expect((res.multipliers.ecmwf_ifs ?? 0) > (res.multipliers.gfs_seamless ?? 9)).toBe(true);
    // And the fit should help on the held-out validation runs.
    expect(res.improvement).toBeGreaterThan(0);
  });
});
