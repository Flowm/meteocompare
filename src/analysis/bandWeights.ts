// Band-sliced weight fitting (ADR 0011, work package 2). GATED — not wired into
// the app; the experiment (work package 3) and tests drive it. Generalises
// learnedWeights.ts's coordinate descent three ways:
//   1. it fits against the LADDER recipe (weightLadder.ladderModelWeight), not
//      the decay-based modelWeight — so "what we train == what we score" for the
//      new recipe;
//   2. panels carry per-timestep lead hours and can be pooled across locations,
//      so a fit spans many (run, location) panels;
//   3. it adds a per-lead-band stage on top of the pooled stage, hierarchically
//      shrunk (a band's multiplier shrinks toward the pooled one).
//
// Deliberately PARALLEL to learnedWeights.ts rather than a refactor of it:
// learnedWeights ships (useTrainingFlow depends on it) and fits the OLD recipe,
// so it stays byte-for-byte untouched. Importing this gated module into it would
// pull the not-yet-adopted ladder into the shipping dependency graph and defeat
// the ADR-0011 gate; the shared objective helpers (aggUnder / composite means)
// are a few lines and are duplicated here on purpose.
//
// All functions are pure and deterministic — no Date.now, no randomness. Runs
// whose band slice carries no scorable truth simply don't contribute to that
// band's objective (band 4 truth is structurally thin — ADR 0011 — so this must
// degrade, not throw); the scorecard primitives return NaN on empty slices and
// meanComposite skips them.

import { getModel, type ModelKind } from "@/domain/models";
import { LEAD_BANDS, scoreScope, type LeadBand } from "@/domain/scorecard";
import { ladderModelWeight, type BuiltinWeightMeta, type BuiltinWeightSet, type DeviceBandWeights } from "@/domain/weightLadder";

import type { RunEvaluation } from "./runEvaluation";

// Tunables (ADR 0007's grid + passes, extended per ADR 0011).
/** Pooled-stage coordinate-descent grid (identical to learnedWeights). */
export const POOLED_GRID = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2] as const;
const POOLED_PASSES = 3;
/** Band-stage candidates, as factors of each model's pooled multiplier. */
export const BAND_GRID_FACTORS = [0.5, 0.67, 1, 1.5, 2] as const;
const BAND_PASSES = 3;
/** Clamp band candidates to a sane multiplier range (the pooled grid's span). */
export const MULT_MIN = 0.25;
export const MULT_MAX = 2;
/** A (model, band) needs at least this many runs with data in the band, else its
 *  band slot stays null and inherits down the ladder (ADR 0011 data gate). */
export const MIN_BAND_RUNS = 6;
/** Default pooled-stage shrink toward 1, and band-stage shrink toward pooled —
 *  keep 50% of the fitted deviation (learnedWeights parity; the device tier). */
export const DEFAULT_SHRINK = 0.5;
/** Band-stage shrink toward the pooled value (ADR 0011: BAND_SHRINK). */
export const BAND_SHRINK = 0.5;
/** Builtin fit keeps more of the deviation — the reference-location pool is
 *  large, so overfitting is less of a risk than at the device tier. */
export const BUILTIN_SHRINK = 0.8;

const clampMult = (x: number): number => Math.min(MULT_MAX, Math.max(MULT_MIN, x));

interface VarPanel {
  ids: string[];
  /** [timestep][modelIdx] ladder BASE weight (the recipe with the tier being fit
   *  held neutral — for the device fit that means builtin is baked in here). */
  w: number[][];
  /** [timestep][modelIdx] forecast value. */
  v: (number | null)[][];
  truth: (number | null)[];
  /** [timestep] lead hours from run start — the axis band slicing keys off. */
  lead: number[];
}
export interface RunPanel {
  temp: VarPanel;
  precip: VarPanel;
}

export interface BuildPanelsInput {
  runs: readonly RunEvaluation[];
  lat: number;
  lon: number;
  /** Builtin tier to bake into the panel base, so a device fit built on these
   *  panels learns residuals ON TOP of it. Omit for a builtin (or bare) fit. */
  builtin?: BuiltinWeightSet;
  /** Band partition (defaults to LEAD_BANDS) — passed through to the ladder base
   *  so band gating matches the fit's own slicing. */
  bands?: readonly LeadBand[];
}

/** Precompute the ladder base-weight matrix + value matrix for one run+variable,
 *  so the optimiser's inner loop is plain weighted means. The stacked multiplier
 *  `m` in {@link aggUnder} is the tier being fit; everything below it (region
 *  bonus, variable boost, and — when supplied — the builtin tier) is baked here. */
function buildVarPanel(
  run: RunEvaluation,
  variable: "temperature_2m" | "precipitation",
  lat: number,
  lon: number,
  builtin: BuiltinWeightSet | undefined,
  bands: readonly LeadBand[],
): VarPanel {
  const { times } = run.hourly;
  const perModel = run.hourly.perModel[variable] ?? {};
  const truth = run.hourly.truth?.[variable] ?? [];
  const ids = Object.keys(perModel).filter((id) => getModel(id));
  const base = times[0] ? new Date(times[0]).getTime() : 0;
  const w: number[][] = [];
  const v: (number | null)[][] = [];
  const lead: number[] = [];
  for (let i = 0; i < times.length; i++) {
    const t = times[i];
    const leadH = t ? Math.max(0, (new Date(t).getTime() - base) / 3_600_000) : 0;
    lead.push(leadH);
    const wRow: number[] = [];
    const vRow: (number | null)[] = [];
    for (const id of ids) {
      const model = getModel(id);
      // device omitted (that is the tier being fit); builtin baked in when given.
      wRow.push(model ? ladderModelWeight(model, leadH, lat, lon, variable, undefined, builtin, bands) : 0);
      vRow.push(perModel[id]?.[i] ?? null);
    }
    w.push(wRow);
    v.push(vRow);
  }
  return { ids, w, v, truth: truth.slice(0, times.length), lead };
}

/** Build one panel per run for a single location. Pool across locations by
 *  concatenating the results (each panel already bakes its own lat/lon/builtin,
 *  so a mixed-location panel list scores correctly under one multiplier set). */
export function buildPanels({ runs, lat, lon, builtin, bands = LEAD_BANDS }: BuildPanelsInput): RunPanel[] {
  return runs.map((run) => ({
    temp: buildVarPanel(run, "temperature_2m", lat, lon, builtin, bands),
    precip: buildVarPanel(run, "precipitation", lat, lon, builtin, bands),
  }));
}

// ---------------------------------------------------------------------------
// Objective (duplicated from learnedWeights on purpose — see the header note)
// ---------------------------------------------------------------------------

/** Weighted-mean aggregate of one panel over timesteps `[lo, hi)` under
 *  candidate multipliers `m`. */
function aggUnder(panel: VarPanel, m: Record<string, number>, lo: number, hi: number): (number | null)[] {
  const out: (number | null)[] = [];
  for (let i = lo; i < hi; i++) {
    const wRow = panel.w[i] ?? [];
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
    out.push(den > 0 ? num / den : null);
  }
  return out;
}

/** Contiguous index range `[lo, hi)` of the timesteps whose lead hour lies in
 *  `band`. Lead hours are ascending, so band membership is contiguous; days
 *  never straddle a band (bands are 24 h multiples), so slicing the hourly
 *  arrays before scoring keeps the daily precip amount error intact. */
function bandRange(panel: VarPanel, band: LeadBand): { lo: number; hi: number } {
  let lo = -1;
  let hi = 0;
  for (let i = 0; i < panel.lead.length; i++) {
    const l = panel.lead[i] ?? 0;
    if (l >= band.start && l < band.end) {
      if (lo < 0) lo = i;
      hi = i + 1;
    }
  }
  return lo < 0 ? { lo: 0, hi: 0 } : { lo, hi };
}

/** scoreScope composite of one run's aggregate over a timestep range (the full
 *  window when `range` is omitted). NaN when nothing in range is scorable. */
function runComposite(panel: RunPanel, m: Record<string, number>, range?: { lo: number; hi: number }): number {
  const tr = range ?? { lo: 0, hi: panel.temp.w.length };
  const pr = range ?? { lo: 0, hi: panel.precip.w.length };
  const fTemp = aggUnder(panel.temp, m, tr.lo, tr.hi);
  const fPrecip = aggUnder(panel.precip, m, pr.lo, pr.hi);
  return scoreScope(fTemp, panel.temp.truth.slice(tr.lo, tr.hi), fPrecip, panel.precip.truth.slice(pr.lo, pr.hi)).composite;
}

/** Mean full-window composite across runs (skipping runs with no scorable data). */
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

/** Mean band-slice composite across runs. Runs whose slice carries no scorable
 *  truth contribute nothing (NaN, skipped) — graceful thinning, not a throw. */
function meanBandComposite(panels: readonly RunPanel[], m: Record<string, number>, band: LeadBand): number {
  let sum = 0;
  let n = 0;
  for (const p of panels) {
    const c = runComposite(p, m, bandRange(p.temp, band));
    if (Number.isFinite(c)) {
      sum += c;
      n += 1;
    }
  }
  return n ? sum / n : NaN;
}

/** All model ids present across a panel set (union of both variables). */
function panelIds(panels: readonly RunPanel[]): string[] {
  return [...new Set(panels.flatMap((p) => [...p.temp.ids, ...p.precip.ids]))];
}

/** The class of a model id (undefined for ids not in the registry). */
const kindOf = (id: string): ModelKind | undefined => getModel(id)?.kind;

/** Group ids by model class — the coordinate units of a tied (per-class) fit,
 *  where every member of a class moves together. Non-tied fits use one group
 *  per id (see {@link coordinateGroups}). Ids with no registered class are their
 *  own singleton group, so a fit never silently drops them. */
function classGroups(ids: readonly string[]): string[][] {
  const byKind = new Map<string, string[]>();
  for (const id of ids) {
    const key = kindOf(id) ?? `__${id}`;
    const group = byKind.get(key);
    if (group) group.push(id);
    else byKind.set(key, [id]);
  }
  return [...byKind.values()];
}

const coordinateGroups = (ids: readonly string[], tied: boolean): string[][] => (tied ? classGroups(ids) : ids.map((id) => [id]));

/** Runs in which any member of `group` has ≥1 non-null value inside `band` — the
 *  data-gate count. For a single-model group this is the model's own run count;
 *  for a tied class it counts runs where the class was represented at all. */
function bandRunCount(panels: readonly RunPanel[], group: readonly string[], band: LeadBand): number {
  const set = new Set(group);
  let n = 0;
  for (const p of panels) {
    if (hasBandData(p.temp, set, band) || hasBandData(p.precip, set, band)) n += 1;
  }
  return n;
}

function hasBandData(panel: VarPanel, ids: ReadonlySet<string>, band: LeadBand): boolean {
  const { lo, hi } = bandRange(panel, band);
  for (let i = lo; i < hi; i++) {
    const vRow = panel.v[i] ?? [];
    for (let k = 0; k < panel.ids.length; k++) {
      if (ids.has(panel.ids[k] ?? "") && vRow[k] != null) return true;
    }
  }
  return false;
}

export interface PooledOpts {
  /** Kept fraction of the fitted deviation from 1 (shrinkage). Default 0.5. */
  shrink?: number;
  /** Tie each model class to one coordinate (per-class fit). Default false. */
  tied?: boolean;
}

/** Stage 1: pooled per-model (or per-class, when `tied`) multipliers, by
 *  coordinate descent on the full-window composite — the ADR-0007 fit, verbatim,
 *  but scoring the ladder recipe and pooled across every panel. Returns one
 *  shrunk multiplier per id (class members share their class's value when tied). */
export function fitPooledMultipliers(panels: readonly RunPanel[], opts: PooledOpts = {}): Record<string, number> {
  const shrink = opts.shrink ?? DEFAULT_SHRINK;
  const ids = panelIds(panels);
  const groups = coordinateGroups(ids, opts.tied ?? false);
  const m: Record<string, number> = Object.fromEntries(ids.map((id) => [id, 1]));

  for (let pass = 0; pass < POOLED_PASSES; pass++) {
    for (const group of groups) {
      let best = m[group[0] ?? ""] ?? 1;
      let bestObj = meanComposite(panels, m);
      for (const c of POOLED_GRID) {
        for (const id of group) m[id] = c;
        const obj = meanComposite(panels, m);
        if (obj > bestObj) {
          bestObj = obj;
          best = c;
        }
      }
      for (const id of group) m[id] = best;
    }
  }

  const out: Record<string, number> = {};
  for (const id of ids) out[id] = 1 + shrink * ((m[id] ?? 1) - 1);
  return out;
}

export interface BandOpts {
  bands?: readonly LeadBand[];
  /** Kept fraction of the deviation from the pooled value. Default BAND_SHRINK. */
  shrink?: number;
  /** Min runs with band data before a slot is trusted. Default MIN_BAND_RUNS. */
  minRuns?: number;
  tied?: boolean;
}

/** Stage 2: for each band independently, grid-search each coordinate's band
 *  multiplier around its pooled value, objective = mean band-slice composite.
 *  Data gate: a coordinate below `minRuns` runs-with-band-data keeps a `null`
 *  slot (inherits down the ladder). Hierarchical shrink: the kept slot is
 *  `pooled + shrink × (fitted − pooled)`. Returns one slot array per id. */
export function fitBandMultipliers(panels: readonly RunPanel[], pooled: Record<string, number>, opts: BandOpts = {}): Record<string, (number | null)[]> {
  const bands = opts.bands ?? LEAD_BANDS;
  const shrink = opts.shrink ?? BAND_SHRINK;
  const minRuns = opts.minRuns ?? MIN_BAND_RUNS;
  const ids = panelIds(panels);
  const groups = coordinateGroups(ids, opts.tied ?? false);
  const result: Record<string, (number | null)[]> = Object.fromEntries(ids.map((id) => [id, bands.map(() => null as number | null)]));

  for (let b = 0; b < bands.length; b++) {
    const band = bands[b];
    if (!band) continue;

    // Coordinate descent within the band, each coordinate seeded at its pooled value.
    const m: Record<string, number> = { ...pooled };
    for (let pass = 0; pass < BAND_PASSES; pass++) {
      for (const group of groups) {
        const p = pooled[group[0] ?? ""] ?? 1;
        const candidates = BAND_GRID_FACTORS.map((f) => clampMult(p * f));
        let best = m[group[0] ?? ""] ?? p;
        let bestObj = meanBandComposite(panels, m, band);
        for (const c of candidates) {
          for (const id of group) m[id] = c;
          const obj = meanBandComposite(panels, m, band);
          if (obj > bestObj) {
            bestObj = obj;
            best = c;
          }
        }
        for (const id of group) m[id] = best;
      }
    }

    // Data gate + hierarchical shrink, per coordinate.
    for (const group of groups) {
      const gated = bandRunCount(panels, group, band) >= minRuns;
      for (const id of group) {
        const slot = result[id];
        if (!slot) continue;
        if (!gated) {
          slot[b] = null;
          continue;
        }
        const p = pooled[id] ?? 1;
        slot[b] = p + shrink * ((m[id] ?? p) - p);
      }
    }
  }
  return result;
}

export interface BuiltinOpts {
  bands?: readonly LeadBand[];
  /** Kept fraction of the deviation (both stages, per-model and per-class).
   *  Default BUILTIN_SHRINK (0.8). */
  shrink?: number;
  minRuns?: number;
  /** Provenance stamped onto the result — caller-supplied (no clock reads). */
  meta: BuiltinWeightMeta;
}

/** Fit a {@link BuiltinWeightSet} from panels pooled across reference locations
 *  (ADR 0011's shipped tier). The per-model sub-tier is a two-stage fit
 *  (pooled → band); the per-class sub-tier is the SAME two-stage fit with every
 *  model of a class tied to one coordinate, then collapsed to one slot array per
 *  class. There is no per-model "pooled" slot in the resolution ladder, so the
 *  pooled stage only anchors the band candidates/shrink target — a band that
 *  fails its gate stays `null` and inherits the per-class value (or 1). */
export function fitBuiltinSet(panelsByLocation: readonly (readonly RunPanel[])[], opts: BuiltinOpts): BuiltinWeightSet {
  const bands = opts.bands ?? LEAD_BANDS;
  const shrink = opts.shrink ?? BUILTIN_SHRINK;
  const minRuns = opts.minRuns ?? MIN_BAND_RUNS;
  const panels = panelsByLocation.flat();
  const ids = panelIds(panels);

  // Per-model: pooled anchor, then per-band (null where gated).
  const pooledModel = fitPooledMultipliers(panels, { shrink });
  const perModel = fitBandMultipliers(panels, pooledModel, { bands, shrink, minRuns });

  // Per-class: identical two-stage fit, tied by class, collapsed to per-class.
  const pooledClass = fitPooledMultipliers(panels, { shrink, tied: true });
  const bandClass = fitBandMultipliers(panels, pooledClass, { bands, shrink, minRuns, tied: true });
  const perClass: Partial<Record<ModelKind, (number | null)[]>> = {};
  for (const group of classGroups(ids)) {
    const rep = group[0];
    const kind = rep ? kindOf(rep) : undefined;
    if (kind && rep) perClass[kind] = bandClass[rep] ?? bands.map(() => null);
  }

  return { perModel, perClass, meta: opts.meta };
}

export interface DeviceOpts {
  bands?: readonly LeadBand[];
  /** Shrink for both stages — pooled toward 1, band toward pooled. Default 0.5. */
  shrink?: number;
  minRuns?: number;
}

/** Fit the device (per-location residual) tier on top of a builtin set. The
 *  panels MUST have been built with that same builtin baked into their base
 *  (`buildPanels({ …, builtin })`), so the coordinate descent finds a residual
 *  centered on 1 and the ladder reproduces `builtinResolved × residual` at apply
 *  time. Stage 1 pooled (shrink toward 1) + stage 2 bands (shrink toward pooled,
 *  null where gated). Returns {@link DeviceBandWeights}; the builtin tier is
 *  untouched. */
export function fitDeviceResiduals(panels: readonly RunPanel[], opts: DeviceOpts = {}): DeviceBandWeights {
  const shrink = opts.shrink ?? DEFAULT_SHRINK;
  const pooled = fitPooledMultipliers(panels, { shrink });
  const bands = fitBandMultipliers(panels, pooled, { bands: opts.bands, shrink, minRuns: opts.minRuns });
  return { pooled, bands };
}
