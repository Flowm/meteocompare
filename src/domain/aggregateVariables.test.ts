import { describe, it, expect } from "vitest";

import { PARIS, makeTimes, modelSubset } from "@/test/fixtures";

import { aggregateSeries } from "./aggregate";
import { aggregateVariables } from "./aggregateVariables";
import { predictabilityFor } from "./predictability";

const subset = modelSubset();

const baseTime = new Date("2026-05-20T00:00:00Z");

describe("aggregateVariables — index→lead-hours convention", () => {
  // The whole reason this module exists: the lead-hours rule used to be
  // copy-pasted (i for hourly, i*24+12 for daily) and could drift. Pin it.
  it("uses lead = index for hourly and index*24+12 for daily", () => {
    const times = makeTimes(2, "2026-05-20T00:00:00Z");
    // Small disagreement so predictability sits strictly inside (0,1) for both leads
    // (no clamping) — the typicalSpread band differs between lead 1 and lead 36.
    const perModel = {
      temperature_2m: {
        ecmwf_ifs: [10, 10],
        gfs_seamless: [10.6, 10.6],
        icon_global: [10.3, 10.3],
        meteofrance_seamless: [10.1, 10.1],
      },
    };
    const opts = { times, perModel, vars: [{ key: "temperature_2m", family: "temperature_2m" as const }], models: subset, lat: PARIS.lat, lon: PARIS.lon, baseTime };

    const hourly = aggregateVariables({ ...opts, cadence: "hourly" });
    const daily = aggregateVariables({ ...opts, cadence: "daily" });

    // The aggregate points themselves are identical (same times/baseTime/models);
    // only the predictability lead differs.
    const point = hourly.aggregate.temperature_2m![1]!;
    expect(hourly.predictability.temperature_2m![1]).toBeCloseTo(predictabilityFor(point, "temperature_2m", 1, "hourly"), 10);
    expect(daily.predictability.temperature_2m![1]).toBeCloseTo(predictabilityFor(point, "temperature_2m", 36, "daily"), 10);
    // And they genuinely differ — a wrong copy-paste would collapse them.
    expect(daily.predictability.temperature_2m![1]).not.toBeCloseTo(hourly.predictability.temperature_2m![1]!, 5);
  });
});

describe("aggregateVariables — key vs family", () => {
  it("keys the result by `key` but weights/scores by `family`", () => {
    const times = makeTimes(1, "2026-05-20T00:00:00Z");
    const byModel = { ecmwf_ifs: [18], gfs_seamless: [22], icon_global: [20], meteofrance_seamless: [19] };
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
    expect("temperature_2m" in out.aggregate).toBe(false);
    // …but the value matches weighting under the temperature_2m family.
    const direct = aggregateSeries(times, byModel, { variable: "temperature_2m", models: subset, lat: PARIS.lat, lon: PARIS.lon, baseTime });
    expect(out.aggregate.temperature_2m_max![0]!.value).toBeCloseTo(direct[0]!.value!, 10);
  });
});

describe("aggregateVariables — shape", () => {
  it("echoes perModel and keys aggregate/predictability per variable, lengths match times", () => {
    const times = makeTimes(3, "2026-05-20T00:00:00Z");
    const perModel = {
      temperature_2m: { ecmwf_ifs: [10, 11, 12], gfs_seamless: [10, 11, 12], icon_global: [10, 11, 12], meteofrance_seamless: [10, 11, 12] },
      precipitation: { ecmwf_ifs: [0, 1, 0], gfs_seamless: [0, 1, 0], icon_global: [0, 2, 0], meteofrance_seamless: [0, 1, 0] },
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
    expect(out.predictability.precipitation).toHaveLength(3);
    // Independence: precip disagreement at index 1 does not perturb temperature predictability.
    expect(out.predictability.temperature_2m![0]).toBeCloseTo(out.predictability.temperature_2m![1]!, 10);
  });
});

describe("aggregateVariables — weather_code is lead-independent", () => {
  it("scores weather_code by agreement, so cadence does not change predictability", () => {
    const times = makeTimes(1, "2026-05-20T00:00:00Z");
    const perModel = { weather_code: { ecmwf_ifs: [61], gfs_seamless: [63], icon_global: [80], meteofrance_seamless: [0] } };
    const vars = [{ key: "weather_code", family: "weather_code" as const }];
    const base = { times, perModel, vars, models: subset, lat: PARIS.lat, lon: PARIS.lon, baseTime };

    const hourly = aggregateVariables({ ...base, cadence: "hourly" });
    const daily = aggregateVariables({ ...base, cadence: "daily" });
    expect(daily.predictability.weather_code![0]).toBeCloseTo(hourly.predictability.weather_code![0]!, 10);
    expect(hourly.predictability.weather_code![0]).toBeGreaterThanOrEqual(0);
    expect(hourly.predictability.weather_code![0]).toBeLessThanOrEqual(1);
  });
});

describe("aggregateVariables — degenerate input", () => {
  it("yields a null aggregate value and zero predictability when every model is null", () => {
    const times = makeTimes(1, "2026-05-20T00:00:00Z");
    const perModel = { temperature_2m: { ecmwf_ifs: [null], gfs_seamless: [null], icon_global: [null], meteofrance_seamless: [null] } };
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
    expect(out.aggregate.temperature_2m![0]!.value).toBeNull();
    expect(out.predictability.temperature_2m![0]).toBe(0);
  });
});
