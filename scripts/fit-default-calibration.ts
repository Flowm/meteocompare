// Fit the shipped default calibration (ADR 0010) and regenerate
// src/analysis/defaultCalibration.ts.
//
// Reuses the production pipeline byte-for-byte: gatherRuns (fetch single runs +
// ERA5 truth, concurrency-capped, failures skipped) → evaluateRun →
// calibrationPoints → fitCalibrationSet, pooled across a climatically diverse
// set of reference locations with run dates spread over the usable single-runs
// archive window (most models are archived only from 2 April 2026, so seasonal
// coverage grows as the archive deepens — regenerate periodically).
//
// Run with:  pnpm dlx tsx scripts/fit-default-calibration.ts
// (Node's global fetch; the api layer's localStorage guard makes it free-tier.)

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { calibrationPoints } from "@/analysis/calibrationSample";
import { gatherRuns, type RunRef } from "@/analysis/collectSample";
import type { RunEvaluation } from "@/analysis/runEvaluation";
import { ARCHIVE_START_MOST_MODELS } from "@/api/omSingleRuns";
import { fitCalibrationSet, type CalibrationSet } from "@/domain/calibration";
import { LEAD_BANDS } from "@/domain/scorecard";
import { VERIFIED_VARIABLES } from "@/domain/verification";
import { addDaysIso } from "@/utils/date";

/** Climatically diverse reference set: alpine, maritime, Mediterranean,
 *  Nordic, continental, monsoonal, equatorial, and southern-hemisphere
 *  members so no single regime dominates the pooled fit. */
const LOCATIONS = [
  { name: "Munich", latitude: 48.1374, longitude: 11.5755 },
  { name: "London", latitude: 51.5072, longitude: -0.1276 },
  { name: "Lisbon", latitude: 38.7223, longitude: -9.1393 },
  { name: "Oslo", latitude: 59.9139, longitude: 10.7522 },
  { name: "New York", latitude: 40.7128, longitude: -74.006 },
  { name: "Denver", latitude: 39.7392, longitude: -104.9903 },
  { name: "Seattle", latitude: 47.6062, longitude: -122.3321 },
  { name: "Tokyo", latitude: 35.6762, longitude: 139.6503 },
  { name: "Singapore", latitude: 1.3521, longitude: 103.8198 },
  { name: "Sydney", latitude: -33.8688, longitude: 151.2093 },
  { name: "São Paulo", latitude: -23.5505, longitude: -46.6333 },
  { name: "Cape Town", latitude: -33.9249, longitude: 18.4241 },
] as const;

/** Runs per location, spread evenly across the usable archive window. */
const RUNS_PER_LOCATION = 8;

/** Oldest usable run date: most models are archived only from 2 April 2026
 *  (ARCHIVE_START_MOST_MODELS). Reaching further back is possible for ECMWF
 *  alone, but ECMWF-only runs produce single-model aggregates whose raw scores
 *  are capped by the model-count factor — unrepresentative calibration points.
 *  The window (and its seasonal coverage) grows as the archive deepens;
 *  regenerate periodically. */
const ARCHIVE_START = ARCHIVE_START_MOST_MODELS;

/** Truth needs ERA5 to cover run+7d with its ~5-day lag; 14 is comfortably safe. */
const TRUTH_LAG_DAYS = 14;

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

/** RUNS_PER_LOCATION 00Z run dates, evenly spaced ARCHIVE_START → now−lag. */
function runDates(): string[] {
  const end = addDaysIso(isoToday(), -TRUTH_LAG_DAYS);
  const span = daysBetween(ARCHIVE_START, end);
  return Array.from({ length: RUNS_PER_LOCATION }, (_, i) => addDaysIso(ARCHIVE_START, Math.round((i * span) / (RUNS_PER_LOCATION - 1))));
}

function bandCounts(set: CalibrationSet): string {
  return VERIFIED_VARIABLES.map((v) => `${v}: [${set[v].bands.map((b) => b?.n ?? "-").join(", ")}]`).join("  ");
}

async function main(): Promise<void> {
  const dates = runDates();
  const refs: RunRef[] = dates.map((runDate) => ({ runDate, runHour: 0 }));
  console.log(`Reference run dates: ${dates.join(", ")}`);

  const allRuns: RunEvaluation[] = [];
  for (const location of LOCATIONS) {
    const t0 = Date.now();
    // eslint-disable-next-line no-await-in-loop -- sequential per location on purpose: polite to open-meteo's free tier.
    const runs = await gatherRuns(refs, { location, concurrency: 2 });
    allRuns.push(...runs);
    console.log(`${location.name.padEnd(12)} ${runs.length}/${refs.length} runs evaluated in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }

  const points = calibrationPoints(allRuns);
  const set = fitCalibrationSet(points, undefined, "builtin");
  const perVariable = Object.fromEntries(VERIFIED_VARIABLES.map((v) => [v, points.filter((p) => p.variable === v).length]));
  console.log(`\n${points.length} calibration points (${JSON.stringify(perVariable)})`);
  console.log(`Fitted bands (n per ${LEAD_BANDS.map((b) => b.label).join(" / ")}):  ${bandCounts(set)}`);

  for (const v of VERIFIED_VARIABLES) {
    if (set[v].bands.every((b) => b === null)) console.warn(`WARNING: no band cleared the data gate for ${v} — default tier will not cover it.`);
  }

  const meta = {
    generatedAt: new Date().toISOString(),
    locations: LOCATIONS.map((l) => l.name),
    runDates: dates,
    points: perVariable,
  };

  const outPath = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "analysis", "defaultCalibration.ts");
  writeFileSync(
    outPath,
    `// GENERATED by scripts/fit-default-calibration.ts — do not edit by hand.
// The shipped default calibration tier (ADR 0010): curves fitted offline from
// verification samples at global reference locations, slotted into the ladder
// below the device tiers. Regenerate with:
//   pnpm dlx tsx scripts/fit-default-calibration.ts

import type { CalibrationSet } from "@/domain/calibration";

export interface DefaultCalibrationMeta {
  generatedAt: string;
  locations: string[];
  runDates: string[];
  /** Calibration points consumed, per variable. */
  points: Record<string, number>;
}

export const DEFAULT_CALIBRATION_META: DefaultCalibrationMeta | null = ${JSON.stringify(meta, null, 2)};

export const DEFAULT_CALIBRATION: CalibrationSet | null = ${JSON.stringify(set, null, 2)};
`,
  );
  console.log(`\nWrote ${outPath}`);
}

await main();
