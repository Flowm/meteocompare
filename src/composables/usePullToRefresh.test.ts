import { describe, it, expect } from "vitest";

import { resolvePull } from "./usePullToRefresh";

const THRESHOLD = 72;
const MAX = 120;

describe("resolvePull — pull-to-refresh resistance curve", () => {
  it("ignores upward / zero travel", () => {
    expect(resolvePull(0, THRESHOLD, MAX)).toBe(0);
    expect(resolvePull(-40, THRESHOLD, MAX)).toBe(0);
  });

  it("tracks the finger 1:1 up to the threshold", () => {
    expect(resolvePull(20, THRESHOLD, MAX)).toBe(20);
    expect(resolvePull(THRESHOLD, THRESHOLD, MAX)).toBe(THRESHOLD);
  });

  it("applies rubber-band resistance past the threshold", () => {
    // 100px of travel is 28px past the threshold; only 40% of that surplus shows.
    expect(resolvePull(100, THRESHOLD, MAX)).toBeCloseTo(THRESHOLD + 28 * 0.4);
  });

  it("never exceeds maxPull no matter how far the finger travels", () => {
    expect(resolvePull(10_000, THRESHOLD, MAX)).toBe(MAX);
  });
});
