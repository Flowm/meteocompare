import { describe, expect, it } from "vitest";

import { applyCalibration, bandIndexFor, fitCalibrationSet, isCalibrated, MIN_POINTS_PER_BAND, type CalibrationPoint, type CalibrationSet } from "./calibration";
import { LEAD_BANDS } from "./scorecard";

/** n points in one band with hit probability tied to the raw score by `hitFor`.
 *  Raw scores sweep 0..1 deterministically; hits follow a fixed stride pattern
 *  per raw level so rates are exact, no randomness. */
function bandPoints(n: number, hitFor: (raw: number) => number, leadHours = 12): CalibrationPoint[] {
  return Array.from({ length: n }, (_, i) => {
    const raw = i / (n - 1);
    // Deterministic "coin": hit iff the point's position within its cohort of
    // 10 falls under the target rate.
    const hit = i % 10 < Math.round(hitFor(raw) * 10);
    return { variable: "temperature_2m" as const, leadHours, raw, hit };
  });
}

describe("bandIndexFor", () => {
  it("maps lead anchors into LEAD_BANDS slots", () => {
    expect(bandIndexFor(12)).toBe(0);
    expect(bandIndexFor(60)).toBe(1);
    expect(bandIndexFor(120)).toBe(2);
  });

  it("clamps beyond the last band (day 8+ reuses the last curve)", () => {
    expect(bandIndexFor(200)).toBe(LEAD_BANDS.length - 1);
    expect(bandIndexFor(1000)).toBe(LEAD_BANDS.length - 1);
  });
});

describe("fitCalibrationSet — data gate", () => {
  it("returns null bands below MIN_POINTS_PER_BAND (identity fallback, no confident lie)", () => {
    const set = fitCalibrationSet(bandPoints(MIN_POINTS_PER_BAND - 1, () => 0.8));
    expect(set.temperature_2m.bands[0]).toBeNull();
  });

  it("fits a band at exactly the gate", () => {
    const set = fitCalibrationSet(bandPoints(MIN_POINTS_PER_BAND, () => 0.8));
    expect(set.temperature_2m.bands[0]).not.toBeNull();
  });

  it("gates per band and per variable independently", () => {
    const set = fitCalibrationSet(bandPoints(100, () => 0.8, 12)); // band 0 only, temperature only
    expect(set.temperature_2m.bands[0]).not.toBeNull();
    expect(set.temperature_2m.bands[1]).toBeNull();
    expect(set.precipitation.bands[0]).toBeNull();
  });

  it("skips non-finite raw scores instead of counting them", () => {
    const finite = bandPoints(MIN_POINTS_PER_BAND - 1, () => 0.8);
    const set = fitCalibrationSet([...finite, { variable: "temperature_2m", leadHours: 12, raw: NaN, hit: true }]);
    expect(set.temperature_2m.bands[0]).toBeNull();
  });
});

describe("fitCalibrationSet — curve shape", () => {
  it("recovers an increasing raw→hit-rate relationship", () => {
    // Low raw ~30% hits, high raw ~90% hits.
    const set = fitCalibrationSet(bandPoints(200, (raw) => 0.3 + 0.6 * raw));
    const curve = set.temperature_2m.bands[0];
    expect(curve).not.toBeNull();
    const ps = curve!.bins.map((b) => b.p);
    expect(ps[0]!).toBeLessThan(0.55);
    expect(ps[ps.length - 1]!).toBeGreaterThan(0.7);
    // Monotone non-decreasing throughout.
    for (let i = 1; i < ps.length; i++) expect(ps[i]!).toBeGreaterThanOrEqual(ps[i - 1]!);
    expect(curve!.n).toBe(200);
  });

  it("PAVA flattens an inverted relationship into a monotone curve near the base rate", () => {
    // Raw score anti-correlated with hits: the heuristic ranks days backwards.
    // A monotone map cannot fix ordering, only scale — the fit must flatten,
    // not follow the inversion.
    const set = fitCalibrationSet(bandPoints(200, (raw) => 0.9 - 0.6 * raw));
    const curve = set.temperature_2m.bands[0]!;
    const ps = curve.bins.map((b) => b.p);
    for (let i = 1; i < ps.length; i++) expect(ps[i]!).toBeGreaterThanOrEqual(ps[i - 1]!);
    // Pooled to ~the base rate (0.6): no bin strays far.
    for (const p of ps) expect(Math.abs(p - 0.6)).toBeLessThan(0.1);
  });

  it("shrinks thin evidence toward the base rate", () => {
    // 50 points, all hits at high raw, all misses at low raw — with only
    // ~12 points per bin the smoothing keeps bins off the 0/1 extremes.
    const set = fitCalibrationSet(bandPoints(MIN_POINTS_PER_BAND, (raw) => (raw >= 0.5 ? 1 : 0)));
    const curve = set.temperature_2m.bands[0]!;
    const ps = curve.bins.map((b) => b.p);
    expect(ps[0]!).toBeGreaterThan(0);
    expect(ps[ps.length - 1]!).toBeLessThan(1);
  });
});

describe("applyCalibration", () => {
  const set = fitCalibrationSet(bandPoints(200, (raw) => 0.3 + 0.6 * raw));

  it("is the identity when no set, variable curve, or band applies", () => {
    expect(applyCalibration(null, "temperature_2m", 12, 0.6)).toBe(0.6);
    expect(applyCalibration(set, "precipitation", 12, 0.6)).toBe(0.6); // no precip points → null band
    expect(applyCalibration(set, "temperature_2m", 60, 0.6)).toBe(0.6); // band 1 never fitted
  });

  it("passes non-finite raw through untouched", () => {
    expect(applyCalibration(set, "temperature_2m", 12, NaN)).toBeNaN();
  });

  it("interpolates between bins and clamps flat beyond the ends", () => {
    const curve = set.temperature_2m.bands[0]!;
    const first = curve.bins[0]!;
    const last = curve.bins[curve.bins.length - 1]!;
    expect(applyCalibration(set, "temperature_2m", 12, 0)).toBe(first.p);
    expect(applyCalibration(set, "temperature_2m", 12, 1)).toBe(last.p);
    const mid = applyCalibration(set, "temperature_2m", 12, (first.raw + last.raw) / 2);
    expect(mid).toBeGreaterThanOrEqual(first.p);
    expect(mid).toBeLessThanOrEqual(last.p);
  });

  it("monotone in raw across the whole range", () => {
    let prev = -Infinity;
    for (let raw = 0; raw <= 1.001; raw += 0.05) {
      const p = applyCalibration(set, "temperature_2m", 12, raw);
      expect(p).toBeGreaterThanOrEqual(prev);
      prev = p;
    }
  });

  it("handles a degenerate duplicate-center segment without dividing by zero", () => {
    const degenerate: CalibrationSet = {
      temperature_2m: {
        bands: [
          {
            bins: [
              { raw: 0.5, p: 0.4 },
              { raw: 0.5, p: 0.6 },
              { raw: 0.8, p: 0.9 },
            ],
            n: 60,
          },
          null,
          null,
        ],
      },
      precipitation: { bands: [null, null, null] },
    };
    expect(applyCalibration(degenerate, "temperature_2m", 12, 0.5)).toBe(0.4); // raw <= first center
    expect(Number.isFinite(applyCalibration(degenerate, "temperature_2m", 12, 0.500000001))).toBe(true);
  });
});

describe("isCalibrated", () => {
  const set = fitCalibrationSet(bandPoints(200, () => 0.8));

  it("true only where a curve exists", () => {
    expect(isCalibrated(set, "temperature_2m", 12)).toBe(true);
    expect(isCalibrated(set, "temperature_2m", 60)).toBe(false);
    expect(isCalibrated(set, "precipitation", 12)).toBe(false);
    expect(isCalibrated(null, "temperature_2m", 12)).toBe(false);
  });
});
