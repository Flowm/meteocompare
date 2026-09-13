// @vitest-environment node
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { gatherRuns } from "@/analysis/collectSample";
import type { RunEvaluation } from "@/analysis/runEvaluation";

import { gatherCached } from "./collectRuns";

vi.mock("@/analysis/collectSample", () => ({ gatherRuns: vi.fn() }));
const builtin = vi.hoisted(() => ({ perModel: { test: [1] } }));
vi.mock("@/analysis/defaultWeights", () => ({ DEFAULT_WEIGHTS: builtin }));
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.resetAllMocks();
  builtin.perModel.test = [1];
});

describe("script evaluation cache", () => {
  it("ignores unversioned results and preserves unscorable metrics on reuse", async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), "meteocompare-cache-test-"));
    dirs.push(cacheDir);
    const loc = { name: "Test", latitude: 1, longitude: 2 };
    const refs = [{ runDate: "2026-06-01", runHour: 0 }];
    const run = { ...refs[0], scorecard: [{ overall: { composite: NaN } }] } as RunEvaluation;
    writeFileSync(join(cacheDir, "test__2026-06-01__00.json"), JSON.stringify({ ...run, scorecard: [] }));
    vi.mocked(gatherRuns).mockResolvedValue([run]);
    await gatherCached(loc, refs, { cacheDir });
    const cached = await gatherCached(loc, refs, { cacheDir });
    expect(gatherRuns).toHaveBeenCalledTimes(1);
    expect(cached[0]!.scorecard[0]!.overall.composite).toBeNaN();
    expect(readdirSync(cacheDir)).toHaveLength(2);
  });

  it("re-evaluates cached runs after the builtin weights change", async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), "meteocompare-cache-test-"));
    dirs.push(cacheDir);
    const loc = { name: "Test", latitude: 1, longitude: 2 };
    const refs = [{ runDate: "2026-06-01", runHour: 0 }];
    vi.mocked(gatherRuns).mockResolvedValue([{ ...refs[0], daily: [] } as unknown as RunEvaluation]);
    await gatherCached(loc, refs, { cacheDir });
    builtin.perModel.test = [2];
    await gatherCached(loc, refs, { cacheDir });
    expect(gatherRuns).toHaveBeenCalledTimes(2);
  });

  it("retries failed runs rather than caching them permanently", async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), "meteocompare-cache-test-"));
    dirs.push(cacheDir);
    vi.mocked(gatherRuns).mockResolvedValue([]);
    const loc = { name: "Test", latitude: 1, longitude: 2 };
    const refs = [{ runDate: "2026-06-01", runHour: 0 }];
    await gatherCached(loc, refs, { cacheDir });
    await gatherCached(loc, refs, { cacheDir });
    expect(gatherRuns).toHaveBeenCalledTimes(2);
    expect(readdirSync(cacheDir)).toEqual([]);
  });
});
