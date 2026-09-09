// @vitest-environment node
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { gatherCached } from "../../scripts/lib/collectRuns";
import { gatherRuns } from "./collectSample";
import type { RunEvaluation } from "./runEvaluation";

vi.mock("./collectSample", () => ({ gatherRuns: vi.fn() }));
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.resetAllMocks();
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
