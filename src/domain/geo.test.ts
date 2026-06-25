import { describe, it, expect } from "vitest";

import { haversineKm } from "./geo";

describe("haversineKm", () => {
  it("is zero for identical points", () => {
    expect(haversineKm(47.2654, 11.3927, 47.2654, 11.3927)).toBe(0);
  });

  it("matches one degree of latitude (~111 km)", () => {
    expect(haversineKm(0, 0, 1, 0)).toBeCloseTo(111.19, 1);
  });

  it("shrinks a degree of longitude toward the poles", () => {
    // ~74 km at 48°N, not the ~111 km it spans at the equator.
    expect(haversineKm(48, 11, 48, 12)).toBeCloseTo(74.3, 0);
  });

  it("is symmetric", () => {
    expect(haversineKm(47, 11, 48, 12)).toBeCloseTo(haversineKm(48, 12, 47, 11), 6);
  });
});
