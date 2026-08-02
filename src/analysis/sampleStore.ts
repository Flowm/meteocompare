// Persistence for gathered location samples (IndexedDB), plus the pure helpers
// that key a location to a grid cell and merge runs without duplicates. Only the
// I/O touches IndexedDB and is browser-only (guarded); the helpers are pure and
// unit-tested.

import { createIdbKeyedStore } from "./keyedStore";
import type { RunEvaluation } from "./runEvaluation";
import type { LocationSample } from "./sample";

const GRID_DEG = 0.25;

/** Grid a location to ~0.25° so nearby points share one stored sample (open-meteo
 *  returns data on its own grid anyway). */
export function sampleKey(lat: number, lon: number): string {
  const snap = (x: number): string => (Math.round(x / GRID_DEG) * GRID_DEG).toFixed(2);
  return `${snap(lat)},${snap(lon)}`;
}

/** A run's identity: ISO run date + zero-padded cycle hour (e.g. `2025-09-01T06`).
 *  The single source of this convention — sample merging and the trainer's
 *  train/val split both order runs by it. */
export const runKey = (r: RunEvaluation): string => `${r.runDate}T${String(r.runHour).padStart(2, "0")}`;

/** Merge incoming runs into existing, de-duplicated by run identity (date +
 *  cycle); incoming wins on conflict. Sorted newest run first. */
export function mergeRuns(existing: readonly RunEvaluation[], incoming: readonly RunEvaluation[]): RunEvaluation[] {
  const byKey = new Map<string, RunEvaluation>();
  for (const r of existing) byKey.set(runKey(r), r);
  for (const r of incoming) byKey.set(runKey(r), r);
  return [...byKey.values()].toSorted((a, b) => runKey(b).localeCompare(runKey(a)));
}

// IndexedDB I/O (browser only)
//
// Boilerplate and the availability guard live in keyedStore. v1 is the first
// *enveloped* shape; records written before it stored the payload under a
// `sample` field (`{ key, sample }`), which the v0 migration below lifts into
// the envelope so existing installs keep loading.

const DB_NAME = "meteocompare";
const STORE = "samples";

/** Record schema version (separate from the IDB database version, which is 1). */
const SAMPLE_VERSION = 1;

const store = createIdbKeyedStore<LocationSample>({
  dbName: DB_NAME,
  storeName: STORE,
  version: SAMPLE_VERSION,
  migrate: (data, fromVersion) => {
    if (fromVersion === 0) {
      // Legacy `{ key, sample }` record — lift `.sample` out. Structurally
      // identical payload, so no field remapping beyond unwrapping.
      const legacy = data as { sample?: LocationSample } | null;
      return legacy?.sample ?? null;
    }
    return data as LocationSample;
  },
});

/** Load the stored sample for a location key, or null when none / no IndexedDB. */
export function loadSample(key: string): Promise<LocationSample | null> {
  return store.get(key);
}

/** Persist a sample under a location key (overwrites). No-op without IndexedDB. */
export function saveSample(key: string, sample: LocationSample): Promise<void> {
  return store.set(key, sample);
}

/** All stored samples (for a future "manage stored data" view). [] without IndexedDB. */
export function listSamples(): Promise<LocationSample[]> {
  return store.list();
}
