import { describe, expect, it } from "vitest";

import { clamp01 } from "@/domain/num";
import { LEAD_BANDS } from "@/domain/scorecard";
import { VERIFIED_VARIABLES } from "@/domain/verification";

import { DEFAULT_CALIBRATION, DEFAULT_CALIBRATION_META } from "./defaultCalibration";

// Guards the GENERATED shipped default (ADR 0010): whatever the fitting script
// produced must be structurally sound, or the ladder's third tier would
// publish garbage. Skipped assertions when the module ships no curves.

describe("defaultCalibration (generated)", () => {
  it("ships curves with metadata, or nothing at all", () => {
    expect((DEFAULT_CALIBRATION === null) === (DEFAULT_CALIBRATION_META === null)).toBe(true);
  });

  it("every fitted band is well-formed: builtin source, monotone bins, probabilities in [0,1]", () => {
    if (!DEFAULT_CALIBRATION) return;
    for (const v of VERIFIED_VARIABLES) {
      const bands = DEFAULT_CALIBRATION[v].bands;
      // The generated default may carry fewer bands than LEAD_BANDS (it was
      // fitted before the ladder grew a band); readers tolerate the short array
      // (ADR 0011), so the guard is an upper bound, not equality.
      expect(bands.length).toBeGreaterThan(0);
      expect(bands.length).toBeLessThanOrEqual(LEAD_BANDS.length);
      for (const curve of bands) {
        if (!curve) continue;
        expect(curve.source).toBe("builtin");
        expect(curve.n).toBeGreaterThanOrEqual(50);
        expect(curve.bins.length).toBeGreaterThanOrEqual(2);
        for (let i = 0; i < curve.bins.length; i++) {
          const bin = curve.bins[i]!;
          expect(clamp01(bin.p)).toBe(bin.p);
          if (i > 0) {
            expect(bin.raw).toBeGreaterThanOrEqual(curve.bins[i - 1]!.raw);
            expect(bin.p).toBeGreaterThanOrEqual(curve.bins[i - 1]!.p);
          }
        }
      }
    }
  });
});
