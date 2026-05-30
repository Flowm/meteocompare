import { describe, it, expect } from "vitest";

import { aggregateSeries } from "./aggregate";
import { aggregateVariables } from "./aggregateVariables";
import { confidenceFor } from "./confidence";
import { getModel } from "./models";

const PARIS = { lat: 48.85, lon: 2.35 };
const subset = [getModel("ecmwf_ifs025")!, getModel("gfs_global")!, getModel("icon_global")!, getModel("meteofrance_seamless")!];

function makeTimes(n: number, baseISO: string): string[] {
  const base = new Date(baseISO).getTime();
  return Array.from({ length: n }, (_, i) => new Date(base + i * 3_600_000).toISOString().slice(0, 16));
}

const baseTime = new Date("2026-05-20T00:00:00Z");

describe("aggregateVariables — index→lead-hours convention", () => {
  // The whole reason this module exists: the lead-hours rule used to be
  // copy-pasted (i for hourly, i*24+12 for daily) and could drift. Pin it.
  it("uses lead = index for hourly and index*24+12 for daily", () => {
    const times = makeTimes(2, "2026-05-20T00:00:00Z");
    // Small disagreement so confidence sits strictly inside (0,1) for both leads
    // (no clamping) — the typicalSpread band differs between lead 1 and lead 36.
    const perModel = {
      temperature_2m: {
        ecmwf_ifs025: [10, 10],
        gfs_global: [10.6, 10.6],
        icon_global: [10.3, 10.3],
        meteofrance_seamless: [10.1, 10.1],
      },
    };
    const opts = { times, perModel, vars: [{ key: "temperature_2m", family: "temperature_2m" as const }], models: subset, lat: PARIS.lat, lon: PARIS.lon, baseTime };

    const hourly = aggregateVariables({ ...opts, cadence: "hourly" });
    const daily = aggregateVariables({ ...opts, cadence: "daily" });

    // The aggregate points themselves are identical (same times/baseTime/models);
    // only the confidence lead differs.
    const point = hourly.aggregate.temperature_2m![1]!;
    expect(hourly.confidence.temperature_2m![1]).toBeCloseTo(confidenceFor(point, "temperature_2m", 1, "hourly"), 10);
    expect(daily.confidence.temperature_2m![1]).toBeCloseTo(confidenceFor(point, "temperature_2m", 36, "daily"), 10);
    // And they genuinely differ — a wrong copy-paste would collapse them.
    expect(daily.confidence.temperature_2m![1]).not.toBeCloseTo(hourly.confidence.temperature_2m![1]!, 5);
  });
});

describe("aggregateVariables — key vs family", () => {
  it("keys the result by `key` but weights/scores by `family`", () => {
    const times = makeTimes(1, "2026-05-20T00:00:00Z");
    const byModel = { ecmwf_ifs025: [18], gfs_global: [22], icon_global: [20], meteofrance_seamless: [19] };
    const out = aggregateVariables({
      times,
      perModel: { temperature_2m_max: byModel },
      vars: [{ key: "temperature_2m_max", family: "temperature_2m" }],
      models: subset,
      lat: PARIS.lat,
      lon: PARIS.lon,
      baseTime,
      cadence: "daily",
    });
    // Result slot is the fetched key…
    expect(out.aggregate.temperature_2m_max).toBeDefined();
    expect(out.aggregate.temperature_2m).toBeUndefined();
    // …but the value matches weighting under the temperature_2m family.
    const direct = aggregateSeries(times, byModel, { variable: "temperature_2m", models: subset, lat: PARIS.lat, lon: PARIS.lon, baseTime });
    expect(out.aggregate.temperature_2m_max![0]!.value).toBeCloseTo(direct[0]!.value, 10);
  });
});

describe("aggregateVariables — shape", () => {
  it("echoes perModel and keys aggregate/confidence per variable, lengths match times", () => {
    const times = makeTimes(3, "2026-05-20T00:00:00Z");
    const perModel = {
      temperature_2m: { ecmwf_ifs025: [10, 11, 12], gfs_global: [10, 11, 12], icon_global: [10, 11, 12], meteofrance_seamless: [10, 11, 12] },
      precipitation: { ecmwf_ifs025: [0, 1, 0], gfs_global: [0, 1, 0], icon_global: [0, 2, 0], meteofrance_seamless: [0, 1, 0] },
    };
    const out = aggregateVariables({
      times,
      perModel,
      vars: [
        { key: "temperature_2m", family: "temperature_2m" },
        { key: "precipitation", family: "precipitation" },
      ],
      models: subset,
      lat: PARIS.lat,
      lon: PARIS.lon,
      baseTime,
      cadence: "hourly",
    });
    expect(out.perModel).toBe(perModel); // echoed by reference — drop-in view-model
    expect(Object.keys(out.aggregate).toSorted()).toEqual(["precipitation", "temperature_2m"]);
    expect(out.aggregate.temperature_2m).toHaveLength(3);
    expect(out.confidence.precipitation).toHaveLength(3);
    // Independence: precip disagreement at index 1 does not perturb temperature confidence.
    expect(out.confidence.temperature_2m![0]).toBeCloseTo(out.confidence.temperature_2m![1]!, 10);
  });
});

describe("aggregateVariables — weather_code is lead-independent", () => {
  it("scores weather_code by agreement, so cadence does not change confidence", () => {
    const times = makeTimes(1, "2026-05-20T00:00:00Z");
    const perModel = { weather_code: { ecmwf_ifs025: [61], gfs_global: [63], icon_global: [80], meteofrance_seamless: [0] } };
    const vars = [{ key: "weather_code", family: "weather_code" as const }];
    const base = { times, perModel, vars, models: subset, lat: PARIS.lat, lon: PARIS.lon, baseTime };

    const hourly = aggregateVariables({ ...base, cadence: "hourly" });
    const daily = aggregateVariables({ ...base, cadence: "daily" });
    expect(daily.confidence.weather_code![0]).toBeCloseTo(hourly.confidence.weather_code![0]!, 10);
    expect(hourly.confidence.weather_code![0]).toBeGreaterThanOrEqual(0);
    expect(hourly.confidence.weather_code![0]).toBeLessThanOrEqual(1);
  });
});

describe("aggregateVariables — degenerate input", () => {
  it("yields a NaN aggregate value and zero confidence when every model is null", () => {
    const times = makeTimes(1, "2026-05-20T00:00:00Z");
    const perModel = { temperature_2m: { ecmwf_ifs025: [null], gfs_global: [null], icon_global: [null], meteofrance_seamless: [null] } };
    const out = aggregateVariables({
      times,
      perModel,
      vars: [{ key: "temperature_2m", family: "temperature_2m" }],
      models: subset,
      lat: PARIS.lat,
      lon: PARIS.lon,
      baseTime,
      cadence: "hourly",
    });
    expect(Number.isNaN(out.aggregate.temperature_2m![0]!.value)).toBe(true);
    expect(out.confidence.temperature_2m![0]).toBe(0);
  });
});
