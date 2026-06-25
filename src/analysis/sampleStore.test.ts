import { describe, it, expect } from "vitest";

import type { RunEvaluation } from "./runEvaluation";
import { mergeRuns, sampleKey } from "./sampleStore";

describe("sampleKey", () => {
  it("snaps a location to a 0.25° grid cell", () => {
    expect(sampleKey(48.12, 11.38)).toBe("48.00,11.50");
  });

  it("maps nearby points to the same cell", () => {
    expect(sampleKey(48.0, 11.49)).toBe(sampleKey(48.12, 11.51));
  });

  it("handles negative coordinates", () => {
    expect(sampleKey(40.0, -74.06)).toBe("40.00,-74.00");
  });
});

function mkRun(runDate: string, runHour: number, marker: string): RunEvaluation {
  return { runDate, runHour, marker } as unknown as RunEvaluation;
}

describe("mergeRuns", () => {
  it("de-dupes by (date, cycle) with incoming winning, newest first", () => {
    const existing = [mkRun("2026-06-01", 0, "old")];
    const incoming = [mkRun("2026-06-01", 0, "new"), mkRun("2026-05-31", 0, "x")];
    const merged = mergeRuns(existing, incoming);
    expect(merged.map((r) => r.runDate)).toEqual(["2026-06-01", "2026-05-31"]);
    expect((merged[0] as unknown as { marker: string }).marker).toBe("new");
  });

  it("keeps distinct cycles of the same day as separate runs", () => {
    const merged = mergeRuns([mkRun("2026-06-01", 0, "a")], [mkRun("2026-06-01", 12, "b")]);
    expect(merged).toHaveLength(2);
  });
});
