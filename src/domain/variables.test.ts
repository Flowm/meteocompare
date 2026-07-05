import { describe, it, expect } from "vitest";

import { VARIABLES, dailyBaseVariable, type Variable } from "./variables";

// The full Variable union — kept in sync with the type via the Record below.
const ALL_VARIABLES: Variable[] = ["temperature_2m", "precipitation", "precipitation_probability", "weather_code", "wind_speed_10m", "wind_direction_10m", "cloud_cover"];

describe("variable descriptor table", () => {
  it("has a descriptor row for every member of the Variable union", () => {
    // `Record<Variable, …>` already enforces this at compile time; this asserts
    // the runtime table is not missing a key and carries no stray one.
    expect(Object.keys(VARIABLES).toSorted()).toEqual([...ALL_VARIABLES].toSorted());
  });

  it("assigns each variable its reducer and predictability kind", () => {
    expect(VARIABLES.temperature_2m.reducer).toBe("mean");
    expect(VARIABLES.wind_direction_10m.reducer).toBe("circular");
    expect(VARIABLES.weather_code.reducer).toBe("mode");
    // weather_code is the only agreement-scored variable.
    for (const v of ALL_VARIABLES) {
      expect(VARIABLES[v].predictability).toBe(v === "weather_code" ? "agreement" : "spread");
    }
  });

  it("carries the CAM precipitation boost only on the two precip variables", () => {
    expect(VARIABLES.precipitation.camBoost).toBe(1.3);
    expect(VARIABLES.precipitation_probability.camBoost).toBe(1.3);
    for (const v of ALL_VARIABLES) {
      if (v === "precipitation" || v === "precipitation_probability") continue;
      expect(VARIABLES[v].camBoost).toBeUndefined();
    }
  });

  // Sampled at the four lead hours the plan calls out, matching the exact values
  // the previous per-variable typicalSpread switch produced.
  it("reproduces the previous typicalSpread bands (hourly)", () => {
    const ts = (v: Variable, lead: number): number => VARIABLES[v].typicalSpread(lead, "hourly");

    expect(ts("temperature_2m", 12)).toBeCloseTo(1, 10);
    expect(ts("temperature_2m", 48)).toBeCloseTo(1.5, 10);
    expect(ts("temperature_2m", 100)).toBeCloseTo(2.4375, 10);
    expect(ts("temperature_2m", 200)).toBeCloseTo(3.5, 10);

    expect(ts("precipitation", 12)).toBeCloseTo(1.5, 10);
    expect(ts("precipitation", 48)).toBeCloseTo(1.5, 10);
    expect(ts("precipitation", 100)).toBeCloseTo(2.5, 10);
    expect(ts("precipitation", 200)).toBeCloseTo(2.5, 10);

    expect(ts("precipitation_probability", 12)).toBe(25);
    expect(ts("cloud_cover", 200)).toBe(25);
    expect(ts("weather_code", 100)).toBe(1);

    expect(ts("wind_speed_10m", 12)).toBe(4);
    expect(ts("wind_speed_10m", 100)).toBe(7);
    expect(ts("wind_direction_10m", 48)).toBe(30);
    expect(ts("wind_direction_10m", 200)).toBe(70);
  });

  it("reproduces the previous typicalSpread bands (daily precipitation variant)", () => {
    const ts = (v: Variable, lead: number): number => VARIABLES[v].typicalSpread(lead, "daily");
    expect(ts("precipitation", 12)).toBe(5); // mm/day, ≤48
    expect(ts("precipitation", 48)).toBe(5);
    expect(ts("precipitation", 100)).toBe(10);
    expect(ts("precipitation", 200)).toBe(10);
    // Non-accumulated variables ignore resolution.
    expect(ts("temperature_2m", 48)).toBeCloseTo(1.5, 10);
  });
});

describe("dailyBaseVariable", () => {
  it("maps each daily variable to its base family", () => {
    expect(dailyBaseVariable("temperature_2m_max")).toBe("temperature_2m");
    expect(dailyBaseVariable("temperature_2m_min")).toBe("temperature_2m");
    expect(dailyBaseVariable("precipitation_sum")).toBe("precipitation");
    expect(dailyBaseVariable("precipitation_probability_max")).toBe("precipitation_probability");
    expect(dailyBaseVariable("wind_speed_10m_max")).toBe("wind_speed_10m");
    expect(dailyBaseVariable("wind_direction_10m_dominant")).toBe("wind_direction_10m");
    expect(dailyBaseVariable("weather_code")).toBe("weather_code");
  });

  it("throws on an unmapped daily variable", () => {
    expect(() => dailyBaseVariable("nonexistent")).toThrow();
  });
});
