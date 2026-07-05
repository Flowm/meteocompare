import { describe, it, expect } from "vitest";

import { PARIS, makeTimes, modelSubset } from "@/test/fixtures";

import { aggregateSeries } from "./aggregate";

const subset = modelSubset();

describe("aggregateSeries (temperature)", () => {
  it("computes a weighted mean and zero stddev for unanimous inputs", () => {
    const baseTime = new Date("2026-05-20T00:00:00Z");
    const times = makeTimes(4, "2026-05-20T00:00:00Z");
    const series = {
      ecmwf_ifs: [10, 11, 12, 13],
      gfs_seamless: [10, 11, 12, 13],
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
    expect(out[0]?.value).toBeCloseTo(10, 5);
    expect(out[3]?.value).toBeCloseTo(13, 5);
    for (const p of out) expect(p.stdDev).toBeCloseTo(0, 5);
  });

  it("produces a non-zero stddev when models disagree", () => {
    const baseTime = new Date("2026-05-20T00:00:00Z");
    const times = makeTimes(1, "2026-05-20T00:00:00Z");
    const series = {
      ecmwf_ifs: [10],
      gfs_seamless: [14],
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
    expect(out[0]?.stdDev).toBeGreaterThan(0);
    expect(out[0]?.value).toBeGreaterThan(10);
    expect(out[0]?.value).toBeLessThan(14);
  });

  it("handles null per-model values without crashing", () => {
    const baseTime = new Date("2026-05-20T00:00:00Z");
    const times = makeTimes(1, "2026-05-20T00:00:00Z");
    const series = {
      ecmwf_ifs: [10],
      gfs_seamless: [null],
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
    expect(out[0]?.value).toBeCloseTo(10, 5);
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
        ecmwf_ifs: [350],
        gfs_seamless: [10],
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
    const p0 = out[0];
    expect(p0).toBeDefined();
    if (!p0 || p0.value === null) return;
    const v = p0.value;
    const distFromNorth = Math.min(v, 360 - v);
    expect(distFromNorth).toBeLessThan(2);
  });

  it("reports a small angular stddev for tight agreement", () => {
    const out = aggregateSeries(
      times,
      {
        ecmwf_ifs: [180],
        gfs_seamless: [185],
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
    expect(out[0]?.value).toBeCloseTo(180, 0);
    expect(out[0]?.stdDev).toBeLessThan(10);
  });

  it("reports a large angular stddev when models are opposite", () => {
    const out = aggregateSeries(
      times,
      {
        ecmwf_ifs: [0],
        gfs_seamless: [180],
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
    expect(out[0]?.stdDev).toBeGreaterThan(90);
  });
});

describe("aggregateSeries (weather_code)", () => {
  it("picks the severity-weighted modal code", () => {
    const baseTime = new Date("2026-05-20T00:00:00Z");
    const times = makeTimes(1, "2026-05-20T00:00:00Z");
    // 3 models say "rain" (61, 63, 80), 1 says "clear" (0).
    const series = {
      ecmwf_ifs: [61],
      gfs_seamless: [63],
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
    expect([61, 63, 80]).toContain(out[0]?.value);
  });

  it("returns a null code — not 0 (clear) — when no model contributes", () => {
    const baseTime = new Date("2026-05-20T00:00:00Z");
    const times = makeTimes(1, "2026-05-20T00:00:00Z");
    const series = { ecmwf_ifs: [null], gfs_seamless: [null], icon_global: [null], meteofrance_seamless: [null] };
    const out = aggregateSeries(times, series, {
      variable: "weather_code",
      models: subset,
      lat: PARIS.lat,
      lon: PARIS.lon,
      baseTime,
    });
    expect(out[0]?.value).toBeNull();
  });

  it("guards NaN codes so they never vote (would have slugged to 'cloudy')", () => {
    const baseTime = new Date("2026-05-20T00:00:00Z");
    const times = makeTimes(1, "2026-05-20T00:00:00Z");
    // Only a NaN code present → treated as no contributor, so value is null.
    const series = { ecmwf_ifs: [NaN], gfs_seamless: [null], icon_global: [null], meteofrance_seamless: [null] };
    const out = aggregateSeries(times, series, {
      variable: "weather_code",
      models: subset,
      lat: PARIS.lat,
      lon: PARIS.lon,
      baseTime,
    });
    expect(out[0]?.value).toBeNull();
  });
});
