import { describe, expect, it } from "vitest";

import { LEAD_BANDS } from "@/domain/scorecard";
import type { BuiltinWeightMeta } from "@/domain/weightLadder";

import { buildPanels, fitBandMultipliers, fitBuiltinSet, fitDeviceResiduals, fitPooledMultipliers, MIN_BAND_RUNS, type RunPanel } from "./bandWeights";
import type { RunEvaluation } from "./runEvaluation";

const LAT = 48;
const LON = 11;
const META: BuiltinWeightMeta = { generatedAt: "2026-01-01T00:00:00Z", locations: ["synthetic"], runDates: [], bands: [...LEAD_BANDS] };

/** A synthetic run: per-model temperature series (precip all null, so scoreScope
 *  scores temperature MAE only) against a smooth truth curve. All ids are real
 *  registry models so buildVarPanel keeps them. */
function mkRun(runDate: string, n: number, series: Record<string, (i: number) => number>, truthFn: (i: number) => number): RunEvaluation {
  const base = Date.UTC(2026, 0, 1, 0, 0, 0);
  const times = Array.from({ length: n }, (_, i) => new Date(base + i * 3_600_000).toISOString().slice(0, 16));
  const nulls = (): (number | null)[] => Array.from({ length: n }, () => null);
  const perModelTemp: Record<string, (number | null)[]> = {};
  const perModelPrecip: Record<string, (number | null)[]> = {};
  for (const [id, fn] of Object.entries(series)) {
    perModelTemp[id] = Array.from({ length: n }, (_, i) => fn(i));
    perModelPrecip[id] = nulls();
  }
  return {
    runDate,
    runHour: 0,
    hourly: {
      times,
      aggregate: {},
      perModel: { temperature_2m: perModelTemp, precipitation: perModelPrecip },
      truth: { temperature_2m: Array.from({ length: n }, (_, i) => truthFn(i)), precipitation: nulls() },
      predictability: {},
    },
    daily: [],
    scorecard: [],
    availableModels: [],
  } as unknown as RunEvaluation;
}

const truthCurve = (i: number): number => 10 + Math.sin(i / 5) * 6;

/** Runs where ecmwf_ifs tracks truth and gfs_seamless is a flat +6 °C warm — two
 *  globals with equal heuristic weight, so the only fix is to down-weight gfs. */
function biasedRuns(count: number, n = 48): RunEvaluation[] {
  return Array.from({ length: count }, (_, r) =>
    mkRun(`2026-01-${String(r + 1).padStart(2, "0")}`, n, { ecmwf_ifs: truthCurve, gfs_seamless: (i) => truthCurve(i) + 6 }, truthCurve),
  );
}

const panelsOf = (runs: RunEvaluation[]): RunPanel[] => buildPanels({ runs, lat: LAT, lon: LON });

describe("fitPooledMultipliers", () => {
  it("down-weights an obviously biased model below 1 and below the good one", () => {
    const m = fitPooledMultipliers(panelsOf(biasedRuns(10)));
    expect(m.gfs_seamless).toBeLessThan(1);
    expect(m.gfs_seamless).toBeLessThan(m.ecmwf_ifs ?? 0);
  });

  it("shrink = 0 collapses every multiplier back to the neutral 1", () => {
    const m = fitPooledMultipliers(panelsOf(biasedRuns(10)), { shrink: 0 });
    for (const v of Object.values(m)) expect(v).toBe(1);
  });

  it("tied fit moves all members of a class together", () => {
    const panels = panelsOf(biasedRuns(10));
    const tied = fitPooledMultipliers(panels, { tied: true });
    const free = fitPooledMultipliers(panels);
    // ecmwf_ifs and gfs_seamless are both `global` → one tied coordinate.
    expect(tied.ecmwf_ifs).toBe(tied.gfs_seamless);
    // Untied, the biased one is pulled apart from the good one.
    expect(free.ecmwf_ifs).not.toBe(free.gfs_seamless);
  });
});

/** Runs where gfs_seamless is PERFECT in band 0 (leads < 48) but +10 °C in every
 *  later lead, while ecmwf_ifs carries a mild constant +1.5 °C bias throughout.
 *  So the band-0 fit should favour gfs (better than the biased ecmwf there) and
 *  the band-2 fit should punish it — the multipliers must diverge in lead. */
function leadDependentRuns(count: number, n = 168): RunEvaluation[] {
  return Array.from({ length: count }, (_, r) =>
    mkRun(
      `2026-02-${String(r + 1).padStart(2, "0")}`,
      n,
      { ecmwf_ifs: (i) => truthCurve(i) + 1.5, gfs_seamless: (i) => (i < 48 ? truthCurve(i) : truthCurve(i) + 10) },
      truthCurve,
    ),
  );
}

describe("fitBandMultipliers", () => {
  it("detects a lead-dependent flaw — the band multipliers diverge in the right direction", () => {
    const panels = panelsOf(leadDependentRuns(8));
    const pooled = fitPooledMultipliers(panels);
    const bands = fitBandMultipliers(panels, pooled);
    const gfs = bands.gfs_seamless ?? [];
    // Band 0 (gfs is perfect) keeps it above band 2 (gfs is badly biased).
    expect(gfs[0]).not.toBeNull();
    expect(gfs[2]).not.toBeNull();
    expect(gfs[0]!).toBeGreaterThan(gfs[2]!);
  });

  it("holds a band slot null when its runs are below the data gate", () => {
    // Only 3 runs < MIN_BAND_RUNS (6): every band that HAS data stays null.
    const panels = panelsOf(leadDependentRuns(3));
    const pooled = fitPooledMultipliers(panels);
    const bands = fitBandMultipliers(panels, pooled);
    expect(bands.gfs_seamless?.[0]).toBeNull();
    expect(bands.gfs_seamless?.[2]).toBeNull();
    expect(MIN_BAND_RUNS).toBeGreaterThan(3);
  });

  it("leaves structurally-empty bands null without throwing (band-4 thinness)", () => {
    // n = 168 → no timestep reaches band 3 (168–240 h); it must degrade to null.
    const panels = panelsOf(leadDependentRuns(8));
    const pooled = fitPooledMultipliers(panels);
    const bands = fitBandMultipliers(panels, pooled, { minRuns: 1 });
    expect(bands.gfs_seamless?.[3]).toBeNull();
  });

  it("shrink = 0 pins every gated band to the pooled value (hierarchical shrink math)", () => {
    const panels = panelsOf(leadDependentRuns(8));
    const pooled = fitPooledMultipliers(panels);
    const bands = fitBandMultipliers(panels, pooled, { shrink: 0, minRuns: 1 });
    for (const id of ["ecmwf_ifs", "gfs_seamless"]) {
      for (let b = 0; b < 3; b++) expect(bands[id]?.[b]).toBeCloseTo(pooled[id] ?? 1, 10);
    }
  });
});

describe("fitBuiltinSet", () => {
  it("fits per-model and per-class tiers, gating structurally-empty bands null", () => {
    const set = fitBuiltinSet([panelsOf(leadDependentRuns(8))], { meta: META });
    expect(set.meta).toBe(META);
    // Band 3 has no data at n = 168 → null in every per-model slot.
    expect(set.perModel.gfs_seamless?.[3]).toBeNull();
    expect(set.perModel.gfs_seamless?.[0]).not.toBeNull();
    // Both globals collapse into the single per-class `global` slot array.
    expect(set.perClass.global).toBeDefined();
    expect(set.perClass.global?.length).toBe(LEAD_BANDS.length);
  });
});

describe("fitDeviceResiduals", () => {
  it("fits a residual on top of a builtin set and leaves the builtin untouched", () => {
    const runs = biasedRuns(10);
    const builtin = fitBuiltinSet([panelsOf(runs)], { meta: META });
    const snapshot = structuredClone(builtin);

    // Panels rebuilt WITH builtin baked into the base → the fit sees residuals.
    const device = fitDeviceResiduals(buildPanels({ runs, lat: LAT, lon: LON, builtin }));

    // The device fit changes only the device tier — the builtin it sits on is
    // never mutated.
    expect(builtin).toEqual(snapshot);
    // It returns a valid residual tier for the models in the panels.
    expect(device.pooled.ecmwf_ifs).toBeTypeOf("number");
    expect(device.bands.gfs_seamless?.length).toBe(LEAD_BANDS.length);
    // gfs stays biased even after builtin, so the residual keeps down-weighting it.
    expect(device.pooled.gfs_seamless!).toBeLessThanOrEqual(1);
  });
});
