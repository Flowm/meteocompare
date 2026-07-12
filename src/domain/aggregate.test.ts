import { describe, it, expect } from "vitest";

import { PARIS, makeTimes, modelSubset } from "@/test/fixtures";

import { aggregateSeries } from "./aggregate";
import type { Variable } from "./variables";
import { modelWeight } from "./weighting";

const subset = modelSubset();

/** Per-model multipliers that cancel the shipped fitted builtin tier (ADR 0011)
 *  so every model in `subset` carries an equal weight at (lat, lon) for `variable`
 *  at lead 0. These aggregation tests exercise the blend *math* (circular mean,
 *  weighted-mode tie-breaks), which the old recipe fed equal weights by accident;
 *  neutralising keeps that condition explicit and independent of the fitted
 *  numbers, so the math is what's under test — the recipe is tested in
 *  weighting.test.ts. */
const flatWeights = (lat: number, lon: number, variable: Variable): Record<string, number> =>
  Object.fromEntries(subset.map((m) => [m.id, 1 / modelWeight(m, 0, lat, lon, variable)]));

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
  // Equal weights isolate the circular-mean math from the fitted default weights.
  const flatWind = flatWeights(PARIS.lat, PARIS.lon, "wind_direction_10m");

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
        multipliers: flatWind,
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
        multipliers: flatWind,
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
        multipliers: flatWind,
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

describe("aggregateSeries (weather_code) — severity-weighted mode tie-break", () => {
  // A mid-Atlantic point (no home-region bonus) plus multipliers that cancel the
  // fitted builtin tier, so every weight is exactly 0.25 and the two-stage
  // selection is exact rather than "somewhere in the group". Without the
  // neutralisation the fitted weights (e.g. ecmwf ≫ the rest) would decide by raw
  // magnitude and hide the tie-break under test.
  const OCEAN = { lat: 0, lon: -30 };
  const baseTime = new Date("2026-05-20T00:00:00Z");
  const times = makeTimes(1, "2026-05-20T00:00:00Z");
  const flat = flatWeights(OCEAN.lat, OCEAN.lon, "weather_code");
  const code = (series: Record<string, number[]>): number | null =>
    aggregateSeries(times, series, { variable: "weather_code", models: subset, lat: OCEAN.lat, lon: OCEAN.lon, baseTime, multipliers: flat })[0]?.value ?? null;

  it("picks the modal severity slug, then the modal code within it", () => {
    // Slugs: rain 0.75 (61, 63, 63) vs snow 0.25 (71) → rain wins. Within rain:
    // code 63 has 0.5, code 61 has 0.25 → 63. Both stages are pinned: the winner
    // is neither the highest-weight *slug*'s first code nor a plain global mode.
    expect(code({ ecmwf_ifs: [61], gfs_seamless: [63], icon_global: [63], meteofrance_seamless: [71] })).toBe(63);
  });

  it("resolves a slug tie to the first-encountered slug, then that slug's modal code", () => {
    // Rain 0.5 (61, 63) ties snow 0.5 (71, 73). The strict `>` keeps the
    // first-seen slug — rain, via ecmwf_ifs=61 leading the subset — so the winner
    // is a rain code, never a snow one, even though snow has equal total weight.
    expect([61, 63]).toContain(code({ ecmwf_ifs: [61], gfs_seamless: [63], icon_global: [71], meteofrance_seamless: [73] }));
  });

  it("resolves a within-slug code tie to the first-encountered code", () => {
    // Rain slug wins outright (0.75). Inside it, 61 and 63 tie at 0.25 each while
    // 80 also has 0.25 — the strict `>` keeps the first code that reached the max
    // in model-iteration order (ecmwf_ifs=61 leads the subset).
    expect(code({ ecmwf_ifs: [61], gfs_seamless: [63], icon_global: [80], meteofrance_seamless: [71] })).toBe(61);
  });
});

describe("aggregateSeries — trained multipliers pass through", () => {
  const baseTime = new Date("2026-05-20T00:00:00Z");
  const times = makeTimes(1, "2026-05-20T00:00:00Z");
  // ecmwf says 10, the other three say 20. The equal-weight mean is 17.5.
  const series = { ecmwf_ifs: [10], gfs_seamless: [20], icon_global: [20], meteofrance_seamless: [20] };
  const tempAt = (multipliers?: Record<string, number>): number =>
    aggregateSeries(times, series, { variable: "temperature_2m", models: subset, lat: PARIS.lat, lon: PARIS.lon, baseTime, multipliers })[0]?.value ?? NaN;

  it("leaves the aggregate unchanged for an all-ones (or empty) multiplier map", () => {
    const plain = tempAt();
    expect(tempAt({})).toBeCloseTo(plain, 10);
    expect(tempAt({ ecmwf_ifs: 1, gfs_seamless: 1 })).toBeCloseTo(plain, 10);
  });

  it("pulls the aggregate toward an up-weighted model", () => {
    const plain = tempAt();
    // Heavily up-weighting the cool ecmwf drags the mean below the plain value.
    const boosted = tempAt({ ecmwf_ifs: 5 });
    expect(boosted).toBeLessThan(plain);
    expect(boosted).toBeGreaterThan(10); // but never past the model's own value
  });

  it("removes an up-weighted-to-zero model from the blend", () => {
    // Drop ecmwf entirely → the mean is the other three, all 20.
    expect(tempAt({ ecmwf_ifs: 0 })).toBeCloseTo(20, 10);
  });
});
