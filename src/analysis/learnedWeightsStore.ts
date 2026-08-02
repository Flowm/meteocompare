// Per-location persistence for trained weight multipliers (localStorage), keyed
// by the same 0.25° grid as gathered samples. Payloads are tiny (one number per
// model), so localStorage suits better than IndexedDB. The live forecast applies
// these only when the user opts in via the settings toggle.
//
// A stored fit can declare a *reach* radius (km): the area around its training
// location within which the same weights apply to other locations (uniform, hard
// cutoff). loadWeights resolves the exact grid cell first; failing that, it falls
// back to the nearest training location whose reach covers the point. See ADR
// 0007 and the "Reach" / "Training location" glossary entries in CONTEXT.md.

import type { CalibrationSet } from "@/domain/calibration";
import { haversineKm } from "@/domain/geo";

import { createLocalKeyedStore, type Migrate } from "./keyedStore";
import { sampleKey } from "./sampleStore";

const PREFIX = "meteocompare:weights:";

/** Record version — doubles as the weight *recipe* version. Bumped to 2 when the
 *  fitted weight ladder (ADR 0011) replaced the hand-tuned lead-time decay:
 *  multipliers stored under the old recipe were fitted as residuals on top of the
 *  decay, so re-applying them on top of the ladder's builtin tier (which already
 *  carries that lead-time correction) would DOUBLE-APPLY it. Such records are
 *  therefore dropped on read (see `dropStaleRecipe`), not migrated — the fit isn't
 *  transformable into the new recipe, only re-fitted. The calibration set riding
 *  inside a dropped record goes with it (device-pooled + built-in calibration
 *  tiers still resolve below it); the stored SAMPLES live in a separate store and
 *  persist, so the user just retrains. (v0 = bare pre-envelope, v1 = enveloped
 *  decay-recipe fit — both pre-ladder, both dropped.) */
const WEIGHTS_VERSION = 2;

/** Drop any record written under a pre-ladder recipe (v0 bare, v1 decay). There
 *  is no forward migration: a decay-era multiplier is meaningless against the
 *  fitted builtin tier, so `null` (treat as absent) is the only safe answer. */
const dropStaleRecipe: Migrate<StoredWeights> = () => null;

/** Reach radii offered in the UI (km). 0 = "this point only" (no reach). */
export const REACH_PRESETS_KM = [0, 25, 50, 100, 250] as const;

export interface StoredWeights {
  multipliers: Record<string, number>;
  /** ISO timestamp when fitted (passed in by the caller). */
  trainedAt: string;
  /** Out-of-sample validation improvement at fit time (composite delta). */
  improvement: number;
  /** Training location — the center of any reach, and the overview's label.
   *  Absent on entries stored before reach existed. */
  location?: { name: string; detail?: string; latitude: number; longitude: number };
  /** Reach radius in km: these weights apply to any location within this distance
   *  of the training location. Absent / 0 = "this point only" (the exact cell). */
  radiusKm?: number;
  /** Predictability calibration curves fitted from the same sample (ADR 0008).
   *  Rides along with the weights so it inherits the grid key and reach for
   *  free. Optional + additive: entries stored before calibration existed load
   *  unchanged and resolve to the pooled tier / raw heuristic instead. */
  calibration?: CalibrationSet;
}

/** A stored entry paired with its grid key, for the device-wide overview. */
export interface WeightEntry {
  /** The 0.25° grid key, e.g. "47.25,11.50". */
  key: string;
  weights: StoredWeights;
}

// The synchronous localStorage machinery — availability guard, JSON codec, and
// record versioning — lives in keyedStore; only the reach-resolution logic below
// is specific to weights. Pre-ladder records (any version below WEIGHTS_VERSION)
// are dropped on read, not migrated (see the WEIGHTS_VERSION note).
const store = createLocalKeyedStore<StoredWeights>({ prefix: PREFIX, version: WEIGHTS_VERSION, migrate: dropStaleRecipe });

/** The training center to measure reach from: the stored exact coords when
 *  present, else the grid-cell center parsed back from the key. */
function centerOf(entry: WeightEntry): { lat: number; lon: number } {
  const loc = entry.weights.location;
  if (loc) return { lat: loc.latitude, lon: loc.longitude };
  const [latStr = "", lonStr = ""] = entry.key.split(",");
  return { lat: Number(latStr), lon: Number(lonStr) };
}

/** Resolve trained weights for a location: the exact grid cell wins; otherwise
 *  the nearest training location whose reach covers the point. null when none. */
export function loadWeights(lat: number, lon: number): StoredWeights | null {
  const exact = store.get(sampleKey(lat, lon));
  if (exact) return exact;

  let best: StoredWeights | null = null;
  let bestDist = Infinity;
  for (const entry of listWeights()) {
    const reach = entry.weights.radiusKm ?? 0;
    if (reach <= 0) continue;
    const c = centerOf(entry);
    const dist = haversineKm(lat, lon, c.lat, c.lon);
    if (dist <= reach && dist < bestDist) {
      bestDist = dist;
      best = entry.weights;
    }
  }
  return best;
}

export function listWeights(): WeightEntry[] {
  return store.list().map(({ key, value }) => ({ key, weights: value }));
}

export function saveWeights(lat: number, lon: number, weights: StoredWeights): void {
  store.set(sampleKey(lat, lon), weights);
}

/** Update only the reach radius of an existing entry (by grid key). No-op when
 *  the entry is gone. */
export function setReach(key: string, radiusKm: number): void {
  const weights = store.get(key);
  if (!weights) return;
  store.set(key, { ...weights, radiusKm });
}

export function clearWeights(lat: number, lon: number): void {
  clearWeightsByKey(sampleKey(lat, lon));
}

export function clearWeightsByKey(key: string): void {
  store.remove(key);
}
