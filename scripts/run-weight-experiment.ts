// ADR 0011, work package 3 — the pre-registered fitted-weight-ladder experiment.
//
// Gathers verification runs at the 12 ADR-0010 reference locations, fits the
// ladder's builtin and device tiers with analysis/bandWeights, and evaluates the
// pre-registered arms against the incumbent so the ADR's adoption gate could be
// decided on real numbers. Nothing here mutates src/ or the shipping app; it
// writes a results document + raw JSON.
//
// Run with:  pnpm dlx tsx scripts/run-weight-experiment.ts [--smoke] [--cache-dir <path>]
//   --smoke     : 2 locations x 6 runs, to validate the pipeline end-to-end first.
//   --cache-dir : reuse (and top up) a directory of cached RunEvaluation JSON
//                 instead of re-fetching; defaults to the shared cache the weight
//                 scripts fill (see scripts/lib/collectRuns). fit-default-weights
//                 samples the same 24 × 00Z dates, so the two share a cache verbatim.
// (Node's global fetch; the api layer's localStorage guard makes it free-tier.)
//
// Faithfulness note ("evaluate == train"): the FIT uses the exported WP2 entry
// points (buildPanels / fitBuiltinSet / fitDeviceResiduals) verbatim. EVALUATION
// re-derives each arm's composite with the SAME aggregation the fit scores with
// (a weighted mean per timestep, then scoreScope) — bandWeights' aggUnder /
// runComposite / meanComposite are module-private, so they are copied here (the
// module header blesses this duplication), and every weight is assembled from the
// real recipe functions (modelWeight / ladderModelWeight / bandIndexFor), never
// re-implemented. assertLadderParity() guards the one small duplication.

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildPanels, fitBuiltinSet, fitDeviceResiduals, type RunPanel } from "@/analysis/bandWeights";
import type { RunRef } from "@/analysis/collectSample";
import { MIN_TRAIN_RUNS, MIN_VAL_RUNS, VAL_FRACTION } from "@/analysis/learnedWeights";
import type { RunEvaluation } from "@/analysis/runEvaluation";
import { getModel, type ModelDef } from "@/domain/models";
import { LEAD_BANDS, scoreScope, type LeadBand } from "@/domain/scorecard";
import type { Variable } from "@/domain/weighting";
import { modelWeight } from "@/domain/weighting";
import { bandIndexFor, ladderModelWeight, type BuiltinWeightSet, type DeviceBandWeights } from "@/domain/weightLadder";

import { ARCHIVE_START, cacheDirFromArgv, gatherCached, runDates } from "./lib/collectRuns";
import { REFERENCE_LOCATIONS, type RefLocation } from "./lib/referenceLocations";

const RUNS_PER_LOCATION = 24;
/** Newest usable run: today − (10 forecast days + ~5-day ERA5 lag + 1 margin) so
 *  band 3 (168–240 h) has truth. */
const TRUTH_LAG_DAYS = 16;

/** Per-day partition for the ablation arms (10 daily bands, 0–24 … 216–240). */
const DAILY_BANDS: readonly LeadBand[] = Array.from({ length: 10 }, (_, d) => ({
  label: `d${d + 1}`,
  start: d * 24,
  end: (d + 1) * 24,
}));

const SMOKE = process.argv.includes("--smoke");
const SMOKE_LOCATIONS = 2;
const SMOKE_RUNS = 6;

const CACHE_DIR = cacheDirFromArgv();
const RESULTS_JSON = join(dirname(CACHE_DIR), "weight-experiment-results.json");
const REPORT_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "docs", "research", "weight-ladder-experiment.md");

const DECISION_RULE = [
  "Pre-registered decision rule (ADR 0011, verbatim):",
  "  - Adopt the new default (arm 1) iff arm 1 beats arm 0 at the median",
  "    per-location composite AND in >= 8 of 12 locations.",
  "  - Ship the device tier (arm 2) iff arm 2 additionally beats arm 1",
  "    (on val runs) at the median AND in >= 8 of 12 locations.",
  "  - Ablations (A per-day builtin, B per-day device, C class-only builtin)",
  "    are informational only.",
].join("\n");

const median = (xs: readonly number[]): number => {
  const s = xs.filter((x) => Number.isFinite(x)).toSorted((a, b) => a - b);
  if (s.length === 0) return NaN;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
};

const secs = (t0: number): string => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
const f2 = (x: number): string => (Number.isFinite(x) ? x.toFixed(2) : "—");
const signed = (x: number): string => (Number.isFinite(x) ? `${x >= 0 ? "+" : ""}${x.toFixed(2)}` : "—");

// Evaluation panels + composite (aggUnder / runComposite / meanComposite copied
// from bandWeights on purpose — see the header note; identical arithmetic keeps
// evaluate == train). Weights are baked in fully at build time via `weightAt`.

type WeightAt = (model: ModelDef, leadHours: number, variable: Variable) => number;

interface EvalVarPanel {
  ids: string[];
  w: number[][];
  v: (number | null)[][];
  truth: (number | null)[];
}
interface EvalPanel {
  temp: EvalVarPanel;
  precip: EvalVarPanel;
}

function buildEvalVarPanel(run: RunEvaluation, variable: "temperature_2m" | "precipitation", weightAt: WeightAt): EvalVarPanel {
  const { times } = run.hourly;
  const perModel = run.hourly.perModel[variable] ?? {};
  const truth = run.hourly.truth?.[variable] ?? [];
  const ids = Object.keys(perModel).filter((id) => getModel(id));
  const base = times[0] ? new Date(times[0]).getTime() : 0;
  const w: number[][] = [];
  const v: (number | null)[][] = [];
  for (let i = 0; i < times.length; i++) {
    const t = times[i];
    const leadH = t ? Math.max(0, (new Date(t).getTime() - base) / 3_600_000) : 0;
    const wRow: number[] = [];
    const vRow: (number | null)[] = [];
    for (const id of ids) {
      const model = getModel(id);
      wRow.push(model ? weightAt(model, leadH, variable) : 0);
      vRow.push(perModel[id]?.[i] ?? null);
    }
    w.push(wRow);
    v.push(vRow);
  }
  return { ids, w, v, truth: truth.slice(0, times.length) };
}

const buildEvalPanel = (run: RunEvaluation, weightAt: WeightAt): EvalPanel => ({
  temp: buildEvalVarPanel(run, "temperature_2m", weightAt),
  precip: buildEvalVarPanel(run, "precipitation", weightAt),
});

/** Weighted-mean aggregate over timesteps `[lo, hi)` (weights already baked). */
function aggUnder(panel: EvalVarPanel, lo: number, hi: number): (number | null)[] {
  const out: (number | null)[] = [];
  for (let i = lo; i < hi; i++) {
    const wRow = panel.w[i] ?? [];
    const vRow = panel.v[i] ?? [];
    let num = 0;
    let den = 0;
    for (let k = 0; k < panel.ids.length; k++) {
      const val = vRow[k];
      if (val == null) continue;
      const ww = wRow[k] ?? 0;
      if (ww <= 0) continue;
      num += ww * val;
      den += ww;
    }
    out.push(den > 0 ? num / den : null);
  }
  return out;
}

/** scoreScope composite over a timestep range (full window when omitted). */
function runComposite(panel: EvalPanel, range?: { lo: number; hi: number }): number {
  const tr = range ?? { lo: 0, hi: panel.temp.w.length };
  const pr = range ?? { lo: 0, hi: panel.precip.w.length };
  const fTemp = aggUnder(panel.temp, tr.lo, tr.hi);
  const fPrecip = aggUnder(panel.precip, pr.lo, pr.hi);
  return scoreScope(fTemp, panel.temp.truth.slice(tr.lo, tr.hi), fPrecip, panel.precip.truth.slice(pr.lo, pr.hi)).composite;
}

/** Mean full-window composite across runs (skipping runs with no scorable data). */
function meanComposite(runs: readonly RunEvaluation[], weightAt: WeightAt): number {
  let sum = 0;
  let n = 0;
  for (const run of runs) {
    const c = runComposite(buildEvalPanel(run, weightAt));
    if (Number.isFinite(c)) {
      sum += c;
      n += 1;
    }
  }
  return n ? sum / n : NaN;
}

// Weight recipes (assembled from the real functions — never re-implemented)

/** The ladder weight, allowing the device tier a DIFFERENT band partition from
 *  the builtin tier (ablation B). For a shared partition this equals
 *  `ladderModelWeight(…, device, builtin, bands)` exactly — see assertLadderParity.
 *  The builtin+base factor comes straight from ladderModelWeight; only the device
 *  factor is resolved here, duplicating resolveMultiplier's device half (one line)
 *  so the two tiers can key off separate partitions. */
function ladderWeightAt(
  lat: number,
  lon: number,
  builtin: BuiltinWeightSet | undefined,
  builtinBands: readonly LeadBand[],
  device?: DeviceBandWeights,
  deviceBands: readonly LeadBand[] = LEAD_BANDS,
): WeightAt {
  return (model, leadH, variable) => {
    const wb = ladderModelWeight(model, leadH, lat, lon, variable, undefined, builtin, builtinBands);
    if (wb === 0 || !device) return wb;
    const bi = bandIndexFor(leadH, deviceBands);
    const dev = device.bands[model.id]?.[bi] ?? device.pooled[model.id] ?? 1;
    return wb * dev;
  };
}

const incumbentWeightAt =
  (lat: number, lon: number): WeightAt =>
  (model, leadH, variable) =>
    modelWeight(model, leadH, lat, lon, variable);

/** Guard the one duplicated line: on the shared LEAD_BANDS partition, ladderWeightAt
 *  with a device tier must reproduce ladderModelWeight(…, device, builtin). */
function assertLadderParity(): void {
  const model = getModel("ecmwf_ifs");
  if (!model) throw new Error("registry missing ecmwf_ifs");
  const builtin: BuiltinWeightSet = {
    perModel: { ecmwf_ifs: [1.2, 0.9, null, 1.1] },
    perClass: { global: [1.05, 1.0, 0.8, null] },
    meta: { generatedAt: "", locations: [], runDates: [], bands: [...LEAD_BANDS] },
  };
  const device: DeviceBandWeights = { pooled: { ecmwf_ifs: 1.1 }, bands: { ecmwf_ifs: [0.9, null, 1.2, null] } };
  const at = ladderWeightAt(48, 11, builtin, LEAD_BANDS, device, LEAD_BANDS);
  for (const leadH of [0, 24, 47, 48, 96, 167, 168, 200, 239]) {
    for (const v of ["temperature_2m", "precipitation"] as const) {
      const a = at(model, leadH, v);
      const b = ladderModelWeight(model, leadH, 48, 11, v, device, builtin, LEAD_BANDS);
      if (Math.abs(a - b) > 1e-12) throw new Error(`ladder parity broke at lead ${leadH} ${v}: ${a} vs ${b}`);
    }
  }
}

interface Coverage {
  runs: number;
  /** Median across runs of the max lead hour present on the time axis (240 = full 10 days). */
  medianMaxLead: number;
  /** Runs whose band-4 (168–240 h) slice yields a finite composite under arm 0. */
  band4ScorableRuns: number;
  /** Mean # of models reaching band 4 (>=1 non-null value at lead >=168) per run. */
  meanBand4Models: number;
}

function coverageOf(loc: RefLocation, runs: readonly RunEvaluation[]): Coverage {
  const at = incumbentWeightAt(loc.latitude, loc.longitude);
  const maxLeads: number[] = [];
  const band4ModelCounts: number[] = [];
  let band4Scorable = 0;
  for (const run of runs) {
    const { times } = run.hourly;
    const base = times[0] ? new Date(times[0]).getTime() : 0;
    let maxLead = 0;
    for (const t of times) if (t) maxLead = Math.max(maxLead, (new Date(t).getTime() - base) / 3_600_000);
    maxLeads.push(maxLead);

    // Band-4 model reach (any verified variable with a non-null value at lead >=168).
    const reaching = new Set<string>();
    for (const variable of ["temperature_2m", "precipitation"] as const) {
      const pm = run.hourly.perModel[variable] ?? {};
      for (const [id, arr] of Object.entries(pm)) {
        if (!getModel(id)) continue;
        for (let i = 0; i < times.length; i++) {
          const t = times[i];
          if (!t) continue;
          const leadH = (new Date(t).getTime() - base) / 3_600_000;
          if (leadH >= 168 && leadH < 240 && arr[i] != null) {
            reaching.add(id);
            break;
          }
        }
      }
    }
    band4ModelCounts.push(reaching.size);

    // Band-4 scorability under the incumbent aggregate.
    const panel = buildEvalPanel(run, at);
    const lo = panel.temp.w.findIndex((_, i) => leadOf(times, base, i) >= 168);
    if (lo >= 0) {
      const hi = panel.temp.w.length;
      if (Number.isFinite(runComposite(panel, { lo, hi }))) band4Scorable += 1;
    }
  }
  return {
    runs: runs.length,
    medianMaxLead: median(maxLeads),
    band4ScorableRuns: band4Scorable,
    meanBand4Models: band4ModelCounts.length ? band4ModelCounts.reduce((s, x) => s + x, 0) / band4ModelCounts.length : 0,
  };
}

function leadOf(times: readonly string[], base: number, i: number): number {
  const t = times[i];
  return t ? (new Date(t).getTime() - base) / 3_600_000 : 0;
}

interface LocResult {
  name: string;
  runs: number;
  coverage: Coverage;
  arm0: number;
  arm1: number;
  ablationA: number;
  ablationC: number;
  builtinFitSecs: number;
  // Device arm (may be skipped when a location lacks the train/val minimum).
  device?: {
    nTrain: number;
    nVal: number;
    builtinOnlyVal: number;
    arm2Val: number; // builtin + device (LEAD_BANDS)
    ablationBVal: number; // builtin + device (DAILY_BANDS device)
    deviceFitSecs: number;
  };
  deviceSkipReason?: string;
}

async function main(): Promise<void> {
  assertLadderParity();

  const locations: readonly RefLocation[] = SMOKE ? REFERENCE_LOCATIONS.slice(0, SMOKE_LOCATIONS) : REFERENCE_LOCATIONS;
  const nRuns = SMOKE ? SMOKE_RUNS : RUNS_PER_LOCATION;
  const dates = runDates(nRuns, TRUTH_LAG_DAYS);
  const refs: RunRef[] = dates.map((runDate) => ({ runDate, runHour: 0 }));

  console.log(`\n=== ADR 0011 weight-ladder experiment ${SMOKE ? "(SMOKE)" : ""} ===`);
  console.log(DECISION_RULE);
  console.log(`\nLocations: ${locations.length}   Runs/location: ${nRuns} (00Z)`);
  console.log(`Run dates: ${dates[0]} … ${dates[dates.length - 1]} (${dates.length} dates)`);
  console.log(`Cache dir: ${CACHE_DIR}\n`);

  const runsByLoc = new Map<string, RunEvaluation[]>();
  const gatherStart = Date.now();
  for (const loc of locations) {
    const t0 = Date.now();
    // eslint-disable-next-line no-await-in-loop -- sequential per location on purpose: polite to open-meteo's free tier.
    const runs = (await gatherCached(loc, refs, { cacheDir: CACHE_DIR })).toSorted((a, b) => a.runDate.localeCompare(b.runDate)); // oldest first (deterministic; drives the temporal split)
    runsByLoc.set(loc.name, runs);
    const cov = coverageOf(loc, runs);
    console.log(
      `${loc.name.padEnd(12)} ${String(runs.length).padStart(2)}/${refs.length} runs in ${secs(t0)}` +
        `  | maxLead≈${cov.medianMaxLead.toFixed(0)}h  band4: ${cov.band4ScorableRuns}/${runs.length} scorable, ~${cov.meanBand4Models.toFixed(1)} models`,
    );
  }
  console.log(`\nGather complete in ${secs(gatherStart)}.\n`);

  // Per-location raw panels (no builtin baked → partition-independent)
  const rawPanels = new Map<string, RunPanel[]>();
  for (const loc of locations) {
    const runs = runsByLoc.get(loc.name) ?? [];
    rawPanels.set(loc.name, buildPanels({ runs, lat: loc.latitude, lon: loc.longitude }));
  }

  // Fit + evaluate every arm, leave-one-location-out
  const results: LocResult[] = [];
  for (const loc of locations) {
    const runs = runsByLoc.get(loc.name) ?? [];
    if (runs.length === 0) {
      console.log(`${loc.name}: no runs gathered — skipped.`);
      continue;
    }
    const others = locations.filter((l) => l.name !== loc.name).map((l) => rawPanels.get(l.name) ?? []);
    const otherNames = locations.filter((l) => l.name !== loc.name).map((l) => l.name);
    const metaBase = { generatedAt: new Date().toISOString(), locations: otherNames, runDates: dates };

    // Arm 1 + ablations A/C builtin fits (LOLO on the other 11 locations' raw panels).
    const t0 = Date.now();
    const builtin = fitBuiltinSet(others, { bands: LEAD_BANDS, meta: { ...metaBase, bands: [...LEAD_BANDS] } });
    const builtinDaily = fitBuiltinSet(others, { bands: DAILY_BANDS, meta: { ...metaBase, bands: [...DAILY_BANDS] } });
    const builtinFitSecs = (Date.now() - t0) / 1000;

    const at0 = incumbentWeightAt(loc.latitude, loc.longitude);
    const at1 = ladderWeightAt(loc.latitude, loc.longitude, builtin, LEAD_BANDS);
    const atA = ladderWeightAt(loc.latitude, loc.longitude, builtinDaily, DAILY_BANDS);
    const atC = ladderWeightAt(loc.latitude, loc.longitude, { ...builtin, perModel: {} }, LEAD_BANDS);

    const arm0 = meanComposite(runs, at0);
    const arm1 = meanComposite(runs, at1);
    const ablationA = meanComposite(runs, atA);
    const ablationC = meanComposite(runs, atC);

    const rec: LocResult = {
      name: loc.name,
      runs: runs.length,
      coverage: coverageOf(loc, runs),
      arm0,
      arm1,
      ablationA,
      ablationC,
      builtinFitSecs,
    };

    // Arm 2 + ablation B — device tier on a within-location temporal split.
    const nVal = Math.max(MIN_VAL_RUNS, Math.round(runs.length * VAL_FRACTION));
    const trainRuns = runs.slice(0, runs.length - nVal);
    const valRuns = runs.slice(runs.length - nVal);
    if (trainRuns.length < MIN_TRAIN_RUNS || valRuns.length < MIN_VAL_RUNS) {
      rec.deviceSkipReason = `need >=${MIN_TRAIN_RUNS} train & >=${MIN_VAL_RUNS} val; have ${trainRuns.length}/${valRuns.length}`;
    } else {
      const td = Date.now();
      const trainPanels = buildPanels({ runs: trainRuns, lat: loc.latitude, lon: loc.longitude, builtin, bands: LEAD_BANDS });
      const device = fitDeviceResiduals(trainPanels, { bands: LEAD_BANDS });
      const deviceDaily = fitDeviceResiduals(trainPanels, { bands: DAILY_BANDS });
      const deviceFitSecs = (Date.now() - td) / 1000;

      const builtinOnlyVal = meanComposite(valRuns, ladderWeightAt(loc.latitude, loc.longitude, builtin, LEAD_BANDS));
      const arm2Val = meanComposite(valRuns, ladderWeightAt(loc.latitude, loc.longitude, builtin, LEAD_BANDS, device, LEAD_BANDS));
      const ablationBVal = meanComposite(valRuns, ladderWeightAt(loc.latitude, loc.longitude, builtin, LEAD_BANDS, deviceDaily, DAILY_BANDS));
      rec.device = { nTrain: trainRuns.length, nVal: valRuns.length, builtinOnlyVal, arm2Val, ablationBVal, deviceFitSecs };
    }

    results.push(rec);
    const d = rec.device;
    console.log(
      `${loc.name.padEnd(12)} arm0=${f2(arm0)} arm1=${f2(arm1)} (${signed(arm1 - arm0)})` +
        (d ? `  dev: bo=${f2(d.builtinOnlyVal)} +dev=${f2(d.arm2Val)} (${signed(d.arm2Val - d.builtinOnlyVal)})` : `  dev: skipped`) +
        `  | builtin ${builtinFitSecs.toFixed(1)}s${d ? ` device ${d.deviceFitSecs.toFixed(1)}s` : ""}`,
    );
  }

  const decision = decide(results);
  console.log(`\n${"=".repeat(60)}`);
  console.log(DECISION_RULE);
  console.log(`\nARM 1 (new default) vs ARM 0 (incumbent):`);
  console.log(`  median arm0 = ${f2(decision.medArm0)}   median arm1 = ${f2(decision.medArm1)}   median Δ = ${signed(decision.medDelta1)}`);
  console.log(`  wins: ${decision.wins1}/${results.length}   → adopt new default: ${decision.adopt ? "YES" : "NO"}`);
  console.log(`\nARM 2 (device) vs builtin-only, on val runs:`);
  console.log(`  median builtin-only = ${f2(decision.medBuiltinOnly)}   median +device = ${f2(decision.medArm2)}   median Δ = ${signed(decision.medDelta2)}`);
  console.log(`  wins: ${decision.wins2}/${decision.deviceLocs}   → ship device tier: ${decision.ship ? "YES" : "NO"}`);

  const payload = {
    generatedAt: new Date().toISOString(),
    smoke: SMOKE,
    protocol: { locations: locations.map((l) => l.name), runsPerLocation: nRuns, runDates: dates, archiveStart: ARCHIVE_START, truthLagDays: TRUTH_LAG_DAYS },
    decision,
    perLocation: results,
  };
  writeFileSync(RESULTS_JSON, JSON.stringify(payload, null, 2));
  writeFileSync(REPORT_PATH, renderReport(payload));
  console.log(`\nWrote ${RESULTS_JSON}`);
  console.log(`Wrote ${REPORT_PATH}\n`);
}

interface Decision {
  medArm0: number;
  medArm1: number;
  medDelta1: number;
  wins1: number;
  adopt: boolean;
  deviceLocs: number;
  medBuiltinOnly: number;
  medArm2: number;
  medDelta2: number;
  wins2: number;
  ship: boolean;
}

function decide(results: readonly LocResult[]): Decision {
  const arm0 = results.map((r) => r.arm0);
  const arm1 = results.map((r) => r.arm1);
  const medArm0 = median(arm0);
  const medArm1 = median(arm1);
  const wins1 = results.filter((r) => r.arm1 > r.arm0).length;
  const adopt = medArm1 > medArm0 && wins1 >= 8;

  const dev = results.filter((r): r is LocResult & { device: NonNullable<LocResult["device"]> } => r.device != null);
  const bo = dev.map((r) => r.device.builtinOnlyVal);
  const a2 = dev.map((r) => r.device.arm2Val);
  const medBuiltinOnly = median(bo);
  const medArm2 = median(a2);
  const wins2 = dev.filter((r) => r.device.arm2Val > r.device.builtinOnlyVal).length;
  const ship = adopt && medArm2 > medBuiltinOnly && wins2 >= 8;

  return {
    medArm0,
    medArm1,
    medDelta1: median(results.map((r) => r.arm1 - r.arm0)),
    wins1,
    adopt,
    deviceLocs: dev.length,
    medBuiltinOnly,
    medArm2,
    medDelta2: median(dev.map((r) => r.device.arm2Val - r.device.builtinOnlyVal)),
    wins2,
    ship,
  };
}

type Payload = {
  generatedAt: string;
  smoke: boolean;
  protocol: { locations: string[]; runsPerLocation: number; runDates: string[]; archiveStart: string; truthLagDays: number };
  decision: Decision;
  perLocation: LocResult[];
};

function renderReport(p: Payload): string {
  const yn = (b: boolean): string => (b ? "**YES**" : "**NO**");
  const L = p.perLocation;

  const gatherTable = [
    "| Location | Runs | Median max lead | Band-4 scorable runs | ~Band-4 models |",
    "| --- | ---: | ---: | ---: | ---: |",
    ...L.map((r) => `| ${r.name} | ${r.runs} | ${r.coverage.medianMaxLead.toFixed(0)} h | ${r.coverage.band4ScorableRuns}/${r.runs} | ${r.coverage.meanBand4Models.toFixed(1)} |`),
  ].join("\n");

  const arm1Table = [
    "| Location | Arm 0 (incumbent) | Arm 1 (new default) | Δ (arm1−arm0) | Arm 1 wins? |",
    "| --- | ---: | ---: | ---: | :---: |",
    ...L.map((r) => `| ${r.name} | ${f2(r.arm0)} | ${f2(r.arm1)} | ${signed(r.arm1 - r.arm0)} | ${r.arm1 > r.arm0 ? "✓" : "·"} |`),
  ].join("\n");

  const devRows = L.filter((r) => r.device);
  const arm2Table = devRows.length
    ? [
        "| Location | nTrain/nVal | Builtin-only (val) | Arm 2 +device (val) | Δ | Device wins? |",
        "| --- | ---: | ---: | ---: | ---: | :---: |",
        ...devRows.map((r) => {
          const d = r.device as NonNullable<LocResult["device"]>;
          return `| ${r.name} | ${d.nTrain}/${d.nVal} | ${f2(d.builtinOnlyVal)} | ${f2(d.arm2Val)} | ${signed(d.arm2Val - d.builtinOnlyVal)} | ${d.arm2Val > d.builtinOnlyVal ? "✓" : "·"} |`;
        }),
      ].join("\n")
    : "_No location met the train/val minimum for the device tier._";

  const skipped = L.filter((r) => r.deviceSkipReason);
  const skipNote = skipped.length ? `\n\nDevice tier skipped at: ${skipped.map((r) => `${r.name} (${r.deviceSkipReason})`).join("; ")}.` : "";

  const ablA = [
    "| Location | Arm 1 (4-band builtin) | Ablation A (per-day builtin) | Δ (A−arm1) |",
    "| --- | ---: | ---: | ---: |",
    ...L.map((r) => `| ${r.name} | ${f2(r.arm1)} | ${f2(r.ablationA)} | ${signed(r.ablationA - r.arm1)} |`),
  ].join("\n");

  const ablC = [
    "| Location | Arm 1 (per-model builtin) | Ablation C (class-only builtin) | Δ (C−arm1) |",
    "| --- | ---: | ---: | ---: |",
    ...L.map((r) => `| ${r.name} | ${f2(r.arm1)} | ${f2(r.ablationC)} | ${signed(r.ablationC - r.arm1)} |`),
  ].join("\n");

  const ablB = devRows.length
    ? [
        "| Location | Arm 2 +device (4-band) | Ablation B (per-day device) | Δ (B−arm2) |",
        "| --- | ---: | ---: | ---: |",
        ...devRows.map((r) => {
          const d = r.device as NonNullable<LocResult["device"]>;
          return `| ${r.name} | ${f2(d.arm2Val)} | ${f2(d.ablationBVal)} | ${signed(d.ablationBVal - d.arm2Val)} |`;
        }),
      ].join("\n")
    : "_No device-tier locations to compare._";

  const fitTimes = L.map((r) => r.builtinFitSecs);
  const devTimes = devRows.map((r) => (r.device as NonNullable<LocResult["device"]>).deviceFitSecs);
  const timingLine =
    `Per-location builtin fit (arm 1 + ablations A/C, 2 fits each): ` +
    `${Math.min(...fitTimes).toFixed(1)}–${Math.max(...fitTimes).toFixed(1)} s (median ${median(fitTimes).toFixed(1)} s). ` +
    (devTimes.length
      ? `Device fit (arm 2 + ablation B, 2 fits each): ${Math.min(...devTimes).toFixed(1)}–${Math.max(...devTimes).toFixed(1)} s (median ${median(devTimes).toFixed(1)} s).`
      : "");

  const d = p.decision;

  return `# ADR 0011 — fitted weight-ladder experiment results

_Generated ${p.generatedAt}${p.smoke ? " — **SMOKE RUN** (2 locations × 6 runs; not the adoption evidence)" : ""} by \`scripts/run-weight-experiment.ts\`._

## Protocol

Work package 3 of [ADR 0011](../adr/0011-fitted-weight-ladder.md): the pre-registered
offline experiment that gates adopting the fitted weight ladder over the hand-tuned
lead-time decay.

- **Locations:** ${p.protocol.locations.length} ADR-0010 reference points — ${p.protocol.locations.join(", ")}.
- **Runs:** ${p.protocol.runsPerLocation} × 00Z per location, evenly spaced ${p.protocol.runDates[0]} → ${p.protocol.runDates[p.protocol.runDates.length - 1]} (archive floor ${p.protocol.archiveStart}, newest = today − ${p.protocol.truthLagDays} d so band-4 truth exists), \`forecast_days: 10\`.
- **Truth:** ERA5-Seamless via the historical-weather API.
- **Metric:** mean \`scoreScope\` composite (temperature_2m + precipitation, the fitting
  machinery's own aggregation) across a location's evaluated runs. Higher is better (0–100).
- **Arms:**
  - **Arm 0 (incumbent):** aggregate under production \`modelWeight\` (hand-tuned decay), no multipliers.
  - **Arm 1 (new default):** \`ladderModelWeight\` with a builtin set fitted **leave-one-location-out** (for each L, fit on the other 11, evaluate on all of L's runs).
  - **Arm 2 (device tier):** per L, oldest ${(VAL_FRACTION * 100).toFixed(0)}% -complement train / newest val split (min ${MIN_VAL_RUNS} val, min ${MIN_TRAIN_RUNS} train — learnedWeights constants); device residuals fitted on train with L's LOLO builtin baked in, evaluated builtin+device vs builtin-only on val.
  - **Ablation A:** arm 1 with a 10-band per-day builtin partition.
  - **Ablation B (falsification):** arm 2 with per-day device bands only.
  - **Ablation C:** arm 1 resolving the per-class tier only (perModel emptied).

\`\`\`
${DECISION_RULE}
\`\`\`

## Data actually gathered

${gatherTable}

Band-4 = the "7–10d" band (168–240 h); only long-range models (globals, AI,
ensemble-mean) reach it, so its per-run model count is structurally low.

## Verdicts

- **Adopt new default (arm 1)?** ${yn(d.adopt)} — median composite ${f2(d.medArm0)} → ${f2(d.medArm1)} (median Δ ${signed(d.medDelta1)}), wins ${d.wins1}/${L.length} (needs median gain AND ≥ 8/12).
- **Ship device tier (arm 2)?** ${yn(d.ship)} — on val runs median ${f2(d.medBuiltinOnly)} → ${f2(d.medArm2)} (median Δ ${signed(d.medDelta2)}), wins ${d.wins2}/${d.deviceLocs} (needs adoption to pass first, plus median gain AND ≥ 8/12).

## Arm 1 vs arm 0 (per location)

${arm1Table}

## Arm 2 (device) vs builtin-only, held-out val runs

${arm2Table}${skipNote}

## Ablations (informational)

### A — per-day builtin bands vs arm 1's 4 bands

${ablA}

### B — per-day device bands vs arm 2's 4 bands (falsification arm)

${ablB}

### C — class-only builtin vs arm 1's per-model builtin

${ablC}

## Timing

${timingLine}

## Caveats

- **Season skew.** The single-runs archive starts ${p.protocol.archiveStart}; every run
  here is northern-hemisphere late-spring/summer. The fit encodes that regime only —
  the same "regenerate as the archive deepens" obligation ADR 0010 carries, but weights
  steer the headline forecast more directly.
- **Archive depth & band-4 thinness.** Band 4 is scorable only for the long-range
  models and only on runs old enough for run+10d truth; its data gate runs structurally
  thin, so many (model, band-4) slots stay \`null\` and inherit down the ladder — see the
  gathered-data table for the actual coverage.
- **LOLO ≠ production fit.** Each arm-1 builtin is fitted on 11 locations and scored on
  the held-out 12th, which is the honest generalisation estimate but is *not* the set the
  shipping default would be fitted on (all 12). Adoption evidence, not the shipped weights.
- **Southern-hemisphere / tropical members** (Sydney, São Paulo, Cape Town, Singapore)
  are in their own seasons and climates; a single pooled builtin is a compromise across
  all regimes, which the per-location device tier exists to refine.
${p.smoke ? "- **This is a smoke run** — 2 locations, 6 runs. Numbers validate the pipeline only; the decision rule is not meaningfully satisfiable at n = 2.\n" : ""}`;
}

await main();
