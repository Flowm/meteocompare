import { describe, it, expect } from "vitest";

import type { AggregatePoint } from "./aggregate";
import { confidenceFor, confidenceTier } from "./confidence";

function mkPoint(perModel: Record<string, number | null>, weights: Record<string, number>, value: number, stdDev: number): AggregatePoint {
  return { time: "2026-05-20T00:00", value, stdDev, perModel, weights };
}

describe("confidenceFor", () => {
  it("is high when models all agree at short lead time", () => {
    const p = mkPoint({ a: 10, b: 10, c: 10, d: 10 }, { a: 0.25, b: 0.25, c: 0.25, d: 0.25 }, 10, 0);
    expect(confidenceFor(p, "temperature_2m", 6)).toBeGreaterThan(0.9);
  });

  it("is low when models disagree wildly", () => {
    const p = mkPoint({ a: 5, b: 25, c: 10, d: 20 }, { a: 0.25, b: 0.25, c: 0.25, d: 0.25 }, 15, 7.9);
    expect(confidenceFor(p, "temperature_2m", 6)).toBeLessThan(0.3);
  });

  it("is penalised when only one model contributes", () => {
    const full = mkPoint({ a: 10, b: 10, c: 10, d: 10 }, { a: 0.25, b: 0.25, c: 0.25, d: 0.25 }, 10, 0);
    const single = mkPoint({ a: 10 }, { a: 1 }, 10, 0);
    expect(confidenceFor(single, "temperature_2m", 6)).toBeCloseTo(confidenceFor(full, "temperature_2m", 6) / 3, 2);
  });

  it("is stable across lead times when models agree (lead decay is weight-layer only)", () => {
    const p = mkPoint({ a: 10, b: 10, c: 10, d: 10 }, { a: 0.25, b: 0.25, c: 0.25, d: 0.25 }, 10, 0);
    const c24 = confidenceFor(p, "temperature_2m", 24);
    const c240 = confidenceFor(p, "temperature_2m", 240);
    // Agreement and spread don't change when models agree — only model count matters.
    expect(c24).toBeCloseTo(c240, 5);
  });

  it("scores high for small hourly precipitation spread", () => {
    // stdDev 0.2 mm/h vs typicalSpread 1.5 mm/h → spreadScore ≈ 0.87
    const p = mkPoint({ a: 1.0, b: 1.4, c: 1.2, d: 0.8 }, { a: 0.25, b: 0.25, c: 0.25, d: 0.25 }, 1.1, 0.2);
    expect(confidenceFor(p, "precipitation", 12)).toBeGreaterThan(0.7);
  });

  it("uses daily-scale typicalSpread for precipitation_sum", () => {
    // stdDev 3 mm/day vs typicalSpread 5 mm/day → spreadScore ≈ 0.4; same stdDev hourly → 0
    const p = mkPoint({ a: 8, b: 5, c: 7, d: 4 }, { a: 0.25, b: 0.25, c: 0.25, d: 0.25 }, 6, 1.58);
    const hourly = confidenceFor(p, "precipitation", 12, "hourly");
    const daily = confidenceFor(p, "precipitation", 12, "daily");
    expect(daily).toBeGreaterThan(hourly);
  });

  it("treats weather_code by severity group agreement", () => {
    const p = mkPoint(
      { a: 61, b: 63, c: 80, d: 0 }, // 3 in 'rain' group, 1 'clear'
      { a: 0.25, b: 0.25, c: 0.25, d: 0.25 },
      63, // aggregate picked rain
      0,
    );
    const c = confidenceFor(p, "weather_code", 12);
    expect(c).toBeGreaterThan(0.6);
    expect(c).toBeLessThan(0.9);
  });
});

describe("confidenceTier", () => {
  it("maps numbers to tiers", () => {
    expect(confidenceTier(0.9)).toBe("high");
    expect(confidenceTier(0.5)).toBe("mid");
    expect(confidenceTier(0.2)).toBe("low");
  });
});
