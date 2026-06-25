// In-browser, per-location weight training (training plan phase 5). Fits a
// per-model weight *multiplier* on top of the heuristic weights to maximise the
// aggregate's composite skill over a stored sample — with a train/validation
// split (fit on older runs, validate on recent), shrinkage toward the heuristic
// to curb per-location overfitting, and a minimum-sample guard. Pure, and it
// reuses the real `modelWeight` + `scoreScope`, so "what we train" == "what we
// score". See ADR 0007.

import { getModel } from "@/domain/models";
import { scoreScope } from "@/domain/scorecard";
import { modelWeight } from "@/domain/weighting";

import type { RunEvaluation } from "./runEvaluation";
import type { LocationSample } from "./sample";

// Tunables.
export const MIN_TRAIN_RUNS = 8;
export const MIN_VAL_RUNS = 3;
export const VAL_FRACTION = 0.3;
const PASSES = 3;
/** Grid the per-model multiplier is searched over (coordinate descent). */
const CANDIDATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2] as const;
/** How far fitted multipliers are kept from 1 (the heuristic). 0 = ignore the
 *  fit, 1 = trust it fully; 0.5 halves the deviation. */
export const SHRINK = 0.5;

export interface FitResult {
  ok: boolean;
  /** Reason when `ok` is false (e.g. not enough runs). */
  reason?: string;
  /** Per-model multipliers (shrunk) to persist + apply; `{}` when not ok. */
  multipliers: Record<string, number>;
  nTrain: number;
  nVal: number;
  /** Mean composite on the held-out validation runs — fitted vs heuristic baseline. */
  valComposite: number;
  valBaselineComposite: number;
  /** valComposite − valBaselineComposite; > 0 means the fit helped out-of-sample. */
  improvement: number;
}

interface VarPanel {
  ids: string[];
  /** [timestep][modelIdx] heuristic weight. */
  w: number[][];
  /** [timestep][modelIdx] forecast value. */
  v: (number | null)[][];
  truth: (number | null)[];
}
interface RunPanel {
  temp: VarPanel;
  precip: VarPanel;
}

/** Precompute the heuristic weight matrix + value matrix for one run+variable,
 *  so the optimiser's inner loop is plain weighted means (no modelWeight calls). */
function buildVarPanel(run: RunEvaluation, variable: "temperature_2m" | "precipitation", lat: number, lon: number): VarPanel {
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
      wRow.push(model ? modelWeight(model, leadH, lat, lon, variable) : 0);
      vRow.push(perModel[id]?.[i] ?? null);
    }
    w.push(wRow);
    v.push(vRow);
  }
  return { ids, w, v, truth: truth.slice(0, times.length) };
}

function buildPanel(run: RunEvaluation, lat: number, lon: number): RunPanel {
  return { temp: buildVarPanel(run, "temperature_2m", lat, lon), precip: buildVarPanel(run, "precipitation", lat, lon) };
}

/** Weighted-mean aggregate of one panel under candidate multipliers `m`. */
function aggUnder(panel: VarPanel, m: Record<string, number>): (number | null)[] {
  return panel.w.map((wRow, i) => {
    const vRow = panel.v[i] ?? [];
    let num = 0;
    let den = 0;
    for (let k = 0; k < panel.ids.length; k++) {
      const val = vRow[k];
      if (val == null) continue;
      const ww = (wRow[k] ?? 0) * (m[panel.ids[k] ?? ""] ?? 1);
      if (ww <= 0) continue;
      num += ww * val;
      den += ww;
    }
    return den > 0 ? num / den : null;
  });
}

function runComposite(panel: RunPanel, m: Record<string, number>): number {
  return scoreScope(aggUnder(panel.temp, m), panel.temp.truth, aggUnder(panel.precip, m), panel.precip.truth).composite;
}

function meanComposite(panels: readonly RunPanel[], m: Record<string, number>): number {
  let sum = 0;
  let n = 0;
  for (const p of panels) {
    const c = runComposite(p, m);
    if (Number.isFinite(c)) {
      sum += c;
      n += 1;
    }
  }
  return n ? sum / n : NaN;
}

const runKey = (r: RunEvaluation): string => `${r.runDate}T${String(r.runHour).padStart(2, "0")}`;

/** Fit per-model multipliers for a location's stored sample. */
export function fitWeights(sample: LocationSample): FitResult {
  const fail = (reason: string): FitResult => ({ ok: false, reason, multipliers: {}, nTrain: 0, nVal: 0, valComposite: NaN, valBaselineComposite: NaN, improvement: 0 });

  const { latitude: lat, longitude: lon } = sample.location;
  const runs = [...sample.runs].toSorted((a, b) => runKey(a).localeCompare(runKey(b))); // oldest first
  if (runs.length < MIN_TRAIN_RUNS + MIN_VAL_RUNS) return fail(`Need at least ${MIN_TRAIN_RUNS + MIN_VAL_RUNS} runs to train; have ${runs.length}.`);

  const nVal = Math.max(MIN_VAL_RUNS, Math.round(runs.length * VAL_FRACTION));
  const trainRuns = runs.slice(0, runs.length - nVal);
  const valRuns = runs.slice(runs.length - nVal);
  if (trainRuns.length < MIN_TRAIN_RUNS) return fail(`Need at least ${MIN_TRAIN_RUNS} training runs; have ${trainRuns.length}.`);

  const trainPanels = trainRuns.map((r) => buildPanel(r, lat, lon));
  const valPanels = valRuns.map((r) => buildPanel(r, lat, lon));

  const ids = [...new Set(trainPanels.flatMap((p) => [...p.temp.ids, ...p.precip.ids]))];
  const m: Record<string, number> = Object.fromEntries(ids.map((id) => [id, 1]));

  // Coordinate descent: hold all but one multiplier fixed, grid-search the best.
  for (let pass = 0; pass < PASSES; pass++) {
    for (const id of ids) {
      let best = m[id] ?? 1;
      let bestObj = meanComposite(trainPanels, m);
      for (const c of CANDIDATES) {
        m[id] = c;
        const obj = meanComposite(trainPanels, m);
        if (obj > bestObj) {
          bestObj = obj;
          best = c;
        }
      }
      m[id] = best;
    }
  }

  // Shrink toward the heuristic — small per-location samples overfit otherwise.
  const multipliers: Record<string, number> = {};
  for (const id of ids) multipliers[id] = 1 + SHRINK * ((m[id] ?? 1) - 1);

  const valComposite = meanComposite(valPanels, multipliers);
  const valBaselineComposite = meanComposite(valPanels, {});
  return { ok: true, multipliers, nTrain: trainRuns.length, nVal: valRuns.length, valComposite, valBaselineComposite, improvement: valComposite - valBaselineComposite };
}
