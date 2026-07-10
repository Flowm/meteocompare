// Device-pooled calibration persistence (ADR 0008). Per-location curves live
// inside StoredWeights (learnedWeightsStore) and inherit its reach semantics;
// this module owns the pooled tier — one curve set fitted from every stored
// sample on the device — plus the refit that keeps it current after each
// training save. Payloads are a handful of numbers per band, so localStorage.

import { fitCalibrationSet, type CalibrationSet } from "@/domain/calibration";
import { LEAD_BANDS } from "@/domain/scorecard";
import { VERIFIED_VARIABLES } from "@/domain/verification";

import { calibrationPoints } from "./calibrationSample";
import { createLocalKeyedStore } from "./keyedStore";
import { loadWeights } from "./learnedWeightsStore";
import { listSamples } from "./sampleStore";

const PREFIX = "meteocompare:calibration:";
const POOLED_KEY = "pooled";

/** Record schema version (envelope via keyedStore). */
const CALIBRATION_VERSION = 1;

export interface StoredCalibration {
  set: CalibrationSet;
  /** ISO timestamp of the fit — passed in by the caller (no clock reads here). */
  fittedAt: string;
}

const store = createLocalKeyedStore<StoredCalibration>({ prefix: PREFIX, version: CALIBRATION_VERSION });

export function loadPooledCalibration(): StoredCalibration | null {
  return store.get(POOLED_KEY);
}

export function savePooledCalibration(stored: StoredCalibration): void {
  store.set(POOLED_KEY, stored);
}

export function clearPooledCalibration(): void {
  store.remove(POOLED_KEY);
}

/** Resolve the calibration ladder for a location (ADR 0008), merged per
 *  (variable, lead band): the location's own stored curves win (exact cell or
 *  in-reach, via the weights entry they ride on), bands they leave null fall to
 *  the pooled tier, and a fully absent result is null — every band then
 *  resolves to the raw-heuristic identity in `applyCalibration`. */
export function resolveCalibration(lat: number, lon: number): CalibrationSet | null {
  const local = loadWeights(lat, lon)?.calibration ?? null;
  const pooled = loadPooledCalibration()?.set ?? null;
  if (!local || !pooled) return local ?? pooled;
  const merged = {} as CalibrationSet;
  for (const v of VERIFIED_VARIABLES) {
    merged[v] = { bands: LEAD_BANDS.map((_, i) => local[v]?.bands[i] ?? pooled[v]?.bands[i] ?? null) };
  }
  return merged;
}

/** Refit the pooled tier from every stored sample on the device. Async
 *  (IndexedDB read); training saves fire-and-forget it. Leaves the previous
 *  pooled fit untouched when storage is unavailable or the read fails. */
export async function refitPooledCalibration(fittedAt: string): Promise<void> {
  let points;
  try {
    const samples = await listSamples();
    points = calibrationPoints(samples.flatMap((s) => s.runs));
  } catch {
    return; // IndexedDB unavailable/broken — keep whatever pooled fit exists.
  }
  savePooledCalibration({ set: fitCalibrationSet(points), fittedAt });
}
