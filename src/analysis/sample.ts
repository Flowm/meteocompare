// Cross-run aggregation of a location's sample: per-model performance across
// many runs, coverage-aware (a model is only averaged over the runs it appeared
// in and was scorable). Pure — the multi-run performance view (Phase 4) renders
// this, and the trainer (Phase 5) reads the stored runs directly.

import { LEAD_BANDS } from "@/domain/scorecard";

import type { RunEvaluation } from "./runEvaluation";

export interface SampleLocation {
  latitude: number;
  longitude: number;
  name?: string;
}

/** A location's gathered runs. Persisted via sampleStore on the "Store data" button. */
export interface LocationSample {
  location: SampleLocation;
  runs: RunEvaluation[];
  /** ISO timestamp of when the sample was gathered — passed in by the caller;
   *  this module never reads the clock. */
  gatheredAt: string;
}

/** Per-model performance summarised across a sample. */
export interface ModelSampleStats {
  id: string;
  isAggregate: boolean;
  /** Runs in which the model was present AND scorable (finite Overall composite). */
  n: number;
  compositeMean: number;
  compositeMin: number;
  compositeMax: number;
  /** Mean composite per `LEAD_BANDS` entry; null when never scorable in that band. */
  bandCompositeMeans: (number | null)[];
  tempMaeMean: number;
  tempBiasMean: number;
  amountErrorMean: number;
  timingMean: number;
}

const mean = (xs: readonly number[]): number => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN);
const rankKey = (c: number): number => (Number.isFinite(c) ? c : -Infinity);

interface Acc {
  isAggregate: boolean;
  composites: number[];
  bands: number[][];
  tempMae: number[];
  tempBias: number[];
  amount: number[];
  timing: number[];
}

/** Aggregate per-model scores across all runs, sorted by mean Overall composite
 *  (best first; the aggregate row is ranked inline like a model). */
export function aggregateSample(runs: readonly RunEvaluation[]): ModelSampleStats[] {
  const bandCount = LEAD_BANDS.length;
  const byId = new Map<string, Acc>();

  const accFor = (id: string, isAggregate: boolean): Acc => {
    let e = byId.get(id);
    if (!e) {
      e = { isAggregate, composites: [], bands: Array.from({ length: bandCount }, () => []), tempMae: [], tempBias: [], amount: [], timing: [] };
      byId.set(id, e);
    }
    return e;
  };

  const pushFinite = (arr: number[], v: number): void => {
    if (Number.isFinite(v)) arr.push(v);
  };

  for (const run of runs) {
    for (const row of run.scorecard) {
      const e = accFor(row.id, row.isAggregate);
      pushFinite(e.composites, row.overall.composite);
      row.bandComposites.forEach((b, i) => {
        const bucket = e.bands[i];
        if (b != null && bucket) pushFinite(bucket, b);
      });
      pushFinite(e.tempMae, row.overall.tempMae);
      pushFinite(e.tempBias, row.overall.tempBias);
      pushFinite(e.amount, row.overall.amountError);
      pushFinite(e.timing, row.overall.timingScore);
    }
  }

  const stats: ModelSampleStats[] = [];
  for (const [id, e] of byId) {
    stats.push({
      id,
      isAggregate: e.isAggregate,
      n: e.composites.length,
      compositeMean: mean(e.composites),
      compositeMin: e.composites.length ? Math.min(...e.composites) : NaN,
      compositeMax: e.composites.length ? Math.max(...e.composites) : NaN,
      bandCompositeMeans: e.bands.map((arr) => (arr.length ? mean(arr) : null)),
      tempMaeMean: mean(e.tempMae),
      tempBiasMean: mean(e.tempBias),
      amountErrorMean: mean(e.amount),
      timingMean: mean(e.timing),
    });
  }
  stats.sort((a, b) => rankKey(b.compositeMean) - rankKey(a.compositeMean));
  return stats;
}
