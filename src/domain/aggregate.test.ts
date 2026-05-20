import { describe, it, expect } from "vitest";

import { aggregateSeries } from "./aggregate";
import { getModel } from "./models";

const PARIS = { lat: 48.85, lon: 2.35 };
const subset = [getModel("ecmwf_ifs025")!, getModel("gfs_global")!, getModel("icon_global")!, getModel("meteofrance_seamless")!];

function makeTimes(n: number, baseISO: string): string[] {
  const base = new Date(baseISO).getTime();
  return Array.from({ length: n }, (_, i) => new Date(base + i * 3_600_000).toISOString().slice(0, 16));
}

describe("aggregateSeries (temperature)", () => {
  it("computes a weighted mean and zero stddev for unanimous inputs", () => {
    const baseTime = new Date("2026-05-20T00:00:00Z");
    const times = makeTimes(4, "2026-05-20T00:00:00Z");
    const series = {
      ecmwf_ifs025: [10, 11, 12, 13],
      gfs_global: [10, 11, 12, 13],
      icon_global: [10, 11, 12, 13],
      meteofrance_seamless: [10, 11, 12, 13],
    };
    const out = aggregateSeries(times, series, {
      variable: "temperature_2m",
      models: subset,
      lat: PARIS.lat,
      lon: PARIS.lon,
      baseTime,
    });
    expect(out).toHaveLength(4);
    expect(out[0].value).toBeCloseTo(10, 5);
    expect(out[3].value).toBeCloseTo(13, 5);
    for (const p of out) expect(p.stdDev).toBeCloseTo(0, 5);
  });

  it("produces a non-zero stddev when models disagree", () => {
    const baseTime = new Date("2026-05-20T00:00:00Z");
    const times = makeTimes(1, "2026-05-20T00:00:00Z");
    const series = {
      ecmwf_ifs025: [10],
      gfs_global: [14],
      icon_global: [12],
      meteofrance_seamless: [11],
    };
    const out = aggregateSeries(times, series, {
      variable: "temperature_2m",
      models: subset,
      lat: PARIS.lat,
      lon: PARIS.lon,
      baseTime,
    });
    expect(out[0].stdDev).toBeGreaterThan(0);
    expect(out[0].value).toBeGreaterThan(10);
    expect(out[0].value).toBeLessThan(14);
  });

  it("handles null per-model values without crashing", () => {
    const baseTime = new Date("2026-05-20T00:00:00Z");
    const times = makeTimes(1, "2026-05-20T00:00:00Z");
    const series = {
      ecmwf_ifs025: [10],
      gfs_global: [null],
      icon_global: [null],
      meteofrance_seamless: [null],
    };
    const out = aggregateSeries(times, series, {
      variable: "temperature_2m",
      models: subset,
      lat: PARIS.lat,
      lon: PARIS.lon,
      baseTime,
    });
    expect(out[0].value).toBeCloseTo(10, 5);
  });
});

describe("aggregateSeries (wind_direction_10m)", () => {
  const baseTime = new Date("2026-05-20T00:00:00Z");
  const times = makeTimes(1, "2026-05-20T00:00:00Z");

  it("averages angles that straddle 0/360° correctly", () => {
    // 350° and 10° should average to 0°/360°, not 180°.
    const out = aggregateSeries(
      times,
      {
        ecmwf_ifs025: [350],
        gfs_global: [10],
        icon_global: [355],
        meteofrance_seamless: [5],
      },
      {
        variable: "wind_direction_10m",
        models: subset,
        lat: PARIS.lat,
        lon: PARIS.lon,
        baseTime,
      },
    );
    // Allow either side of the wrap.
    const v = out[0].value;
    const distFromNorth = Math.min(v, 360 - v);
    expect(distFromNorth).toBeLessThan(2);
  });

  it("reports a small angular stddev for tight agreement", () => {
    const out = aggregateSeries(
      times,
      {
        ecmwf_ifs025: [180],
        gfs_global: [185],
        icon_global: [175],
        meteofrance_seamless: [180],
      },
      {
        variable: "wind_direction_10m",
        models: subset,
        lat: PARIS.lat,
        lon: PARIS.lon,
        baseTime,
      },
    );
    expect(out[0].value).toBeCloseTo(180, 0);
    expect(out[0].stdDev).toBeLessThan(10);
  });

  it("reports a large angular stddev when models are opposite", () => {
    const out = aggregateSeries(
      times,
      {
        ecmwf_ifs025: [0],
        gfs_global: [180],
        icon_global: [0],
        meteofrance_seamless: [180],
      },
      {
        variable: "wind_direction_10m",
        models: subset,
        lat: PARIS.lat,
        lon: PARIS.lon,
        baseTime,
      },
    );
    // Mean resultant length → 0, so circular stddev should be huge.
    expect(out[0].stdDev).toBeGreaterThan(90);
  });
});

describe("aggregateSeries (weather_code)", () => {
  it("picks the severity-weighted modal code", () => {
    const baseTime = new Date("2026-05-20T00:00:00Z");
    const times = makeTimes(1, "2026-05-20T00:00:00Z");
    // 3 models say "rain" (61, 63, 80), 1 says "clear" (0).
    const series = {
      ecmwf_ifs025: [61],
      gfs_global: [63],
      icon_global: [80],
      meteofrance_seamless: [0],
    };
    const out = aggregateSeries(times, series, {
      variable: "weather_code",
      models: subset,
      lat: PARIS.lat,
      lon: PARIS.lon,
      baseTime,
    });
    // Should land somewhere in the rain group.
    expect([61, 63, 80]).toContain(out[0].value);
  });
});
