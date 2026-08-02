import { describe, expect, it } from "vitest";

import { aggPoint, array } from "@/test/fixtures";

import type { AggregatePoint } from "./aggregate";
import { AGGREGATE_LEGACY_ROW_ID, AGGREGATE_ROW_ID, AMOUNT_REF_BAD_PER_DAY, buildModelScorecard, LEAD_BANDS, TEMP_MAE_REF_BAD, type ScorecardInput } from "./scorecard";
import type { VerifyChannel } from "./verification";

const N = 168; // a full 7-day window

const aggPt = (value: number): AggregatePoint => aggPoint(value);

/** A baseline input: dry truth, flat 20 °C truth, no models — caller overrides
 *  the channels via `over` (a partial per variable, merged onto the defaults). */
function makeInput(
  over: { temperature_2m?: Partial<VerifyChannel>; precipitation?: Partial<VerifyChannel>; tuned?: ScorecardInput["tuned"]; legacy?: ScorecardInput["legacy"] } = {},
): ScorecardInput {
  return {
    times: array(N, (i) => `t${i}`),
    channels: {
      temperature_2m: { aggregate: array(N, () => aggPt(20)), perModel: {}, truth: array(N, () => 20), ...over.temperature_2m },
      precipitation: { aggregate: array(N, () => aggPt(0)), perModel: {}, truth: array(N, () => 0), ...over.precipitation },
    },
    tuned: over.tuned,
    legacy: over.legacy,
  };
}

const rowFor = (input: ScorecardInput, id: string) => buildModelScorecard(input).find((r) => r.id === id);

describe("buildModelScorecard — composite math + dry renormalisation", () => {
  it("blends temp + amount and drops timing on a dry window (renormalising weights)", () => {
    // Model: temp = truth + 2 (MAE 2 → goodness 1 − 2/5 = 0.6); precip all dry
    // matching dry truth (amount error 0 → goodness 1); timing undefined → dropped.
    // Composite = mean(0.6, 1) × 100 = 80.
    const input = makeInput({
      temperature_2m: { perModel: { m: array(N, () => 22) } },
      precipitation: { perModel: { m: array(N, () => 0) } },
    });
    const row = rowFor(input, "m")!;
    expect(row.overall.tempMae).toBeCloseTo(2);
    expect(row.overall.tempBias).toBeCloseTo(2);
    expect(row.overall.amountError).toBeCloseTo(0);
    expect(row.overall.timingScore).toBeNaN();
    expect(row.overall.composite).toBeCloseTo(80);
  });

  it("includes timing when the window is wet (all three metrics blended)", () => {
    // Wet every hour, forecast matches → all hits → timing 1; amount error 0 →
    // goodness 1; temp MAE 2 → 0.6. Composite = mean(0.6,1,1)×100 = 86.667.
    const input = makeInput({
      temperature_2m: { perModel: { m: array(N, () => 22) } },
      precipitation: { perModel: { m: array(N, () => 1) }, truth: array(N, () => 1) },
    });
    const row = rowFor(input, "m")!;
    expect(row.overall.timingScore).toBeCloseTo(1);
    expect(row.overall.composite).toBeCloseTo(((0.6 + 1 + 1) / 3) * 100);
  });

  it("a perfect forecast scores 100", () => {
    const input = makeInput({
      temperature_2m: { perModel: { m: array(N, () => 20) } },
      precipitation: { perModel: { m: array(N, () => 1) }, truth: array(N, () => 1) },
    });
    expect(rowFor(input, "m")!.overall.composite).toBeCloseTo(100);
  });
});

describe("buildModelScorecard — amount normalised per covered day", () => {
  it("scores amount by |error| / covered-days, not by raw sum", () => {
    // +10 mm amount error over 2 covered days (48 h) → 5 mm/day → amount
    // goodness 1 − 5/5 = 0. Truth + forecast both wet at hour 0 so timing is a
    // clean hit (goodness 1) and doesn't muddy the amount assertion; temp perfect.
    // Composite = mean(temp 1, amount 0, timing 1) × 100 = 66.67.
    const fPrecip = array(N, (i) => (i < 48 ? (i === 0 ? 15 : 0) : null)); // 48 covered h, sum 15
    const input = makeInput({
      temperature_2m: { perModel: { m: array(N, (i) => (i < 48 ? 20 : null)) } },
      precipitation: { perModel: { m: fPrecip }, truth: array(N, (i) => (i === 0 ? 5 : 0)) }, // sum 5 → amount error 10
    });
    const row = rowFor(input, "m")!;
    expect(row.overall.amountError).toBeCloseTo(10);
    expect(row.overall.timingScore).toBeCloseTo(1); // hour-0 hit, no false alarms
    expect(AMOUNT_REF_BAD_PER_DAY).toBe(5); // guards the arithmetic above
    expect(row.overall.composite).toBeCloseTo((2 / 3) * 100);
  });
});

describe("buildModelScorecard — missing forecast hours are ignored, not penalised", () => {
  it("does not charge a dropped-out model for rain in the hours it never forecast", () => {
    // Model covers the first 48 h with a perfect dry forecast, then drops out.
    // Truth is dry during coverage but rains heavily in the uncovered tail. The
    // model must not be charged for that tail: a clean amount error (0) and an
    // undefined timing score, not amountError = −(tail rain) and a run of
    // misses.
    const fPrecip = array(N, (i) => (i < 48 ? 0 : null));
    const input = makeInput({
      temperature_2m: { perModel: { m: array(N, (i) => (i < 48 ? 20 : null)) } },
      precipitation: { perModel: { m: fPrecip }, truth: array(N, (i) => (i < 48 ? 0 : 5)) },
    });
    const row = rowFor(input, "m")!;
    expect(row.overall.amountError).toBeCloseTo(0);
    expect(row.overall.timingScore).toBeNaN(); // tail wet-hours are no_data, not misses
    // Composite reflects only the covered hours (perfect temp + perfect dry
    // amount), so the drop-out doesn't drag the score down.
    expect(row.overall.composite).toBeCloseTo(100);
  });
});

describe("buildModelScorecard — false alarms are penalised", () => {
  it("a model predicting rain across a dry week does NOT get a full score", () => {
    // Truth dry all week; model cries wolf with 1 mm every hour, temp perfect.
    // Timing = CSI 0 — scored, not dropped: a pure-false-alarm scope still has
    // events. Amount = 168 mm over 7 covered days = 24 mm/day → goodness 0.
    // Composite = mean(temp 1, amount 0, timing 0) × 100 ≈ 33, not a full score.
    const input = makeInput({
      temperature_2m: { perModel: { m: array(N, () => 20) } },
      precipitation: { perModel: { m: array(N, () => 1) } },
    });
    const row = rowFor(input, "m")!;
    expect(row.overall.timingScore).toBeCloseTo(0); // scored, not NaN
    expect(row.overall.composite).toBeCloseTo((1 / 3) * 100);
    expect(row.overall.composite).toBeLessThan(50);
  });
});

describe("buildModelScorecard — lead-time bands + coverage", () => {
  it("fills only the bands a partial-coverage model has data for", () => {
    // Temp data only for the first 48 h (band 0). No precip data anywhere.
    const input = makeInput({
      temperature_2m: { perModel: { m: array(N, (i) => (i < 48 ? 21 : null)) } },
      precipitation: { perModel: { m: array(N, () => null) } },
    });
    const row = rowFor(input, "m")!;
    expect(LEAD_BANDS).toHaveLength(4);
    expect(row.bandComposites).toHaveLength(4);
    expect(row.bandComposites[0]).not.toBeNull(); // 0–2d has data
    expect(row.bandComposites[1]).toBeNull(); // 2–4d empty
    expect(row.bandComposites[2]).toBeNull(); // 4–7d empty
    expect(row.bandComposites[3]).toBeNull(); // 7–10d beyond the 168 h window
    expect(row.coveredHours).toBe(48);
    expect(row.totalHours).toBe(N);
    expect(row.partial).toBe(true);
  });

  it("marks a full-window model as not partial", () => {
    const input = makeInput({ temperature_2m: { perModel: { m: array(N, () => 21) } }, precipitation: { perModel: { m: array(N, () => 0) } } });
    const row = rowFor(input, "m")!;
    expect(row.partial).toBe(false);
    expect(row.coveredHours).toBe(N);
  });
});

describe("buildModelScorecard — aggregate ranked inline", () => {
  it("includes the aggregate as a distinct, ranked row and sorts by composite desc", () => {
    // Good model (temp perfect), worse model (temp off by 4), aggregate in between.
    const input = makeInput({
      temperature_2m: { perModel: { good: array(N, () => 20), bad: array(N, () => 24) }, aggregate: array(N, () => aggPt(22)) },
      precipitation: { perModel: { good: array(N, () => 0), bad: array(N, () => 0) } },
    });
    const rows = buildModelScorecard(input);
    const agg = rows.find((r) => r.id === AGGREGATE_ROW_ID)!;
    expect(agg.isAggregate).toBe(true);
    // Sorted best-first by Overall composite.
    const composites = rows.map((r) => r.overall.composite);
    for (let i = 1; i < composites.length; i++) expect(composites[i - 1]).toBeGreaterThanOrEqual(composites[i]!);
    // The better model outranks the aggregate, which outranks the worse model.
    const ids = rows.map((r) => r.id);
    expect(ids.indexOf("good")).toBeLessThan(ids.indexOf(AGGREGATE_ROW_ID));
    expect(ids.indexOf(AGGREGATE_ROW_ID)).toBeLessThan(ids.indexOf("bad"));
  });

  it("exposes the full-window per-hour classification for the timing matrix", () => {
    const input = makeInput({ temperature_2m: { perModel: { m: array(N, () => 20) } }, precipitation: { perModel: { m: array(N, () => 0) } } });
    expect(rowFor(input, "m")!.hourlyClassification).toHaveLength(N);
    expect(TEMP_MAE_REF_BAD).toBe(5); // guards the composite arithmetic in other tests
  });
});

describe("buildModelScorecard — legacy comparator row", () => {
  it("adds a distinct, ranked Aggregate (legacy) row only when a legacy series is supplied", () => {
    const legacy = {
      temperature_2m: array(N, () => aggPt(20)), // perfect temp
      precipitation: array(N, () => aggPt(0)), // perfect dry
    };
    const withLegacy = makeInput({
      temperature_2m: { perModel: { m: array(N, () => 24) }, aggregate: array(N, () => aggPt(22)) },
      precipitation: { perModel: { m: array(N, () => 0) } },
      legacy,
    });
    const rows = buildModelScorecard(withLegacy);
    const legacyRow = rows.find((r) => r.id === AGGREGATE_LEGACY_ROW_ID);
    expect(legacyRow).toBeDefined();
    expect(legacyRow!.isAggregate).toBe(true);
    expect(legacyRow!.overall.composite).toBeCloseTo(100); // scored from the legacy series
    // Ranked inline by composite: the perfect legacy aggregate outranks the
    // default aggregate (temp off by 2) and the worse model (off by 4).
    const ids = rows.map((r) => r.id);
    expect(ids.indexOf(AGGREGATE_LEGACY_ROW_ID)).toBeLessThan(ids.indexOf(AGGREGATE_ROW_ID));

    // Absent unless supplied.
    const withoutLegacy = makeInput({ temperature_2m: { perModel: { m: array(N, () => 20) } }, precipitation: { perModel: { m: array(N, () => 0) } } });
    expect(buildModelScorecard(withoutLegacy).some((r) => r.id === AGGREGATE_LEGACY_ROW_ID)).toBe(false);
  });
});
