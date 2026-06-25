// Per-location persistence for trained weight multipliers (localStorage), keyed
// by the same 0.25° grid as gathered samples. Payloads are tiny (one number per
// model), so localStorage suits better than IndexedDB. The live forecast applies
// these only when the user opts in via the settings toggle.

import { sampleKey } from "./sampleStore";

const PREFIX = "meteocompare:weights:";

export interface StoredWeights {
  multipliers: Record<string, number>;
  /** ISO timestamp when fitted (passed in by the caller). */
  trainedAt: string;
  /** Out-of-sample validation improvement at fit time (composite delta). */
  improvement: number;
}

export function loadWeights(lat: number, lon: number): StoredWeights | null {
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(PREFIX + sampleKey(lat, lon));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredWeights;
  } catch {
    return null;
  }
}

export function saveWeights(lat: number, lon: number, weights: StoredWeights): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(PREFIX + sampleKey(lat, lon), JSON.stringify(weights));
}

export function clearWeights(lat: number, lon: number): void {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(PREFIX + sampleKey(lat, lon));
}
