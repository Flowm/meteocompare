// Persistence for gathered location samples (IndexedDB), plus the pure helpers
// that key a location to a grid cell and merge runs without duplicates. Only the
// I/O touches IndexedDB and is browser-only (guarded); the helpers are pure and
// unit-tested.

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

// --- IndexedDB I/O (browser only) -----------------------------------------

const DB_NAME = "meteocompare";
const STORE = "samples";

interface StoredRecord {
  key: string;
  sample: LocationSample;
}

function idbAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: "key" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexedDB open failed"));
  });
}

/** Load the stored sample for a location key, or null when none / no IndexedDB. */
export async function loadSample(key: string): Promise<LocationSample | null> {
  if (!idbAvailable()) return null;
  const db = await openDb();
  try {
    return await new Promise<LocationSample | null>((resolve, reject) => {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
      req.onsuccess = () => resolve((req.result as StoredRecord | undefined)?.sample ?? null);
      req.onerror = () => reject(req.error ?? new Error("indexedDB get failed"));
    });
  } finally {
    db.close();
  }
}

/** Persist a sample under a location key (overwrites). No-op without IndexedDB. */
export async function saveSample(key: string, sample: LocationSample): Promise<void> {
  if (!idbAvailable()) return;
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const record: StoredRecord = { key, sample };
      tx.objectStore(STORE).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("indexedDB put failed"));
    });
  } finally {
    db.close();
  }
}

/** All stored samples (for a future "manage stored data" view). [] without IndexedDB. */
export async function listSamples(): Promise<LocationSample[]> {
  if (!idbAvailable()) return [];
  const db = await openDb();
  try {
    return await new Promise<LocationSample[]>((resolve, reject) => {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
      req.onsuccess = () => resolve((req.result as StoredRecord[]).map((r) => r.sample));
      req.onerror = () => reject(req.error ?? new Error("indexedDB getAll failed"));
    });
  } finally {
    db.close();
  }
}
