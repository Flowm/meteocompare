import { describe, expect, it } from "vitest";

import { aggPoint, array } from "@/test/fixtures";

import type { AggregatePoint } from "./aggregate";
import {
  bias,
  buildDailyVerification,
  classifyHours,
  coveredPrecipSums,
  HOURS_PER_DAY,
  mae,
  maxNonNull,
  meanFinite,
  minNonNull,
  sumNonNull,
  timingScore,
  WET_THRESHOLD_MM_PER_H,
} from "./verification";

describe("bias", () => {
  it("returns the signed mean error", () => {
    expect(bias([10, 12, 14], [9, 11, 13])).toBeCloseTo(1);
    expect(bias([5, 5, 5], [10, 10, 10])).toBeCloseTo(-5);
  });

  it("skips pairs where either side is null", () => {
    expect(bias([10, null, 14], [9, 11, 13])).toBeCloseTo((10 - 9 + (14 - 13)) / 2);
    expect(bias([10, 12, null], [null, 11, 13])).toBeCloseTo(12 - 11);
  });

  it("returns NaN when no overlapping pair exists", () => {
    expect(bias([null, null], [1, 2])).toBeNaN();
    expect(bias([], [])).toBeNaN();
  });

  it("handles asymmetric lengths by using the shorter one", () => {
    expect(bias([10, 12], [9, 11, 13])).toBeCloseTo(1);
  });
});

describe("mae", () => {
  it("returns the absolute mean error regardless of sign", () => {
    expect(mae([10, 12, 14], [9, 11, 13])).toBeCloseTo(1);
    expect(mae([5, 5, 5], [10, 10, 10])).toBeCloseTo(5);
    expect(mae([5, 15], [10, 10])).toBeCloseTo(5);
  });

  it("skips pairs with nulls", () => {
    expect(mae([null, 12, null], [1, 11, 99])).toBeCloseTo(1);
  });

  it("returns NaN when no overlapping pair exists", () => {
    expect(mae([null], [1])).toBeNaN();
  });
});

describe("sumNonNull / minNonNull / maxNonNull", () => {
  it("treat nulls as missing, not zero", () => {
    expect(sumNonNull([1, null, 3, null, 5])).toBe(9);
    expect(minNonNull([3, null, 1, null, 2])).toBe(1);
    expect(maxNonNull([3, null, 1, null, 2])).toBe(3);
  });

  it("return sentinels for all-null arrays", () => {
    expect(sumNonNull([null, null])).toBe(0);
    expect(minNonNull([null, null])).toBeNaN();
    expect(maxNonNull([null, null])).toBeNaN();
  });
});

describe("meanFinite", () => {
  it("averages finite values, skipping NaN/Infinity", () => {
    expect(meanFinite([0.5, 0.7, 0.9])).toBeCloseTo(0.7);
    expect(meanFinite([0.5, NaN, 0.7])).toBeCloseTo(0.6);
  });

  it("returns 0 for an empty or all-NaN array", () => {
    expect(meanFinite([])).toBe(0);
    expect(meanFinite([NaN, NaN])).toBe(0);
  });
});

describe("classifyHours", () => {
  const dry = 0;
  const wet = 1.0; // well above WET_THRESHOLD_MM_PER_H = 0.1

  it("labels both-dry hours as correct_dry", () => {
    const labels = classifyHours([dry, dry, dry], [dry, dry, dry]);
    expect(labels).toEqual(["correct_dry", "correct_dry", "correct_dry"]);
  });

  it("labels truth-wet + forecast-wet at the same hour as hit", () => {
    const labels = classifyHours([wet, dry, wet], [wet, dry, wet]);
    expect(labels).toEqual(["hit", "correct_dry", "hit"]);
  });

  it("labels truth-wet + forecast-wet shifted by tolerance as a hit at the truth hour", () => {
    // Truth wet at hour 1; forecast wet at hour 0 (within ±1). Hour 1 should be hit.
    const labels = classifyHours([wet, dry, dry, dry], [dry, wet, dry, dry]);
    expect(labels[1]).toBe("hit");
    // The forecast-wet hour 0 itself is "correct_dry": no truth at hour 0,
    // but the nearby truth-wet at hour 1 means it's not a false alarm.
    expect(labels[0]).toBe("correct_dry");
  });

  it("labels truth-wet with no nearby forecast-wet as miss", () => {
    // Truth wet at hour 2; forecast dry everywhere within ±1.
    const labels = classifyHours([dry, dry, dry, dry], [dry, dry, wet, dry]);
    expect(labels[2]).toBe("miss");
  });

  it("labels forecast-wet with no nearby truth-wet as false_alarm", () => {
    const labels = classifyHours([dry, dry, wet, dry], [dry, dry, dry, dry]);
    expect(labels[2]).toBe("false_alarm");
  });

  it("labels hours with no forecast (or no truth) as no_data, not as a miss", () => {
    // Forecast drops out at hour 1 while truth is wet there — must be no_data,
    // not a miss: the model never had a chance to forecast that hour.
    expect(classifyHours([wet, null, wet], [wet, wet, wet])).toEqual(["hit", "no_data", "hit"]);
    // A whole missing forecast → all no_data (was "all correct_dry" before).
    expect(classifyHours([null, null, null], [dry, dry, dry])).toEqual(["no_data", "no_data", "no_data"]);
    // Missing truth is likewise unscorable.
    expect(classifyHours([wet, wet], [wet, null])).toEqual(["hit", "no_data"]);
  });

  it("does not match across larger gaps than tolerance", () => {
    // Truth wet at hour 4; forecast wet at hour 0 — 4h apart, tolerance = 1.
    const labels = classifyHours([wet, dry, dry, dry, dry], [dry, dry, dry, dry, wet]);
    expect(labels[0]).toBe("false_alarm");
    expect(labels[4]).toBe("miss");
  });
});

describe("timingScore (Critical Success Index)", () => {
  it("returns hits / (hits + misses + false_alarms)", () => {
    expect(timingScore(["hit", "hit", "miss", "correct_dry"])).toBeCloseTo(2 / 3);
    expect(timingScore(["hit", "hit"])).toBeCloseTo(1);
    expect(timingScore(["miss", "miss"])).toBeCloseTo(0);
    expect(timingScore(["hit", "miss", "false_alarm"])).toBeCloseTo(1 / 3);
  });

  it("penalises false alarms — a bare hit rate would have ignored them", () => {
    // One hit, one false alarm → CSI 0.5 (POD would say 1.0).
    expect(timingScore(["hit", "false_alarm", "correct_dry"])).toBeCloseTo(0.5);
    // Pure false alarms, no truth-wet hours → 0, NOT NaN: crying wolf is scored.
    expect(timingScore(["correct_dry", "correct_dry", "false_alarm"])).toBeCloseTo(0);
  });

  it("returns NaN only when nothing happened (all correct-dry / empty)", () => {
    expect(timingScore(["correct_dry", "correct_dry"])).toBeNaN();
    expect(timingScore([])).toBeNaN();
  });

  it("ignores no_data hours — missing forecast is excluded, not counted as a miss", () => {
    expect(timingScore(["hit", "no_data", "miss"])).toBeCloseTo(1 / 2);
    expect(timingScore(["hit", "no_data", "no_data"])).toBeCloseTo(1);
    // All-no_data has no events → undefined, same as empty.
    expect(timingScore(["no_data", "no_data"])).toBeNaN();
  });
});

describe("coveredPrecipSums", () => {
  it("sums truth only over hours the forecast covers", () => {
    // Forecast covers hours 0–1 (sum 3); drops out for hours 2–3 where it rained.
    const { forecastSum, truthSum } = coveredPrecipSums([1, 2, null, null], [1, 1, 5, 5]);
    expect(forecastSum).toBeCloseTo(3);
    expect(truthSum).toBeCloseTo(2); // 1 + 1, NOT 1 + 1 + 5 + 5 = the tail is ignored
  });

  it("treats a covered hour with null truth as zero truth (forecast still counts)", () => {
    const { forecastSum, truthSum } = coveredPrecipSums([1, 2], [null, 1]);
    expect(forecastSum).toBeCloseTo(3);
    expect(truthSum).toBeCloseTo(1);
  });

  it("is zero/zero when the forecast covers nothing", () => {
    expect(coveredPrecipSums([null, null], [4, 6])).toEqual({ forecastSum: 0, truthSum: 0 });
  });
});

describe("WET_THRESHOLD_MM_PER_H", () => {
  it("is small enough to count drizzle but exclude trace noise", () => {
    expect(WET_THRESHOLD_MM_PER_H).toBeGreaterThan(0);
    expect(WET_THRESHOLD_MM_PER_H).toBeLessThanOrEqual(0.2);
  });
});

// Local alias so the `.map(aggregate)` call sites read unchanged.
const aggregate = (value: number | null): AggregatePoint => aggPoint(value, { time: "ignored" });

describe("buildDailyVerification", () => {
  it("emits one entry per full 24-hour day, dropping any trailing partial day", () => {
    const hours = HOURS_PER_DAY * 7 + 5; // 7 full days plus a stub
    const result = buildDailyVerification({
      runDate: "2026-05-11",
      times: array(hours, (i) => `t${i}`).map(String),
      channels: {
        temperature_2m: {
          aggregate: array(hours, () => 20).map(aggregate),
          perModel: { ecmwf_ifs: array(hours, () => 21) },
          truth: array(hours, () => 19),
          predictability: array(hours, () => 0.8),
        },
        precipitation: {
          aggregate: array(hours, () => 0).map(aggregate),
          perModel: { ecmwf_ifs: array(hours, () => 0) },
          truth: array(hours, () => 0),
          predictability: array(hours, () => 0.5),
        },
      },
    });
    expect(result).toHaveLength(7);
    expect(result[0]?.dayIndex).toBe(0);
    expect(result[0]?.leadHoursStart).toBe(0);
    expect(result[0]?.leadHoursEnd).toBe(24);
    expect(result[6]?.leadHoursStart).toBe(6 * 24);
    expect(result[6]?.leadHoursEnd).toBe(7 * 24);
  });

  it("computes aggregate temperature bias and mae per day from the 24 hourly errors", () => {
    const hours = HOURS_PER_DAY;
    const result = buildDailyVerification({
      runDate: "2026-05-11",
      times: array(hours, (i) => String(i)),
      channels: {
        temperature_2m: {
          aggregate: array(hours, () => 21).map(aggregate), // forecast 21
          perModel: {},
          truth: array(hours, () => 19), // truth 19 → bias +2, mae 2
          predictability: array(hours, () => 0.8),
        },
        precipitation: {
          aggregate: array(hours, () => 0).map(aggregate),
          perModel: {},
          truth: array(hours, () => 0),
          predictability: array(hours, () => 0.5),
        },
      },
    });
    const t = result[0]?.aggregate.temperature;
    expect(t?.bias).toBeCloseTo(2);
    expect(t?.mae).toBeCloseTo(2);
    expect(t?.predictability).toBeCloseTo(0.8);
    expect(t?.forecastMin).toBeCloseTo(21);
    expect(t?.forecastMax).toBeCloseTo(21);
    expect(t?.truthMin).toBeCloseTo(19);
    expect(t?.truthMax).toBeCloseTo(19);
  });

  it("computes aggregate precipitation amount and timing per day", () => {
    const hours = HOURS_PER_DAY;
    // Forecast: 1mm at hours 10-12 (3mm total). Truth: 1mm at hours 11-13 (3mm total).
    // Amount error = 0. Timing: 1h shift → all 3 truth-wet hours within ±1 of forecast → 3 hits.
    const forecastP = array(hours, (i) => (i >= 10 && i <= 12 ? 1 : 0));
    const truthP = array(hours, (i) => (i >= 11 && i <= 13 ? 1 : 0));
    const result = buildDailyVerification({
      runDate: "2026-05-11",
      times: array(hours, (i) => String(i)),
      channels: {
        temperature_2m: {
          aggregate: array(hours, () => 20).map(aggregate),
          perModel: {},
          truth: array(hours, () => 20),
          predictability: array(hours, () => 0.5),
        },
        precipitation: {
          aggregate: forecastP.map(aggregate),
          perModel: {},
          truth: truthP,
          predictability: array(hours, () => 0.5),
        },
      },
    });
    const p = result[0]?.aggregate.precipitation;
    expect(p?.amountError).toBeCloseTo(0);
    expect(p?.timingScore).toBeCloseTo(1); // 3 hits, no misses or false alarms → CSI 1
    expect(p?.forecastSum).toBeCloseTo(3);
    expect(p?.truthSum).toBeCloseTo(3);
    expect(p?.hourlyClassification).toHaveLength(HOURS_PER_DAY);
  });

  it("emits per-model scores keyed by model id with NaN predictability", () => {
    const hours = HOURS_PER_DAY;
    const result = buildDailyVerification({
      runDate: "2026-05-11",
      times: array(hours, (i) => String(i)),
      channels: {
        temperature_2m: {
          aggregate: array(hours, () => 20).map(aggregate),
          perModel: {
            ecmwf_ifs: array(hours, () => 22),
            gfs_seamless: array(hours, () => 18),
          },
          truth: array(hours, () => 20),
          predictability: array(hours, () => 0.8),
        },
        precipitation: {
          aggregate: array(hours, () => 0).map(aggregate),
          perModel: {
            ecmwf_ifs: array(hours, () => 0),
            gfs_seamless: array(hours, () => 0),
          },
          truth: array(hours, () => 0),
          predictability: array(hours, () => 0.5),
        },
      },
    });
    const day = result[0];
    expect(day).toBeDefined();
    expect(Object.keys(day!.perModel)).toEqual(expect.arrayContaining(["ecmwf_ifs", "gfs_seamless"]));
    expect(day!.perModel.ecmwf_ifs?.temperature?.bias).toBeCloseTo(2);
    expect(day!.perModel.gfs_seamless?.temperature?.bias).toBeCloseTo(-2);
    expect(day!.perModel.ecmwf_ifs?.temperature?.predictability).toBeNaN();
  });

  it("returns null per-variable score when both forecast and truth are all-null", () => {
    const hours = HOURS_PER_DAY;
    const result = buildDailyVerification({
      runDate: "2026-05-11",
      times: array(hours, (i) => String(i)),
      channels: {
        temperature_2m: {
          aggregate: array(hours, () => 20).map(aggregate),
          perModel: {},
          truth: array(hours, () => 20),
          predictability: array(hours, () => 0.8),
        },
        precipitation: {
          aggregate: array(hours, () => null).map(aggregate), // no contributing models → null
          perModel: {},
          truth: Array.from({ length: hours }, () => null),
          predictability: array(hours, () => 0.5),
        },
      },
    });
    expect(result[0]?.aggregate.precipitation).toBeNull();
    expect(result[0]?.aggregate.temperature).not.toBeNull();
  });

  it("returns null precipitation score when forecast is all-null but truth has data (B1)", () => {
    const hours = HOURS_PER_DAY;
    const result = buildDailyVerification({
      runDate: "2026-05-11",
      times: array(hours, (i) => String(i)),
      channels: {
        temperature_2m: {
          aggregate: array(hours, () => 20).map(aggregate),
          perModel: {},
          truth: array(hours, () => 20),
          predictability: array(hours, () => 0.8),
        },
        precipitation: {
          aggregate: array(hours, () => null).map(aggregate),
          // Model with no precipitation data at all — used to be scored as
          // amountError = −truthSum, which was misleading.
          perModel: { ghost_model: Array.from({ length: hours }, () => null) },
          truth: array(hours, (i) => (i >= 10 && i <= 13 ? 2 : 0)),
          predictability: array(hours, () => 0.5),
        },
      },
    });
    expect(result[0]?.aggregate.precipitation).toBeNull();
    expect(result[0]?.perModel.ghost_model?.precipitation).toBeNull();
  });
});
