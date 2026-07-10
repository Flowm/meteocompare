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

  it("resolves the ladder per band: local wins, missing bands fall to pooled, else null", () => {
    const curve = (p: number) => ({
      bins: [
        { raw: 0, p },
        { raw: 1, p },
      ],
      n: 60,
    });
    // Nothing stored at all → null (raw-heuristic identity).
    expect(resolveCalibration(48.12, 11.38)).toBeNull();
    // Pooled only → pooled.
    savePooledCalibration({ set: { temperature_2m: { bands: [curve(0.6), curve(0.7), null] }, precipitation: { bands: [null, null, null] } }, fittedAt: "2026-07-01T00:00:00Z" });
    expect(resolveCalibration(48.12, 11.38)?.temperature_2m.bands[0]?.bins[0]?.p).toBe(0.6);
    // A local fit with band 0 only: band 0 from the location, band 1 from pooled, band 2 null.
    saveWeights(48.12, 11.38, {
      multipliers: {},
      trainedAt: "2026-07-02T00:00:00Z",
      improvement: 0,
      calibration: { temperature_2m: { bands: [curve(0.9), null, null] }, precipitation: { bands: [null, null, null] } },
    });
    const merged = resolveCalibration(48.12, 11.38);
    expect(merged?.temperature_2m.bands[0]?.bins[0]?.p).toBe(0.9);
    expect(merged?.temperature_2m.bands[1]?.bins[0]?.p).toBe(0.7);
    expect(merged?.temperature_2m.bands[2]).toBeNull();
  });

  it("leaves the previous pooled fit in place when the sample read fails", async () => {
    savePooledCalibration({ set: { temperature_2m: { bands: [null, null, null] }, precipitation: { bands: [null, null, null] } }, fittedAt: "2026-07-01T00:00:00Z" });
    vi.mocked(listSamples).mockRejectedValue(new Error("idb broken"));
    await refitPooledCalibration("2026-07-03T00:00:00Z");
    expect(loadPooledCalibration()?.fittedAt).toBe("2026-07-01T00:00:00Z");
  });
});
