// Device-pooled calibration persistence (ADR 0008). Per-location curves live
// inside StoredWeights (learnedWeightsStore) and inherit its reach semantics;
// this module owns the pooled tier — one curve set fitted from every stored
// sample on the device — plus the refit that keeps it current after each
// training save. Payloads are a handful of numbers per band, so localStorage.

import { fitCalibrationSet, type CalibrationSet } from "@/domain/calibration";
import { LEAD_BANDS } from "@/domain/scorecard";
import { VERIFIED_VARIABLES } from "@/domain/verification";

import { calibrationPoints } from "./calibrationSample";
import { DEFAULT_CALIBRATION } from "./defaultCalibration";
import { createLocalKeyedStore } from "./keyedStore";
import { loadWeights } from "./learnedWeightsStore";
import { listSamples } from "./sampleStore";

const PREFIX = "meteocompare:calibration:";
const POOLED_KEY = "pooled";

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

/** Resolve the calibration ladder for a location (ADR 0008 + 0010), merged per
 *  (variable, lead band): the location's own stored curves win (exact cell or
 *  in-reach, via the weights entry they ride on), then the device-pooled tier,
 *  then the shipped built-in default; a fully absent result is null — every
 *  band then resolves to the raw-heuristic identity in `applyCalibration`. */
export function resolveCalibration(lat: number, lon: number): CalibrationSet | null {
  const tiers = [loadWeights(lat, lon)?.calibration ?? null, loadPooledCalibration()?.set ?? null, DEFAULT_CALIBRATION].filter((t): t is CalibrationSet => t !== null);
  if (tiers.length === 0) return null;
  const first = tiers[0];
  if (tiers.length === 1 && first) return first;
  const merged = {} as CalibrationSet;
  for (const v of VERIFIED_VARIABLES) {
    merged[v] = { bands: LEAD_BANDS.map((_, i) => tiers.map((t) => t[v]?.bands[i]).find((b) => b != null) ?? null) };
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
