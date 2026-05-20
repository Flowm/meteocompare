import type { AggregatePoint } from "./aggregate";
import { severitySlug } from "./weatherCodes";
import type { Variable } from "./weighting";

const TOLERANCE: Record<Exclude<Variable, "weather_code" | "wind_direction_10m">, number> = {
  temperature_2m: 1.5, // °C
  precipitation: 1, // mm/h
  precipitation_probability: 15, // percentage points
  wind_speed_10m: 3, // km/h
  cloud_cover: 15, // percentage points
};

function typicalSpread(variable: Variable, leadHours: number): number {
  switch (variable) {
    case "temperature_2m": {
      // Empirical-ish ramp: 1°C @ short range, ~3.5°C beyond a week.
      if (leadHours <= 24) return 1;
      if (leadHours <= 72) return 1 + ((leadHours - 24) / 48) * 1;
      if (leadHours <= 168) return 2 + ((leadHours - 72) / 96) * 1.5;
      return 3.5;
    }
    case "precipitation":
      return leadHours <= 48 ? 1.5 : 2.5;
    case "precipitation_probability":
      return 25;
    case "wind_speed_10m":
      return leadHours <= 48 ? 4 : 7; // km/h
    case "wind_direction_10m":
      // Angular std-dev "typical" of 30° at short range, 70° at long range.
      return leadHours <= 48 ? 30 : 70;
    case "cloud_cover":
      return 25; // percentage points
    case "weather_code":
      return 1; // unused — confidence path is different
  }
}

function leadDecay(leadHours: number): number {
  if (leadHours <= 48) return 1;
  if (leadHours <= 72) return 1 - ((leadHours - 48) / 24) * 0.1; // 1.0 → 0.9
  if (leadHours <= 168) return 0.9 - ((leadHours - 72) / 96) * 0.3; // 0.9 → 0.6
  if (leadHours <= 240) return 0.6 - ((leadHours - 168) / 72) * 0.4; // 0.6 → 0.2
  return 0.2;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

export function confidenceFor(point: AggregatePoint, variable: Variable, leadHours: number): number {
  if (variable === "weather_code") {
    return weatherCodeConfidence(point, leadHours);
  }
  if (variable === "wind_direction_10m") {
    return windDirectionConfidence(point, leadHours);
  }
  const tol = TOLERANCE[variable];
  const mean = point.value;
  if (Number.isNaN(mean)) return 0;

  // Agreement: total weight whose values land within ±tol of the mean.
  let agreementW = 0;
  for (const [id, w] of Object.entries(point.weights)) {
    const v = point.perModel[id];
    if (v == null) continue;
    if (Math.abs(v - mean) <= tol) agreementW += w;
  }

  const spread = typicalSpread(variable, leadHours);
  const spreadScore = clamp01(1 - point.stdDev / spread);

  const raw = 0.6 * agreementW + 0.4 * spreadScore;
  return clamp01(raw * leadDecay(leadHours));
}

/** Smallest signed angular delta between two compass bearings, in [-180, 180]. */
function angDelta(a: number, b: number): number {
  let d = ((a - b + 540) % 360) - 180;
  return d;
}

function windDirectionConfidence(point: AggregatePoint, leadHours: number): number {
  const mean = point.value;
  if (Number.isNaN(mean)) return 0;
  const tolDeg = 30; // models within ±30° of mean count as "agreeing"
  let agreementW = 0;
  for (const [id, w] of Object.entries(point.weights)) {
    const v = point.perModel[id];
    if (v == null) continue;
    if (Math.abs(angDelta(v, mean)) <= tolDeg) agreementW += w;
  }
  const spread = typicalSpread("wind_direction_10m", leadHours);
  const spreadScore = clamp01(1 - point.stdDev / spread);
  const raw = 0.6 * agreementW + 0.4 * spreadScore;
  return clamp01(raw * leadDecay(leadHours));
}

function weatherCodeConfidence(point: AggregatePoint, leadHours: number): number {
  const aggSlug = severitySlug(point.value);
  let agreementW = 0;
  for (const [id, w] of Object.entries(point.weights)) {
    const v = point.perModel[id];
    if (v == null) continue;
    if (severitySlug(v) === aggSlug) agreementW += w;
  }
  return clamp01(agreementW * leadDecay(leadHours));
}

export function bandWidth(point: AggregatePoint, variable: Variable): number {
  if (variable === "weather_code") return 0;
  return point.stdDev;
}

export type ConfidenceTier = "high" | "mid" | "low";

export function confidenceTier(c: number): ConfidenceTier {
  if (c >= 0.7) return "high";
  if (c >= 0.4) return "mid";
  return "low";
}
