import { describe, expect, it } from "vitest";

import { isVarActive, nextCombinableView } from "./chartHelpers";

describe("nextCombinableView", () => {
  it("adds the second variable to form the composite", () => {
    expect(nextCombinableView("temperature_2m", "precipitation")).toBe("temp_precip");
    expect(nextCombinableView("precipitation", "temperature_2m")).toBe("temp_precip");
  });

  it("toggling one half of the composite drops back to the other single view", () => {
    expect(nextCombinableView("temp_precip", "precipitation")).toBe("temperature_2m");
    expect(nextCombinableView("temp_precip", "temperature_2m")).toBe("precipitation");
  });

  it("toggling off the last remaining variable is a no-op (never empties)", () => {
    expect(nextCombinableView("temperature_2m", "temperature_2m")).toBe("temperature_2m");
    expect(nextCombinableView("precipitation", "precipitation")).toBe("precipitation");
  });

  it("focuses the click when coming from an exclusive view", () => {
    expect(nextCombinableView("wind_speed_10m", "temperature_2m")).toBe("temperature_2m");
    expect(nextCombinableView("cloud_cover", "precipitation")).toBe("precipitation");
  });
});

describe("isVarActive", () => {
  it("treats either half of the composite as active when combinable", () => {
    expect(isVarActive("temp_precip", "temperature_2m", true)).toBe(true);
    expect(isVarActive("temp_precip", "precipitation", true)).toBe(true);
    expect(isVarActive("temperature_2m", "temperature_2m", true)).toBe(true);
    expect(isVarActive("temperature_2m", "precipitation", true)).toBe(false);
  });

  it("falls back to exact-match when not combinable", () => {
    expect(isVarActive("temperature_2m", "temperature_2m", false)).toBe(true);
    expect(isVarActive("temp_precip", "temperature_2m", false)).toBe(false);
  });

  it("matches exclusive views exactly regardless of combinability", () => {
    expect(isVarActive("wind_speed_10m", "wind_speed_10m", true)).toBe(true);
    expect(isVarActive("wind_speed_10m", "cloud_cover", true)).toBe(false);
  });
});
