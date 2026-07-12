import { describe, expect, it } from "vitest";

import { getModel, type ModelKind } from "./models";
import { LEAD_BANDS, type LeadBand } from "./scorecard";
import { bandIndexFor, ladderModelWeight, resolveMultiplier, type BuiltinWeightMeta, type BuiltinWeightSet, type DeviceBandWeights } from "./weightLadder";

const META: BuiltinWeightMeta = { generatedAt: "2026-01-01T00:00:00Z", locations: [], runDates: [], bands: [...LEAD_BANDS] };
const builtinOf = (perModel: BuiltinWeightSet["perModel"], perClass: BuiltinWeightSet["perClass"] = {}): BuiltinWeightSet => ({ perModel, perClass, meta: META });

// meteofrance_seamless is a regional-cam inside PARIS's box; ecmwf_ifs is a
// no-home-region global — so the two exercise regionBonus + camBoost or neither.
const PARIS = { lat: 48.85, lon: 2.35 };

describe("resolveMultiplier — ladder resolution order + per-band independence", () => {
  it("is 1 when no tier is supplied", () => {
    expect(resolveMultiplier("ecmwf_ifs", "global", 0)).toBe(1);
    expect(resolveMultiplier("ecmwf_ifs", "global", 3)).toBe(1);
  });

  it("resolves builtin per-model before per-class, independently per band", () => {
    // Band 0 has a per-model value; band 1 does not and must fall through to the
    // per-class slot for THAT band only, leaving band 0 on the per-model value.
    const builtin = builtinOf({ ecmwf_ifs: [2, null] }, { global: [9, 3] });
    expect(resolveMultiplier("ecmwf_ifs", "global", 0, undefined, builtin)).toBe(2); // per-model wins
    expect(resolveMultiplier("ecmwf_ifs", "global", 1, undefined, builtin)).toBe(3); // fell to per-class
    expect(resolveMultiplier("ecmwf_ifs", "global", 0, undefined, builtin)).toBe(2); // band 0 untouched
  });

  it("falls per-class → 1 when a class band is also unfitted", () => {
    const builtin = builtinOf({}, { global: [5, null] });
    expect(resolveMultiplier("ecmwf_ifs", "global", 0, undefined, builtin)).toBe(5);
    expect(resolveMultiplier("ecmwf_ifs", "global", 1, undefined, builtin)).toBe(1);
  });

  it("resolves device band before device pooled, independently per band", () => {
    const device: DeviceBandWeights = { pooled: { ecmwf_ifs: 0.5 }, bands: { ecmwf_ifs: [5, null] } };
    expect(resolveMultiplier("ecmwf_ifs", "global", 0, device)).toBe(5); // device band
    expect(resolveMultiplier("ecmwf_ifs", "global", 1, device)).toBe(0.5); // device pooled
  });

  it("multiplies the resolved builtin and device tiers (ADR 0011 recipe)", () => {
    // The device residual REFINES the builtin default rather than shadowing it,
    // so the fit's builtin-baked panels reproduce builtinResolved × residual.
    const builtin = builtinOf({ ecmwf_ifs: [2, 2] });
    const device: DeviceBandWeights = { pooled: { ecmwf_ifs: 0.5 }, bands: { ecmwf_ifs: [3, null] } };
    expect(resolveMultiplier("ecmwf_ifs", "global", 0, device, builtin)).toBe(6); // 2 × 3
    expect(resolveMultiplier("ecmwf_ifs", "global", 1, device, builtin)).toBe(1); // 2 × 0.5
  });
});

describe("ladderModelWeight — skeleton-free recipe", () => {
  const ecmwf = getModel("ecmwf_ifs")!;
  const mf = getModel("meteofrance_seamless")!;

  it("with no tiers is base × boost × 1 — the heuristic WITHOUT lead-time decay", () => {
    // Old modelWeight would decay a 200 h global weight below 1; the ladder does
    // not — the (absent) multipliers are the sole lead-time authority.
    expect(ladderModelWeight(ecmwf, 12, 0, 0, "temperature_2m")).toBe(1);
    expect(ladderModelWeight(ecmwf, 200, 0, 0, "temperature_2m")).toBe(1);
  });

  it("keeps regionBonus and variableBoost (out of scope, unchanged)", () => {
    // Inside its home region a CAM gets (1 + 0.3) base and a 1.3 precip boost.
    expect(ladderModelWeight(mf, 12, PARIS.lat, PARIS.lon, "temperature_2m")).toBeCloseTo(1.3, 10);
    expect(ladderModelWeight(mf, 12, PARIS.lat, PARIS.lon, "precipitation")).toBeCloseTo(1.3 * 1.3, 10);
  });

  it("gates to 0 beyond maxLeadHours and for negative leads", () => {
    expect(ladderModelWeight(ecmwf, 300, 0, 0, "temperature_2m")).toBe(0); // > 240
    expect(ladderModelWeight(ecmwf, -1, 0, 0, "temperature_2m")).toBe(0);
    expect(ladderModelWeight(mf, 120, PARIS.lat, PARIS.lon, "temperature_2m")).toBe(0); // > 102
  });

  it("applies the resolved multiplier for the lead's band", () => {
    const builtin = builtinOf({ ecmwf_ifs: [null, null, 0.5, null] });
    // 12 h → band 0 (null → 1); 100 h → band 2 (0.5).
    expect(ladderModelWeight(ecmwf, 12, 0, 0, "temperature_2m", undefined, builtin)).toBe(1);
    expect(ladderModelWeight(ecmwf, 100, 0, 0, "temperature_2m", undefined, builtin)).toBe(0.5);
  });
});

describe("bandIndexFor — arbitrary partitions", () => {
  it("indexes the default LEAD_BANDS with the [start, end) convention", () => {
    expect(bandIndexFor(0)).toBe(0);
    expect(bandIndexFor(47)).toBe(0);
    expect(bandIndexFor(48)).toBe(1); // start-inclusive
    expect(bandIndexFor(167)).toBe(2);
    expect(bandIndexFor(168)).toBe(3);
    expect(bandIndexFor(1000)).toBe(3); // clamp above the last band
  });

  it("resolves a custom per-day partition and clamps above it", () => {
    const perDay: LeadBand[] = Array.from({ length: 4 }, (_, d) => ({ label: `d${d + 1}`, start: d * 24, end: (d + 1) * 24 }));
    expect(bandIndexFor(12, perDay)).toBe(0);
    expect(bandIndexFor(24, perDay)).toBe(1);
    expect(bandIndexFor(47, perDay)).toBe(1);
    expect(bandIndexFor(72, perDay)).toBe(3);
    expect(bandIndexFor(500, perDay)).toBe(3); // clamp
  });

  it("ladderModelWeight honours a custom partition's band index", () => {
    const perDay: LeadBand[] = Array.from({ length: 4 }, (_, d) => ({ label: `d${d + 1}`, start: d * 24, end: (d + 1) * 24 }));
    const kind: ModelKind = "global";
    const builtin = builtinOf({ ecmwf_ifs: [1, 1, 0.25, 1] });
    const ecmwf = getModel("ecmwf_ifs")!;
    // 60 h is day-3 (index 2) under the per-day partition → the 0.25 slot.
    expect(bandIndexFor(60, perDay)).toBe(2);
    expect(resolveMultiplier("ecmwf_ifs", kind, bandIndexFor(60, perDay), undefined, builtin)).toBe(0.25);
    expect(ladderModelWeight(ecmwf, 60, 0, 0, "temperature_2m", undefined, builtin, perDay)).toBe(0.25);
    // Under the default 4-band partition 60 h is band 1 → the 1 slot, no decay.
    expect(ladderModelWeight(ecmwf, 60, 0, 0, "temperature_2m", undefined, builtin)).toBe(1);
  });
});
