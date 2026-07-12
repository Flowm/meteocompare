import { beforeEach, describe, expect, it, vi } from "vitest";

import { MIN_POINTS_PER_BAND } from "@/domain/calibration";
import type { DailyVerification } from "@/domain/verification";

import { clearPooledCalibration, loadPooledCalibration, refitPooledCalibration, resolveCalibration, savePooledCalibration } from "./calibrationStore";
import { saveWeights } from "./learnedWeightsStore";
import type { RunEvaluation } from "./runEvaluation";
import type { LocationSample } from "./sample";
import { listSamples } from "./sampleStore";

vi.mock("./sampleStore", async (importOriginal) => {
  const orig = await importOriginal<typeof import("./sampleStore")>();
  return { ...orig, listSamples: vi.fn(async () => []) };
});
// A stand-in shipped default (ADR 0010) so the ladder's third tier is testable
// regardless of whether the generated module carries real curves.
vi.mock("./defaultCalibration", () => ({
  DEFAULT_CALIBRATION_META: null,
  DEFAULT_CALIBRATION: {
    temperature_2m: {
      bands: [
        null,
        null,
        {
          bins: [
            { raw: 0, p: 0.55 },
            { raw: 1, p: 0.55 },
          ],
          n: 200,
          source: "builtin",
        },
      ],
    },
    precipitation: { bands: [null, null, null] },
  },
}));

/** A scored day in band 0 whose raw score and hit vary with `i`. */
function mkDay(i: number): DailyVerification {
  return {
    runDate: "2026-07-01",
    dayIndex: 0,
    leadHoursStart: 0,
    leadHoursEnd: 24,
    aggregate: {
      temperature: { bias: 0, mae: 0, predictability: (i % 10) / 10, forecastMin: 10, truthMin: 10, forecastMax: i % 10 < 5 ? 25 : 20, truthMax: 20 },
      precipitation: null,
    },
    perModel: {},
  } as DailyVerification;
}

const sampleWith = (n: number): LocationSample => ({ runs: [{ daily: Array.from({ length: n }, (_, i) => mkDay(i)) } as unknown as RunEvaluation] }) as unknown as LocationSample;

beforeEach(() => {
  localStorage.clear();
  vi.mocked(listSamples).mockReset().mockResolvedValue([]);
});

describe("calibrationStore — pooled tier", () => {
  it("round-trips the pooled calibration", () => {
    savePooledCalibration({ set: { temperature_2m: { bands: [null, null, null] }, precipitation: { bands: [null, null, null] } }, fittedAt: "2026-07-01T00:00:00Z" });
    expect(loadPooledCalibration()?.fittedAt).toBe("2026-07-01T00:00:00Z");
    clearPooledCalibration();
    expect(loadPooledCalibration()).toBeNull();
  });

  it("refits the pooled set from every stored sample", async () => {
    vi.mocked(listSamples).mockResolvedValue([sampleWith(MIN_POINTS_PER_BAND), sampleWith(MIN_POINTS_PER_BAND)]);
    await refitPooledCalibration("2026-07-02T00:00:00Z");
    const pooled = loadPooledCalibration();
    expect(pooled?.fittedAt).toBe("2026-07-02T00:00:00Z");
    // 100 temperature outcomes pooled across the two samples → band 0 fitted.
    expect(pooled?.set.temperature_2m.bands[0]?.n).toBe(2 * MIN_POINTS_PER_BAND);
    expect(pooled?.set.precipitation.bands[0]).toBeNull();
  });

  it("resolves the ladder per band: local wins, then pooled, then the builtin default", () => {
    const curve = (p: number) => ({
      bins: [
        { raw: 0, p },
        { raw: 1, p },
      ],
      n: 60,
    });
    // Nothing stored on the device → the shipped default alone (band 2 only in the mock).
    const defaultOnly = resolveCalibration(48.12, 11.38);
    expect(defaultOnly?.temperature_2m.bands[0]).toBeNull();
    expect(defaultOnly?.temperature_2m.bands[2]?.source).toBe("builtin");
    // Pooled tier fills bands 0/1; builtin still supplies band 2.
    savePooledCalibration({ set: { temperature_2m: { bands: [curve(0.6), curve(0.7), null] }, precipitation: { bands: [null, null, null] } }, fittedAt: "2026-07-01T00:00:00Z" });
    const withPooled = resolveCalibration(48.12, 11.38);
    expect(withPooled?.temperature_2m.bands[0]?.bins[0]?.p).toBe(0.6);
    expect(withPooled?.temperature_2m.bands[2]?.source).toBe("builtin");
    // A local fit with band 0 only: band 0 local, band 1 pooled, band 2 builtin.
    saveWeights(48.12, 11.38, {
      multipliers: {},
      trainedAt: "2026-07-02T00:00:00Z",
      improvement: 0,
      calibration: { temperature_2m: { bands: [curve(0.9), null, null] }, precipitation: { bands: [null, null, null] } },
    });
    const merged = resolveCalibration(48.12, 11.38);
    expect(merged?.temperature_2m.bands[0]?.bins[0]?.p).toBe(0.9);
    expect(merged?.temperature_2m.bands[1]?.bins[0]?.p).toBe(0.7);
    expect(merged?.temperature_2m.bands[2]?.bins[0]?.p).toBe(0.55);
    expect(merged?.precipitation.bands[0]).toBeNull();
  });

  it("lets a band the higher tier lacks fall through to the next tier (ADR 0011 length-tolerance)", () => {
    const curve = (p: number) => ({
      bins: [
        { raw: 0, p },
        { raw: 1, p },
      ],
      n: 60,
    });
    // The pooled tier carries a 7–10d (index 3) curve; the local tier is a
    // legacy 3-band set with no slot there, so band 3 must resolve to pooled.
    savePooledCalibration({
      set: { temperature_2m: { bands: [null, null, null, curve(0.8)] }, precipitation: { bands: [null, null, null, null] } },
      fittedAt: "2026-07-01T00:00:00Z",
    });
    saveWeights(48.12, 11.38, {
      multipliers: {},
      trainedAt: "2026-07-02T00:00:00Z",
      improvement: 0,
      calibration: { temperature_2m: { bands: [curve(0.9), null, null] }, precipitation: { bands: [null, null, null] } },
    });
    const merged = resolveCalibration(48.12, 11.38);
    expect(merged?.temperature_2m.bands).toHaveLength(4);
    expect(merged?.temperature_2m.bands[0]?.bins[0]?.p).toBe(0.9); // local
    expect(merged?.temperature_2m.bands[3]?.bins[0]?.p).toBe(0.8); // fell through to pooled
  });

  it("leaves the previous pooled fit in place when the sample read fails", async () => {
    savePooledCalibration({ set: { temperature_2m: { bands: [null, null, null] }, precipitation: { bands: [null, null, null] } }, fittedAt: "2026-07-01T00:00:00Z" });
    vi.mocked(listSamples).mockRejectedValue(new Error("idb broken"));
    await refitPooledCalibration("2026-07-03T00:00:00Z");
    expect(loadPooledCalibration()?.fittedAt).toBe("2026-07-01T00:00:00Z");
  });
});
