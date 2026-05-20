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

  it("drops with lead time even when models agree", () => {
    const p = mkPoint({ a: 10, b: 10, c: 10, d: 10 }, { a: 0.25, b: 0.25, c: 0.25, d: 0.25 }, 10, 0);
    const c24 = confidenceFor(p, "temperature_2m", 24);
    const c240 = confidenceFor(p, "temperature_2m", 240);
    expect(c24).toBeGreaterThan(c240);
    expect(c240).toBeLessThanOrEqual(0.25);
  });

  it("uses precipitation tolerance in mm, not °C", () => {
    // 0.5 mm spread should count as agreement for precip…
    const p = mkPoint({ a: 1.0, b: 1.4, c: 1.2, d: 0.8 }, { a: 0.25, b: 0.25, c: 0.25, d: 0.25 }, 1.1, 0.2);
    expect(confidenceFor(p, "precipitation", 12)).toBeGreaterThan(0.7);
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
