import { describe, it, expect } from "vitest";

import { MULT_MAX, MULT_MIN } from "@/analysis/bandWeights";
import { DEFAULT_WEIGHTS } from "@/analysis/defaultWeights";
import { PARIS } from "@/test/fixtures";

import { MODELS, getModel } from "./models";
import { LEAD_BANDS } from "./scorecard";
import { modelWeight, normalizedWeights } from "./weighting";
import { bandIndexFor, resolveMultiplier } from "./weightLadder";

const SAHARA = { lat: 23, lon: 10 };
const SYDNEY = { lat: -33.87, lon: 151.21 };
// A no-home-region point so regionBonus is 0 everywhere below — weight is then
// exactly the builtin tier (temperature carries no CAM boost either).
const EQ = { lat: 0, lon: 0 };

/** The shipped builtin multiplier for a (model, lead), resolved down the ladder. */
const builtinAt = (id: string, kind: Parameters<typeof resolveMultiplier>[1], leadH: number): number =>
  resolveMultiplier(id, kind, bandIndexFor(leadH), undefined, DEFAULT_WEIGHTS ?? undefined);

describe("modelWeight — fitted ladder recipe (ADR 0011)", () => {
  const ecmwf = getModel("ecmwf_ifs")!; // global, no home region, maxLead 240
  const arome = getModel("meteofrance_seamless")!; // regional-cam, Paris box, maxLead 102

  it("applies the shipped builtin multiplier for the lead's band", () => {
    // No region bonus, temperature (no CAM boost) → the weight IS the builtin tier.
    for (const leadH of [12, 60, 100, 200]) {
      expect(modelWeight(ecmwf, leadH, EQ.lat, EQ.lon, "temperature_2m")).toBeCloseTo(builtinAt("ecmwf_ifs", "global", leadH), 10);
    }
  });

  it("steps between bands where the fit differs — no continuous decay", () => {
    // The fitted multiplier is piecewise-constant: flat within a band, a jump at
    // the edge. 12 h and 40 h share band 0; 60 h is band 1.
    const b0a = modelWeight(ecmwf, 12, EQ.lat, EQ.lon, "temperature_2m");
    const b0b = modelWeight(ecmwf, 40, EQ.lat, EQ.lon, "temperature_2m");
    const b1 = modelWeight(ecmwf, 60, EQ.lat, EQ.lon, "temperature_2m");
    expect(b0b).toBeCloseTo(b0a, 10); // flat inside band 0
    // The shipped fit gives ecmwf different band-0 and band-1 multipliers.
    expect(Math.abs(b1 - b0a)).toBeGreaterThan(1e-6); // steps at the 48 h edge
  });

  it("composes region bonus and the CAM precip boost on top of the builtin tier", () => {
    // Inside its Paris box a CAM gets (1 + 0.3) base and ×1.3 on precipitation.
    const builtin = builtinAt("meteofrance_seamless", "regional-cam", 12);
    expect(modelWeight(arome, 12, PARIS.lat, PARIS.lon, "temperature_2m")).toBeCloseTo(1.3 * builtin, 10);
    expect(modelWeight(arome, 12, PARIS.lat, PARIS.lon, "precipitation")).toBeCloseTo(1.3 * 1.3 * builtin, 10);
  });

  it("gates to 0 beyond maxLeadHours and for negative leads (the only zero path)", () => {
    expect(modelWeight(ecmwf, 300, EQ.lat, EQ.lon, "temperature_2m")).toBe(0); // > 240
    expect(modelWeight(ecmwf, -1, EQ.lat, EQ.lon, "temperature_2m")).toBe(0);
    expect(modelWeight(arome, 120, PARIS.lat, PARIS.lon, "temperature_2m")).toBe(0); // > 102
    // Within the horizon the fitted multipliers are all positive, so a model never
    // silently drops mid-window the way the old decay could.
    expect(modelWeight(ecmwf, 239, EQ.lat, EQ.lon, "temperature_2m")).toBeGreaterThan(0);
  });

  it("gives a regional model more weight inside its home region", () => {
    const home = modelWeight(arome, 12, PARIS.lat, PARIS.lon, "temperature_2m");
    const away = modelWeight(arome, 12, SAHARA.lat, SAHARA.lon, "temperature_2m");
    expect(home).toBeGreaterThan(away);
  });
});

describe("normalizedWeights", () => {
  it("always sums to 1 across contributing models", () => {
    const w = normalizedWeights(MODELS, 24, PARIS.lat, PARIS.lon, "temperature_2m");
    const sum = Array.from(w.values()).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 5);
  });

  it("excludes models past their horizon (the only exclusion, now decay is gone)", () => {
    const w = normalizedWeights(MODELS, 200, PARIS.lat, PARIS.lon, "temperature_2m");
    // CAMs (meteofrance 102 h, knmi 60 h) are past their horizons; ECMWF (240 h)
    // and GFS (384 h) still cover 200 h with a positive fitted multiplier.
    expect(w.has("meteofrance_seamless")).toBe(false);
    expect(w.has("knmi_harmonie_arome_europe")).toBe(false);
    expect(w.has("ecmwf_ifs")).toBe(true);
    expect(w.has("gfs_seamless")).toBe(true);
  });

  it("puts more weight on BOM ACCESS-G near Sydney than near Paris", () => {
    const sydneyW = normalizedWeights(MODELS, 24, SYDNEY.lat, SYDNEY.lon, "temperature_2m");
    const parisW = normalizedWeights(MODELS, 24, PARIS.lat, PARIS.lon, "temperature_2m");
    expect(sydneyW.get("bom_access_global")!).toBeGreaterThan(parisW.get("bom_access_global")!);
  });
});

describe("trained multipliers (device pooled tier)", () => {
  const ecmwf = getModel("ecmwf_ifs")!;

  it("scales the ladder weight linearly", () => {
    const base = modelWeight(ecmwf, 24, PARIS.lat, PARIS.lon, "temperature_2m");
    const doubled = modelWeight(ecmwf, 24, PARIS.lat, PARIS.lon, "temperature_2m", { ecmwf_ifs: 2 });
    const halved = modelWeight(ecmwf, 24, PARIS.lat, PARIS.lon, "temperature_2m", { ecmwf_ifs: 0.5 });
    expect(doubled).toBeCloseTo(base * 2, 10);
    expect(halved).toBeCloseTo(base * 0.5, 10);
  });

  it("treats an absent model or a multiplier of 1 as exactly the untrained ladder weight", () => {
    const base = modelWeight(ecmwf, 24, PARIS.lat, PARIS.lon, "temperature_2m");
    expect(modelWeight(ecmwf, 24, PARIS.lat, PARIS.lon, "temperature_2m", {})).toBeCloseTo(base, 10);
    expect(modelWeight(ecmwf, 24, PARIS.lat, PARIS.lon, "temperature_2m", { ecmwf_ifs: 1 })).toBeCloseTo(base, 10);
    // A multiplier for a *different* model leaves this one untouched.
    expect(modelWeight(ecmwf, 24, PARIS.lat, PARIS.lon, "temperature_2m", { gfs_seamless: 3 })).toBeCloseTo(base, 10);
  });

  it("drops a model entirely with a 0 multiplier", () => {
    expect(modelWeight(ecmwf, 24, PARIS.lat, PARIS.lon, "temperature_2m", { ecmwf_ifs: 0 })).toBe(0);
    // …and normalizedWeights then excludes it, so the survivors renormalise to 1.
    const w = normalizedWeights(MODELS, 24, PARIS.lat, PARIS.lon, "temperature_2m", { ecmwf_ifs: 0 });
    expect(w.has("ecmwf_ifs")).toBe(false);
    const sum = Array.from(w.values()).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 10);
  });

  it("shifts a model's normalised share up when its multiplier rises", () => {
    const plain = normalizedWeights(MODELS, 24, PARIS.lat, PARIS.lon, "temperature_2m");
    const boosted = normalizedWeights(MODELS, 24, PARIS.lat, PARIS.lon, "temperature_2m", { ecmwf_ifs: 3 });
    expect(boosted.get("ecmwf_ifs")!).toBeGreaterThan(plain.get("ecmwf_ifs")!);
    // Both still sum to 1 — a raised share is other models ceding, not new mass.
    expect(Array.from(boosted.values()).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
  });
});

describe("DEFAULT_WEIGHTS (shipped fit) sanity", () => {
  it("ships a set whose metadata matches the current band partition", () => {
    if (!DEFAULT_WEIGHTS) return; // tolerate an unshipped fit, like defaultCalibration
    expect(DEFAULT_WEIGHTS.meta.locations.length).toBeGreaterThan(0);
    expect(Number.isNaN(Date.parse(DEFAULT_WEIGHTS.meta.generatedAt))).toBe(false);
    expect(DEFAULT_WEIGHTS.meta.bands.map((b) => [b.start, b.end])).toEqual(LEAD_BANDS.map((b) => [b.start, b.end]));
  });

  it("every fitted multiplier is one slot per band and inside the grid bounds", () => {
    if (!DEFAULT_WEIGHTS) return;
    const slotSets = [...Object.values(DEFAULT_WEIGHTS.perModel), ...Object.values(DEFAULT_WEIGHTS.perClass)];
    expect(slotSets.length).toBeGreaterThan(0);
    for (const slots of slotSets) {
      expect(slots.length).toBe(LEAD_BANDS.length);
      for (const s of slots) {
        if (s == null) continue; // null = ungated, inherits down the ladder
        expect(s).toBeGreaterThanOrEqual(MULT_MIN);
        expect(s).toBeLessThanOrEqual(MULT_MAX);
      }
    }
  });

  it("registers every fitted model id, so a per-model slot never mis-resolves", () => {
    if (!DEFAULT_WEIGHTS) return;
    for (const id of Object.keys(DEFAULT_WEIGHTS.perModel)) expect(getModel(id)).toBeTruthy();
  });
});
