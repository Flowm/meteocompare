import { beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";

import { refitPooledCalibration } from "@/analysis/calibrationStore";
import { fitWeights, type FitResult } from "@/analysis/learnedWeights";
import { loadWeights, saveWeights } from "@/analysis/learnedWeightsStore";
import type { LocationSample } from "@/analysis/sample";
import { loadSample, sampleKey } from "@/analysis/sampleStore";
import type { Location } from "@/composables/useLocation";

import { useTrainingFlow } from "./useTrainingFlow";

// The flow orchestrates the analysis layer; these tests verify the transitions,
// so the fit and the async sample store are mocked while the (synchronous,
// localStorage-backed) weights store stays real.
vi.mock("@/analysis/sampleStore", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/analysis/sampleStore")>();
  return { ...orig, loadSample: vi.fn(async () => null) };
});
vi.mock("@/analysis/learnedWeights", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/analysis/learnedWeights")>();
  return { ...orig, fitWeights: vi.fn() };
});
vi.mock("@/analysis/calibrationStore", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/analysis/calibrationStore")>();
  return { ...orig, refitPooledCalibration: vi.fn(async () => undefined) };
});

const INNSBRUCK: Location = { name: "Innsbruck", detail: "Tyrol, AT", latitude: 47.2654, longitude: 11.3927 };
// A different 0.25° grid cell.
const MUNICH: Location = { name: "Munich", detail: "Bavaria, DE", latitude: 48.1374, longitude: 11.5755 };

const sampleOf = (n: number): LocationSample =>
  ({ runs: Array.from({ length: n }, (_, i) => ({ runDate: `2026-06-${String(i + 1).padStart(2, "0")}`, daily: [] })) }) as unknown as LocationSample;

const fitFor = (loc: Location, over: Partial<FitResult> = {}): FitResult => ({
  ok: true,
  sourceKey: sampleKey(loc.latitude, loc.longitude),
  multipliers: { ecmwf_ifs: 1.3, gfs_seamless: 1 },
  nTrain: 8,
  nVal: 3,
  valComposite: 70,
  valBaselineComposite: 65,
  improvement: 5,
  ...over,
});

const flush = async (): Promise<void> => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  localStorage.clear();
  vi.mocked(loadSample).mockReset().mockResolvedValue(null);
  vi.mocked(fitWeights).mockReset();
  vi.mocked(refitPooledCalibration).mockClear();
});

describe("useTrainingFlow — sample loading", () => {
  it("loads the current location's stored sample and exposes the run count", async () => {
    vi.mocked(loadSample).mockResolvedValue(sampleOf(12));
    const flow = useTrainingFlow(ref(INNSBRUCK));
    expect(flow.sampleLoading.value).toBe(true);
    await flush();
    expect(flow.sampleLoading.value).toBe(false);
    expect(flow.runCount.value).toBe(12);
    expect(vi.mocked(loadSample)).toHaveBeenCalledWith(sampleKey(INNSBRUCK.latitude, INNSBRUCK.longitude));
  });

  it("ignores a stale load when the location changes mid-flight", async () => {
    const resolvers = new Map<string, (s: LocationSample | null) => void>();
    vi.mocked(loadSample).mockImplementation((key: string) => new Promise((resolve) => resolvers.set(key, resolve)));
    const current = ref(INNSBRUCK);
    const flow = useTrainingFlow(current);
    current.value = MUNICH;
    await flush();
    // The superseded Innsbruck load resolves late — it must not land.
    resolvers.get(sampleKey(INNSBRUCK.latitude, INNSBRUCK.longitude))?.(sampleOf(99));
    await flush();
    expect(flow.runCount.value).toBe(0);
    expect(flow.sampleLoading.value).toBe(true); // still waiting on Munich
    resolvers.get(sampleKey(MUNICH.latitude, MUNICH.longitude))?.(sampleOf(7));
    await flush();
    expect(flow.runCount.value).toBe(7);
    expect(flow.sampleLoading.value).toBe(false);
  });
});

describe("useTrainingFlow — train and apply", () => {
  async function trainedFlow(loc: Location = INNSBRUCK) {
    vi.mocked(loadSample).mockResolvedValue(sampleOf(12));
    vi.mocked(fitWeights).mockReturnValue(fitFor(loc));
    const flow = useTrainingFlow(ref(loc));
    await flush();
    await flow.train();
    return flow;
  }

  it("runs the fit over the loaded sample and exposes the result", async () => {
    const flow = await trainedFlow();
    expect(vi.mocked(fitWeights)).toHaveBeenCalledWith(sampleOf(12));
    expect(flow.result.value?.ok).toBe(true);
    expect(flow.training.value).toBe(false);
  });

  it("persists an ok fit under the current cell and reflects it in stored + overview", async () => {
    const flow = await trainedFlow();
    flow.apply();
    expect(flow.justSaved.value).toBe(true);
    expect(loadWeights(INNSBRUCK.latitude, INNSBRUCK.longitude)?.multipliers.ecmwf_ifs).toBe(1.3);
    expect(flow.stored.value).not.toBeNull();
    expect(flow.overview.value[0]?.isCurrent).toBe(true);
    // Only ecmwf's multiplier differs from the heuristic 1.
    expect(flow.overview.value[0]?.tuned).toBe(1);
  });

  it("stores calibration curves alongside the weights and refits the pooled tier", async () => {
    const flow = await trainedFlow();
    flow.apply();
    const calibration = loadWeights(INNSBRUCK.latitude, INNSBRUCK.longitude)?.calibration;
    // The mock sample has no scored days, so every band is the null (identity)
    // fallback — but the set itself is persisted, ADR 0008's ride-along shape.
    expect(calibration?.temperature_2m.bands).toEqual([null, null, null]);
    expect(calibration?.precipitation.bands).toEqual([null, null, null]);
    expect(vi.mocked(refitPooledCalibration)).toHaveBeenCalledTimes(1);
  });

  it("preserves an existing reach across re-fits", async () => {
    saveWeights(INNSBRUCK.latitude, INNSBRUCK.longitude, { multipliers: {}, trainedAt: "2026-06-01T00:00:00Z", improvement: 0, radiusKm: 50 });
    const flow = await trainedFlow();
    flow.apply();
    expect(loadWeights(INNSBRUCK.latitude, INNSBRUCK.longitude)?.radiusKm).toBe(50);
  });

  it("never persists a fit tagged with another cell's sample key", async () => {
    vi.mocked(loadSample).mockResolvedValue(sampleOf(12));
    vi.mocked(fitWeights).mockReturnValue(fitFor(MUNICH)); // sourceKey ≠ current cell
    const flow = useTrainingFlow(ref(INNSBRUCK));
    await flush();
    await flow.train();
    flow.apply();
    expect(flow.justSaved.value).toBe(false);
    expect(loadWeights(INNSBRUCK.latitude, INNSBRUCK.longitude)).toBeNull();
  });

  it("does not persist a not-ok fit", async () => {
    vi.mocked(loadSample).mockResolvedValue(sampleOf(12));
    vi.mocked(fitWeights).mockReturnValue(fitFor(INNSBRUCK, { ok: false, reason: "not enough runs", multipliers: {} }));
    const flow = useTrainingFlow(ref(INNSBRUCK));
    await flush();
    await flow.train();
    flow.apply();
    expect(loadWeights(INNSBRUCK.latitude, INNSBRUCK.longitude)).toBeNull();
  });
});

describe("useTrainingFlow — inventory", () => {
  it("orders the overview current-location first, then newest", async () => {
    saveWeights(MUNICH.latitude, MUNICH.longitude, {
      multipliers: { ecmwf_ifs: 1.1 },
      trainedAt: "2026-07-01T00:00:00Z",
      improvement: 1,
      location: { name: "Munich", latitude: MUNICH.latitude, longitude: MUNICH.longitude },
    });
    saveWeights(INNSBRUCK.latitude, INNSBRUCK.longitude, {
      multipliers: { ecmwf_ifs: 1.2 },
      trainedAt: "2026-06-01T00:00:00Z",
      improvement: 2,
      location: { name: "Innsbruck", latitude: INNSBRUCK.latitude, longitude: INNSBRUCK.longitude },
    });
    const flow = useTrainingFlow(ref(INNSBRUCK));
    await flush();
    // Innsbruck is current → first despite Munich's newer fit.
    expect(flow.overview.value.map((r) => r.name)).toEqual(["Innsbruck", "Munich"]);
  });

  it("clears an entry and resets justSaved when it was the current cell's", async () => {
    const flow = useTrainingFlow(ref(INNSBRUCK));
    await flush();
    saveWeights(INNSBRUCK.latitude, INNSBRUCK.longitude, { multipliers: {}, trainedAt: "2026-06-01T00:00:00Z", improvement: 0 });
    flow.removeEntry(flow.currentKey.value);
    expect(loadWeights(INNSBRUCK.latitude, INNSBRUCK.longitude)).toBeNull();
    expect(flow.justSaved.value).toBe(false);
    expect(flow.overview.value).toEqual([]);
  });
});
