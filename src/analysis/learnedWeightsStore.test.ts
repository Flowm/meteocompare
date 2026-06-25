import { describe, it, expect, beforeEach } from "vitest";

import { clearWeights, loadWeights, saveWeights } from "./learnedWeightsStore";

describe("learnedWeightsStore", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips weights, keyed by the 0.25° grid cell", () => {
    saveWeights(48.12, 11.38, { multipliers: { ecmwf_ifs: 1.5 }, trainedAt: "2026-06-01T00:00:00Z", improvement: 2.3 });
    expect(loadWeights(48.12, 11.38)?.multipliers.ecmwf_ifs).toBe(1.5);
    // A nearby point resolves to the same stored weights.
    expect(loadWeights(48.0, 11.49)?.multipliers.ecmwf_ifs).toBe(1.5);
  });

  it("returns null when nothing is stored", () => {
    expect(loadWeights(0, 0)).toBeNull();
  });

  it("clears stored weights", () => {
    saveWeights(10, 10, { multipliers: {}, trainedAt: "2026-06-01T00:00:00Z", improvement: 0 });
    clearWeights(10, 10);
    expect(loadWeights(10, 10)).toBeNull();
  });
});
