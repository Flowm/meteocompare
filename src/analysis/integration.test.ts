// The one real-chain test: synthetic open-meteo responses → real evaluateRun
// per run → real aggregateSample → real fitWeights. Every other analysis test
// fabricates its neighbours' shapes (`as unknown as RunEvaluation`), so none of
// them would notice a shape change in what evaluateRun actually returns; this
// suite deliberately imports NO fabricated shapes — the fixtures are complete,
// honestly-typed response objects — so it fails loudly if any link's contract
// drifts.
//
// Scenario: two distinct-family global models with no home region at the test
// location — ecmwf_ifs forecasts the truth exactly, gfs_seamless runs +5 °C
// warm — over a dry window. Known outcomes: ecmwf must out-rank the aggregate,
// which must out-rank gfs (the aggregate splits the bias), and the trainer must
// down-weight the biased model out-of-sample.

import { describe, expect, it } from "vitest";

import type { ForecastResponse } from "@/api/omForecast";
import type { HistoricalWeatherResponse } from "@/api/omHistoricalWeather";
import { getModel } from "@/domain/models";
import { AGGREGATE_ROW_ID } from "@/domain/scorecard";
import { modelWeight } from "@/domain/weighting";
import { array, makeTimes, PARIS } from "@/test/fixtures";

import { fitWeights, MIN_TRAIN_RUNS, MIN_VAL_RUNS } from "./learnedWeights";
import { evaluateRun, type RunEvaluation } from "./runEvaluation";
import { aggregateSample, type LocationSample } from "./sample";
import { sampleKey } from "./sampleStore";

/** 12 runs: with VAL_FRACTION 0.3 the split is 8 train / 4 val, clearing both
 *  MIN_TRAIN_RUNS and MIN_VAL_RUNS with no slack hiding a guard regression. */
const RUN_COUNT = 12;
/** Two days of hours per run — enough for two daily cards and the 0–2d band. */
const HOURS = 48;

const TRUTH_TEMP = 15;
const GFS_BIAS = 5;

/** ForecastResponse's `hourly`/`current` blocks intersect a typed `time` with a
 *  broad numeric index signature — an intersection no object literal satisfies
 *  directly (TS checks the literal's `time` against the index signature and
 *  refuses). Production only ever *reads* the type (it comes off the wire via a
 *  cast), so build the block in two halves: the `time` half is down-cast to the
 *  block type (a legal member→intersection cast, no `unknown`), while the
 *  columns half stays fully checked against the numeric column type — a column
 *  shape change still breaks this file. */
function hourlyBlock(times: string[], columns: Record<string, (number | null)[]>): ForecastResponse["hourly"] {
  return Object.assign({ time: times } as ForecastResponse["hourly"], columns);
}

/** A complete single-runs response (same shape as the live forecast API): every
 *  field the type requires, hourly columns suffixed per model id exactly as
 *  open-meteo returns them. */
function makeRuns(times: string[]): ForecastResponse {
  return {
    latitude: PARIS.lat,
    longitude: PARIS.lon,
    elevation: 35,
    generationtime_ms: 0.5,
    utc_offset_seconds: 0,
    timezone: "UTC",
    timezone_abbreviation: "UTC",
    hourly: hourlyBlock(times, {
      temperature_2m_ecmwf_ifs: array(times.length, () => TRUTH_TEMP),
      precipitation_ecmwf_ifs: array(times.length, () => 0),
      temperature_2m_gfs_seamless: array(times.length, () => TRUTH_TEMP + GFS_BIAS),
      precipitation_gfs_seamless: array(times.length, () => 0),
    }),
    hourly_units: { temperature_2m: "°C", precipitation: "mm" },
    daily: { time: [] },
    daily_units: {},
    // Same literal-vs-index-signature quirk as `hourly`, same narrow downcast.
    current: { time: times[0]!, interval: 3600 } as ForecastResponse["current"],
    current_units: {},
  };
}

/** A complete archive (truth) response: bare variable names, same time strings
 *  as the run so evaluateRun's ISO-string alignment finds every hour. */
function makeTruth(times: string[]): HistoricalWeatherResponse {
  return {
    latitude: PARIS.lat,
    longitude: PARIS.lon,
    elevation: 35,
    utc_offset_seconds: 0,
    timezone: "UTC",
    timezone_abbreviation: "UTC",
    hourly: {
      time: times,
      temperature_2m: array(times.length, () => TRUTH_TEMP),
      precipitation: array(times.length, () => 0),
    },
    hourly_units: { temperature_2m: "°C", precipitation: "mm" },
  };
}

function evaluateAllRuns(): RunEvaluation[] {
  const evaluations: RunEvaluation[] = [];
  for (let day = 1; day <= RUN_COUNT; day++) {
    const runDate = `2026-06-${String(day).padStart(2, "0")}`;
    // UTC-anchored base so the generated strings don't depend on the runner's TZ.
    const times = makeTimes(HOURS, `${runDate}T00:00:00Z`);
    const ev = evaluateRun({ runs: makeRuns(times), truth: makeTruth(times), lat: PARIS.lat, lon: PARIS.lon, runDate });
    expect(ev).not.toBeNull();
    if (ev) evaluations.push(ev);
  }
  return evaluations;
}

describe("real chain: evaluateRun → aggregateSample → fitWeights", () => {
  const runs = evaluateAllRuns();
  expect(runs).toHaveLength(RUN_COUNT);
  expect(RUN_COUNT).toBeGreaterThanOrEqual(MIN_TRAIN_RUNS + MIN_VAL_RUNS);

  it("evaluateRun wires the synthetic responses end to end", () => {
    const ev = runs[0]!;
    expect(ev.availableModels.map((m) => m.id).toSorted()).toEqual(["ecmwf_ifs", "gfs_seamless"]);
    expect(ev.hourly.truth?.temperature_2m).toHaveLength(HOURS);
    expect(ev.daily).toHaveLength(HOURS / 24);
    // The accurate model verifies with zero bias, the biased one with +5 °C.
    expect(ev.daily[0]!.perModel.ecmwf_ifs!.temperature!.bias).toBeCloseTo(0, 6);
    expect(ev.daily[0]!.perModel.gfs_seamless!.temperature!.bias).toBeCloseTo(GFS_BIAS, 6);
  });

  it("aggregateSample ranks accurate > aggregate > biased across the sample", () => {
    const stats = aggregateSample(runs);
    const order = stats.map((s) => s.id);
    expect(order.indexOf("ecmwf_ifs")).toBeLessThan(order.indexOf(AGGREGATE_ROW_ID));
    expect(order.indexOf(AGGREGATE_ROW_ID)).toBeLessThan(order.indexOf("gfs_seamless"));

    const byId = new Map(stats.map((s) => [s.id, s]));
    // Every model was present and scorable in every run.
    expect(byId.get("ecmwf_ifs")!.n).toBe(RUN_COUNT);
    expect(byId.get("gfs_seamless")!.n).toBe(RUN_COUNT);
    // The aggregate blends the two models by their fitted default weights (ADR
    // 0011): the whole 48 h window is band 0, so a single band-0 weight applies,
    // and the aggregate bias is gfs's weight-share of its +5 °C. ecmwf (accurate)
    // now outweighs gfs (biased), so the aggregate sits well below the old
    // equal-weight midpoint. Derived from the real recipe so a regen can't fool it.
    expect(byId.get("gfs_seamless")!.tempBiasMean).toBeCloseTo(GFS_BIAS, 6);
    expect(byId.get("ecmwf_ifs")!.tempBiasMean).toBeCloseTo(0, 6);
    const wEcmwf = modelWeight(getModel("ecmwf_ifs")!, 0, PARIS.lat, PARIS.lon, "temperature_2m");
    const wGfs = modelWeight(getModel("gfs_seamless")!, 0, PARIS.lat, PARIS.lon, "temperature_2m");
    const expectedAggBias = (wGfs / (wEcmwf + wGfs)) * GFS_BIAS;
    expect(byId.get(AGGREGATE_ROW_ID)!.tempBiasMean).toBeCloseTo(expectedAggBias, 6);
    expect(expectedAggBias).toBeLessThan(GFS_BIAS / 2); // ecmwf out-weighs gfs → below the equal-weight split
  });

  it("fitWeights down-weights the biased model and helps out-of-sample", () => {
    const sample: LocationSample = {
      location: { latitude: PARIS.lat, longitude: PARIS.lon, name: "Paris" },
      runs,
      gatheredAt: "2026-06-13T00:00:00Z",
    };
    const fit = fitWeights(sample);

    expect(fit.ok).toBe(true);
    expect(fit.sourceKey).toBe(sampleKey(PARIS.lat, PARIS.lon));
    expect(fit.nTrain).toBeGreaterThanOrEqual(MIN_TRAIN_RUNS);
    expect(fit.nVal).toBeGreaterThanOrEqual(MIN_VAL_RUNS);
    expect(fit.nTrain + fit.nVal).toBe(RUN_COUNT);

    // Directional, not pinned to the tunables (grid / shrink are documented as
    // adjustable): the biased model must end below the heuristic weight AND
    // below the accurate model, and the fit must beat the heuristic baseline on
    // the held-out runs.
    const gfs = fit.multipliers.gfs_seamless!;
    const ecmwf = fit.multipliers.ecmwf_ifs!;
    expect(gfs).toBeLessThan(1);
    expect(gfs).toBeLessThan(ecmwf);
    expect(fit.improvement).toBeGreaterThan(0);
    expect(fit.valComposite).toBeGreaterThan(fit.valBaselineComposite);
  });
});
