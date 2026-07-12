import { describe, expect, it } from "vitest";

import { leadFactorForKind, legacyModelWeight } from "./legacyWeighting";
import { getModel } from "./models";

// Pins the superseded pre-ADR-0011 decay shape so a silent edit to the
// verification-page comparator is caught. The recipe is frozen by definition
// (ADR 0011 removed it from production); these are its documented values.

const EQ = { lat: 0, lon: 0 }; // no home region here → regionBonus 0

describe("legacyWeighting — frozen decay shape", () => {
  it("global class holds full weight to 72 h, then eases to a 0.4 floor by 240 h", () => {
    expect(leadFactorForKind("global", 0)).toBeCloseTo(1.0, 10);
    expect(leadFactorForKind("global", 72)).toBeCloseTo(1.0, 10);
    // Midway (156 h) sits between the plateau and the floor.
    expect(leadFactorForKind("global", 156)).toBeCloseTo(1 - ((156 - 72) / 168) * 0.6, 10);
    expect(leadFactorForKind("global", 240)).toBeCloseTo(0.4, 10);
    // Floor holds beyond 240 h.
    expect(leadFactorForKind("global", 400)).toBeCloseTo(0.4, 10);
  });

  it("ai and ensemble-mean classes are 0.75 × the global curve", () => {
    for (const leadH of [0, 72, 156, 240, 400]) {
      const global = leadFactorForKind("global", leadH);
      expect(leadFactorForKind("ai", leadH)).toBeCloseTo(0.75 * global, 10);
      expect(leadFactorForKind("ensemble-mean", leadH)).toBeCloseTo(0.75 * global, 10);
    }
  });

  it("regional classes decay linearly off their own plateaus", () => {
    expect(leadFactorForKind("regional-cam", 24)).toBeCloseTo(1.0, 10);
    expect(leadFactorForKind("regional-cam", 60)).toBeCloseTo(0.0, 10);
    expect(leadFactorForKind("regional-mid", 48)).toBeCloseTo(1.0, 10);
    expect(leadFactorForKind("regional-mid", 120)).toBeCloseTo(0.3, 10);
  });
});

describe("legacyModelWeight — composition + gate", () => {
  const ecmwf = getModel("ecmwf_ifs")!; // global, no home region, maxLead 240
  const aifs = getModel("ecmwf_aifs025_single")!; // ai, no home region, maxLead 360

  it("is the class decay when region bonus and CAM boost are absent", () => {
    // (1 + 0) × leadFactor × 1 → the class curve exactly.
    expect(legacyModelWeight(ecmwf, 24, EQ.lat, EQ.lon, "temperature_2m")).toBeCloseTo(1.0, 10);
    expect(legacyModelWeight(ecmwf, 240, EQ.lat, EQ.lon, "temperature_2m")).toBeCloseTo(0.4, 10);
  });

  it("weights an ai model at 0.75 × the global curve", () => {
    expect(legacyModelWeight(aifs, 72, EQ.lat, EQ.lon, "temperature_2m")).toBeCloseTo(0.75, 10);
    expect(legacyModelWeight(aifs, 240, EQ.lat, EQ.lon, "temperature_2m")).toBeCloseTo(0.75 * 0.4, 10);
  });

  it("gates to 0 past the model's archive cutoff and for negative leads", () => {
    expect(legacyModelWeight(ecmwf, 300, EQ.lat, EQ.lon, "temperature_2m")).toBe(0); // > 240
    expect(legacyModelWeight(ecmwf, -1, EQ.lat, EQ.lon, "temperature_2m")).toBe(0);
  });
});
