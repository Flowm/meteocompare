import { describe, it, expect } from "vitest";

import { LEAD_BANDS, type ScorecardRow } from "@/domain/scorecard";

import type { RunEvaluation } from "./runEvaluation";
import { aggregateSample } from "./sample";

function mkRow(id: string, composite: number, opts: { bands?: (number | null)[]; tempMae?: number; isAggregate?: boolean } = {}): ScorecardRow {
  return {
    id,
    isAggregate: opts.isAggregate ?? false,
    overall: { tempBias: NaN, tempMae: opts.tempMae ?? NaN, amountError: NaN, timingScore: NaN, composite },
    bandComposites: opts.bands ?? [null, null, null],
    coveredHours: 0,
    totalHours: 0,
    partial: false,
    hourlyClassification: [],
  };
}

function mkRun(scorecard: ScorecardRow[]): RunEvaluation {
  return { scorecard } as unknown as RunEvaluation;
}

describe("aggregateSample", () => {
  it("averages each model's composite over the runs it appears in, sorted best-first", () => {
    const stats = aggregateSample([mkRun([mkRow("a", 80), mkRow("b", 50)]), mkRun([mkRow("a", 60)])]);
    expect(stats.map((s) => s.id)).toEqual(["a", "b"]);
    expect(stats[0]).toMatchObject({ id: "a", n: 2, compositeMean: 70, compositeMin: 60, compositeMax: 80 });
    expect(stats[1]).toMatchObject({ id: "b", n: 1, compositeMean: 50 });
  });

  it("means per lead band, skipping nulls, null when a band is never scorable", () => {
    // Rows carry only 3 band slots (a legacy/partial shape); the aggregation
    // still emits one slot per LEAD_BANDS entry, the untouched tail being null.
    const stats = aggregateSample([mkRun([mkRow("a", 80, { bands: [70, null, null] })]), mkRun([mkRow("a", 90, { bands: [90, null, null] })])]);
    expect(stats[0]?.bandCompositeMeans).toHaveLength(LEAD_BANDS.length);
    expect(stats[0]?.bandCompositeMeans[0]).toBe(80);
    expect(stats[0]?.bandCompositeMeans[1]).toBeNull();
    expect(stats[0]?.bandCompositeMeans[3]).toBeNull(); // 7–10d never in the fixture rows
  });

  it("only counts finite metrics (a model absent from a run isn't a zero)", () => {
    const stats = aggregateSample([mkRun([mkRow("a", 80, { tempMae: 1 })]), mkRun([mkRow("a", 60, { tempMae: 3 })])]);
    expect(stats[0]?.tempMaeMean).toBe(2);
  });
});
