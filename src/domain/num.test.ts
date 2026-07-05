import { describe, expect, it } from "vitest";

import { clamp01, meanFinite } from "./num";

describe("clamp01", () => {
  it("clamps into the unit interval", () => {
    expect(clamp01(-0.5)).toBe(0);
    expect(clamp01(0)).toBe(0);
    expect(clamp01(0.42)).toBe(0.42);
    expect(clamp01(1)).toBe(1);
    expect(clamp01(3)).toBe(1);
  });
});

describe("meanFinite", () => {
  it("averages the finite values", () => {
    expect(meanFinite([1, 2, 3])).toBeCloseTo(2);
    expect(meanFinite([10])).toBeCloseTo(10);
  });

  it("skips null and undefined without counting them", () => {
    // Divisor is 2 (the finite parts), not 4.
    expect(meanFinite([2, null, 4, undefined])).toBeCloseTo(3);
  });

  it("skips NaN and Infinity (non-finite), counting only real numbers", () => {
    expect(meanFinite([2, NaN, 4])).toBeCloseTo(3);
    expect(meanFinite([2, Infinity, 4])).toBeCloseTo(3);
    expect(meanFinite([2, -Infinity, 4])).toBeCloseTo(3);
  });

  it("returns 0 for an empty array", () => {
    expect(meanFinite([])).toBe(0);
  });

  it("returns 0 when nothing is finite", () => {
    expect(meanFinite([null, undefined, NaN])).toBe(0);
    expect(meanFinite([Infinity, -Infinity])).toBe(0);
  });

  it("keeps a genuine zero in the mean", () => {
    // 0 is finite — it must count, not be treated as missing.
    expect(meanFinite([0, 0, 3])).toBeCloseTo(1);
  });
});
