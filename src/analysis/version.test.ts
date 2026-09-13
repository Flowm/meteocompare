import { describe, expect, it } from "vitest";

import { ANALYSIS_VERSION, currentAnalysis } from "./version";

describe("fitted analysis versions", () => {
  it.each([undefined, 2, 3, ANALYSIS_VERSION + 1])("rejects a fit from version %s", (version) => {
    expect(currentAnalysis({ fitted: true }, version)).toBeNull();
  });
  it("retains a fit from the current recipe", () => {
    const fit = { fitted: true };
    expect(currentAnalysis(fit, ANALYSIS_VERSION)).toBe(fit);
  });
});
