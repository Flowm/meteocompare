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

import { haversineKm } from "@/domain/geo";

import { sampleKey } from "./sampleStore";

const PREFIX = "meteocompare:weights:";

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
}

/** A stored entry paired with its grid key, for the device-wide overview. */
export interface WeightEntry {
  /** The 0.25° grid key, e.g. "47.25,11.50". */
  key: string;
  weights: StoredWeights;
}

function parse(raw: string | null): StoredWeights | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredWeights;
  } catch {
    return null;
  }
}

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
  if (typeof localStorage === "undefined") return null;
  const exact = parse(localStorage.getItem(PREFIX + sampleKey(lat, lon)));
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

/** Every stored weight set on this device, paired with its grid key. */
export function listWeights(): WeightEntry[] {
  if (typeof localStorage === "undefined") return [];
  const out: WeightEntry[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k?.startsWith(PREFIX)) continue;
    const weights = parse(localStorage.getItem(k));
    if (weights) out.push({ key: k.slice(PREFIX.length), weights });
  }
  return out;
}

export function saveWeights(lat: number, lon: number, weights: StoredWeights): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(PREFIX + sampleKey(lat, lon), JSON.stringify(weights));
}

/** Update only the reach radius of an existing entry (by grid key). No-op when
 *  the entry is gone. */
export function setReach(key: string, radiusKm: number): void {
  if (typeof localStorage === "undefined") return;
  const weights = parse(localStorage.getItem(PREFIX + key));
  if (!weights) return;
  localStorage.setItem(PREFIX + key, JSON.stringify({ ...weights, radiusKm }));
}

export function clearWeights(lat: number, lon: number): void {
  clearWeightsByKey(sampleKey(lat, lon));
}

export function clearWeightsByKey(key: string): void {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(PREFIX + key);
}
