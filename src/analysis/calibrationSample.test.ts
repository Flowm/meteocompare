import { describe, expect, it } from "vitest";

import type { DailyVerification } from "@/domain/verification";

import { calibrationPoints } from "./calibrationSample";
import type { RunEvaluation } from "./runEvaluation";

function mkDay(over: {
  dayIndex?: number;
  temp?: { predictability: number; forecastMax: number; truthMax: number } | null;
  precip?: { predictability: number; forecastSum: number; truthSum: number } | null;
}): DailyVerification {
  const dayIndex = over.dayIndex ?? 0;
  return {
    runDate: "2026-07-01",
    dayIndex,
    leadHoursStart: dayIndex * 24,
    leadHoursEnd: (dayIndex + 1) * 24,
    aggregate: {
      temperature: over.temp === null ? null : { bias: 0, mae: 0, predictability: 0.7, forecastMin: 10, truthMin: 10, forecastMax: 20, truthMax: 20, ...over.temp },
      precipitation: over.precip === null ? null : { amountError: 0, timingScore: 1, predictability: 0.6, forecastSum: 0, truthSum: 0, hourlyClassification: [], ...over.precip },
    },
    perModel: {},
  } as DailyVerification;
}

const mkRun = (daily: DailyVerification[]): RunEvaluation => ({ daily }) as unknown as RunEvaluation;

describe("calibrationPoints", () => {
  it("emits one temperature and one precipitation point per scored day, at the day's lead midpoint", () => {
    const points = calibrationPoints([mkRun([mkDay({ dayIndex: 2 })])]);
    expect(points).toHaveLength(2);
    expect(points[0]).toMatchObject({ variable: "temperature_2m", leadHours: 60, raw: 0.7 });
    expect(points[1]).toMatchObject({ variable: "precipitation", leadHours: 60, raw: 0.6 });
  });

  it("scores the temperature hit as |t_max error| ≤ 2 °C", () => {
    const points = calibrationPoints([
      mkRun([mkDay({ temp: { predictability: 0.7, forecastMax: 22, truthMax: 20 } }), mkDay({ dayIndex: 1, temp: { predictability: 0.7, forecastMax: 22.1, truthMax: 20 } })]),
    ]);
    const temps = points.filter((p) => p.variable === "temperature_2m");
    expect(temps[0]?.hit).toBe(true); // exactly 2 °C off is still a hit
    expect(temps[1]?.hit).toBe(false);
  });

  it("scores the precipitation hit as a matching wet/dry call at ≥ 1 mm/day", () => {
    const wetWet = mkDay({ precip: { predictability: 0.6, forecastSum: 5, truthSum: 2 } });
    const dryDrizzle = mkDay({ dayIndex: 1, precip: { predictability: 0.6, forecastSum: 0, truthSum: 0.4 } });
    const missedRain = mkDay({ dayIndex: 2, precip: { predictability: 0.6, forecastSum: 0.2, truthSum: 8 } });
    const precip = calibrationPoints([mkRun([wetWet, dryDrizzle, missedRain])]).filter((p) => p.variable === "precipitation");
    expect(precip.map((p) => p.hit)).toEqual([true, true, false]); // ERA5 drizzle under 1 mm is "dry"
  });

  it("skips days with a missing or non-finite score instead of fabricating outcomes", () => {
    const noTemp = mkDay({ temp: null });
    const nanRaw = mkDay({ dayIndex: 1, temp: { predictability: NaN, forecastMax: 20, truthMax: 20 } });
    const points = calibrationPoints([mkRun([noTemp, nanRaw])]);
    expect(points.filter((p) => p.variable === "temperature_2m")).toHaveLength(0);
    expect(points.filter((p) => p.variable === "precipitation")).toHaveLength(2); // precip side of both days still scores
  });
});
