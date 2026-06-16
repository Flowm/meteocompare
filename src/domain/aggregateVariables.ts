// Batch application of the weighted Aggregate + per-variable Confidence over a
// set of variables sharing one time axis. Wraps aggregateSeries + confidenceFor
// so the forecast and verification orchestration no longer repeat the triad
// (extract → aggregateSeries → confidenceFor) at five separate call sites.
//
// Pure: callers pass already-extracted per-model series (each owns its own
// extractor — hourly vs daily, forecast vs single-runs). This module never
// touches the API layer or CONTEXT.md's "truth" — see docs/adr/0001.

import { aggregateSeries, type AggregatePoint } from "./aggregate";
import { confidenceFor } from "./confidence";
import type { ModelDef } from "./models";
import type { Variable } from "./weighting";

export interface VarSpec<K extends string = string> {
  /** Result + perModel key — what the output is keyed by. For daily variables
   *  this is the fetched id (e.g. "temperature_2m_max"). */
  key: K;
  /** Weighting + confidence family the key rolls up to (e.g. a daily max is
   *  weighted/scored as "temperature_2m"). For hourly variables key === family. */
  family: Variable;
}

export interface AggregateVariablesOptions<K extends string = string> {
  /** Shared time axis (location-local ISO strings). */
  times: string[];
  /** Pre-extracted per-model series, keyed by VarSpec.key → model id → values. */
  perModel: Record<K, Record<string, (number | null)[]>>;
  vars: readonly VarSpec<K>[];
  models: ModelDef[];
  lat: number;
  lon: number;
  /** Run/forecast start — drives lead-time decay in the weighting recipe. */
  baseTime: Date;
  /** The sole home of the index→lead-hours convention. `hourly`: lead = index,
   *  confidence resolution "hourly". `daily`: lead = index*24 + 12 (a noon
   *  anchor), resolution "daily". */
  cadence: "hourly" | "daily";
}

export interface AggregatedVariables<K extends string = string> {
  /** Variable key → weighted-ensemble aggregate points. */
  aggregate: Record<K, AggregatePoint[]>;
  /** Variable key → per-timestep confidence (0..1). */
  confidence: Record<K, number[]>;
  /** Echoed input, so the result is a drop-in view-model. */
  perModel: Record<K, Record<string, (number | null)[]>>;
}

/** Generic over the variable-key set `K`, so the narrowly-keyed input records
 *  (e.g. `Record<HourlyVar, …>`) flow straight through to the result — callers
 *  no longer cast the output back to their view-model shape. */
export function aggregateVariables<K extends string>(opts: AggregateVariablesOptions<K>): AggregatedVariables<K> {
  const leadAt = (i: number): number => (opts.cadence === "daily" ? i * 24 + 12 : i);
  const aggregate = {} as Record<K, AggregatePoint[]>;
  const confidence = {} as Record<K, number[]>;
  for (const { key, family } of opts.vars) {
    const byModel = opts.perModel[key] ?? {};
    const agg = aggregateSeries(opts.times, byModel, {
      variable: family,
      models: opts.models,
      lat: opts.lat,
      lon: opts.lon,
      baseTime: opts.baseTime,
    });
    aggregate[key] = agg;
    confidence[key] = agg.map((p, i) => confidenceFor(p, family, leadAt(i), opts.cadence));
  }
  return { aggregate, confidence, perModel: opts.perModel };
}
