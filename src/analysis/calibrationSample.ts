// Extraction of calibration points from a location's stored runs (ADR 0008) —
// the bridge between what sampleStore persists and the pure fit in
// domain/calibration.ts. Reads the DEFAULT-weight daily surfaces only: they are
// present in every stored run, and the curve must be fit on one consistent
// weighting (the monotone map tolerates the small raw-score shift when trained
// weights are active — a recorded second-order acceptance).

import { TEMP_HIT_TOLERANCE_C, WET_DAY_THRESHOLD_MM, type CalibrationPoint } from "@/domain/calibration";
import type { DailyVerification } from "@/domain/verification";

import type { RunEvaluation } from "./runEvaluation";

/** A day's lead anchor: the midpoint of its lead-hour window — the same noon
 *  anchor the daily forecast cadence uses. */
const leadAnchor = (day: DailyVerification): number => (day.leadHoursStart + day.leadHoursEnd) / 2;

/** Every verified (raw, hit) day outcome contained in the runs. Days whose raw
 *  score or outcome inputs are non-finite (no data) are skipped, not counted. */
export function calibrationPoints(runs: readonly RunEvaluation[]): CalibrationPoint[] {
  const points: CalibrationPoint[] = [];
  for (const run of runs) {
    for (const day of run.daily) {
      const leadHours = leadAnchor(day);

      const t = day.aggregate.temperature;
      if (t && Number.isFinite(t.predictability) && Number.isFinite(t.forecastMax) && Number.isFinite(t.truthMax)) {
        points.push({ variable: "temperature_2m", leadHours, raw: t.predictability, hit: Math.abs(t.forecastMax - t.truthMax) <= TEMP_HIT_TOLERANCE_C });
      }

      const p = day.aggregate.precipitation;
      if (p && Number.isFinite(p.predictability) && Number.isFinite(p.forecastSum) && Number.isFinite(p.truthSum)) {
        const forecastWet = p.forecastSum >= WET_DAY_THRESHOLD_MM;
        const truthWet = p.truthSum >= WET_DAY_THRESHOLD_MM;
        points.push({ variable: "precipitation", leadHours, raw: p.predictability, hit: forecastWet === truthWet });
      }
    }
  }
  return points;
}
