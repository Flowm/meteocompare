// Fit the shipped default weight ladder (ADR 0011) and regenerate
// src/analysis/defaultWeights.ts — the weights sibling of
// scripts/fit-default-calibration.ts.
//
// Reuses the production pipeline byte-for-byte: gatherRuns (fetch single runs +
// ERA5 truth at forecast_days: 10, concurrency-capped, failures skipped) →
// buildPanels → fitBuiltinSet, pooled across the ADR-0010 reference locations
// with run dates spread over the usable single-runs archive window. The builtin
// tier is fitted on ALL 12 locations pooled (the shipped fit; the experiment's
// leave-one-location-out arm was the adoption evidence, not the shipped weights —
// docs/research/weight-ladder-experiment.md). Most models are archived only from
// 2 April 2026, so seasonal coverage grows as the archive deepens — regenerate
// periodically.
//
// Run with:  pnpm dlx tsx scripts/fit-default-weights.ts [--cache-dir <path>]
//   --cache-dir : reuse a directory of cached RunEvaluation JSON (one file per
//                 location×run, `null` marks a ref that yielded nothing) instead
//                 of re-fetching. A cache miss falls back to gatherRuns and
//                 writes the result, so a partial cache tops itself up.
// (Node's global fetch; the api layer's localStorage guard makes it free-tier.)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildPanels, fitBuiltinSet, MULT_MAX, MULT_MIN, type RunPanel } from "@/analysis/bandWeights";
import { gatherRuns, type RunRef } from "@/analysis/collectSample";
import type { RunEvaluation } from "@/analysis/runEvaluation";
import { ARCHIVE_START_MOST_MODELS } from "@/api/omSingleRuns";
import type { ModelKind } from "@/domain/models";
import { LEAD_BANDS } from "@/domain/scorecard";
import type { BuiltinWeightSet } from "@/domain/weightLadder";
import { addDaysIso } from "@/utils/date";

/** Climatically diverse reference set, verbatim from fit-default-calibration.ts. */
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

/** Runs per location, spread evenly across the usable archive window. Matches the
 *  experiment (WP3) so its cache is reused verbatim. */
const RUNS_PER_LOCATION = 24;

/** Oldest usable run date — see fit-default-calibration.ts for the ECMWF-only
 *  caveat; ARCHIVE_START_MOST_MODELS is the single-runs retention floor. */
const ARCHIVE_START = ARCHIVE_START_MOST_MODELS;

/** Newest usable run: today − (10 forecast days + ~5-day ERA5 lag + 1 margin) so
 *  band 4 (168–240 h) has truth. Matches the WP3 experiment's TRUTH_LAG_DAYS. */
const TRUTH_LAG_DAYS = 16;

/** Politeness cap for the free-tier gather (sequential per location). */
const CONCURRENCY = 2;

/** Model classes, in the About page's display order — the per-class sanity rows. */
const CLASS_ORDER: ModelKind[] = ["global", "regional-mid", "regional-cam", "ai", "ensemble-mean"];

/** Cache-dir CLI flag (`--cache-dir <path>` or `--cache-dir=<path>`); defaults to
 *  a stable temp location so future regenerations accumulate their own cache. */
function cacheDirArg(): string {
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--cache-dir") return argv[i + 1] ?? "";
    if (a?.startsWith("--cache-dir=")) return a.slice("--cache-dir=".length);
  }
  return join(tmpdir(), "meteocompare-default-weights-cache");
}

const CACHE_DIR = cacheDirArg();

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

/** RUNS_PER_LOCATION 00Z run dates, evenly spaced ARCHIVE_START → today − lag. */
function runDates(): string[] {
  const end = addDaysIso(isoToday(), -TRUTH_LAG_DAYS);
  const span = daysBetween(ARCHIVE_START, end);
  return Array.from({ length: RUNS_PER_LOCATION }, (_, i) => addDaysIso(ARCHIVE_START, Math.round((i * span) / (RUNS_PER_LOCATION - 1))));
}

const slug = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

interface Loc {
  name: string;
  latitude: number;
  longitude: number;
}

function cachePath(loc: Loc, ref: RunRef): string {
  return join(CACHE_DIR, `${slug(loc.name)}__${ref.runDate}__${String(ref.runHour).padStart(2, "0")}.json`);
}

/** Cache-backed gather (same protocol as run-weight-experiment.ts): a returned
 *  run is cached, a ref that yielded nothing is cached as an explicit null. */
async function gatherCached(loc: Loc, refs: readonly RunRef[]): Promise<RunEvaluation[]> {
  const out: RunEvaluation[] = [];
  const missing: RunRef[] = [];
  for (const ref of refs) {
    const p = cachePath(loc, ref);
    if (existsSync(p)) {
      const data = JSON.parse(readFileSync(p, "utf8")) as RunEvaluation | null;
      if (data) out.push(data);
    } else {
      missing.push(ref);
    }
  }
  if (missing.length > 0) {
    // Newest-first: matches gatherRuns' retention-window memo (planRuns' order).
    const ordered = missing.toSorted((a, b) => b.runDate.localeCompare(a.runDate));
    const fetched = await gatherRuns(ordered, { location: { latitude: loc.latitude, longitude: loc.longitude }, concurrency: CONCURRENCY });
    const byKey = new Map(fetched.map((e) => [`${e.runDate}:${e.runHour}`, e]));
    for (const ref of missing) {
      const e = byKey.get(`${ref.runDate}:${ref.runHour}`);
      writeFileSync(cachePath(loc, ref), JSON.stringify(e ?? null));
      if (e) out.push(e);
    }
  }
  return out;
}

/** One-line sanity summary: fitted-vs-null band count and the value range, so a
 *  regeneration's output can be eyeballed before it ships. */
function summariseModels(set: BuiltinWeightSet): { fitted: number; nulled: number; min: number; max: number } {
  let fitted = 0;
  let nulled = 0;
  let min = Infinity;
  let max = -Infinity;
  for (const slots of Object.values(set.perModel)) {
    for (const s of slots) {
      if (s == null) {
        nulled += 1;
      } else {
        fitted += 1;
        min = Math.min(min, s);
        max = Math.max(max, s);
      }
    }
  }
  return { fitted, nulled, min, max };
}

function classLine(set: BuiltinWeightSet, kind: ModelKind): string {
  const slots = set.perClass[kind];
  const body = slots ? slots.map((s) => (s == null ? "—" : s.toFixed(3))).join(", ") : "(none)";
  return `${kind.padEnd(14)} [${body}]`;
}

async function main(): Promise<void> {
  const dates = runDates();
  const refs: RunRef[] = dates.map((runDate) => ({ runDate, runHour: 0 }));
  mkdirSync(CACHE_DIR, { recursive: true });
  console.log(`Cache dir: ${CACHE_DIR}`);
  console.log(`Reference run dates (${dates.length}): ${dates[0]} … ${dates[dates.length - 1]}`);

  const panelsByLocation: RunPanel[][] = [];
  const usedNames: string[] = [];
  for (const location of LOCATIONS) {
    const t0 = Date.now();
    // eslint-disable-next-line no-await-in-loop -- sequential per location on purpose: polite to open-meteo's free tier.
    const runs = await gatherCached(location, refs);
    if (runs.length === 0) {
      console.warn(`${location.name.padEnd(12)} 0 runs — skipped.`);
      continue;
    }
    panelsByLocation.push(buildPanels({ runs, lat: location.latitude, lon: location.longitude }));
    usedNames.push(location.name);
    console.log(`${location.name.padEnd(12)} ${String(runs.length).padStart(2)}/${refs.length} runs in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }

  const meta = {
    generatedAt: new Date().toISOString(),
    locations: usedNames,
    runDates: dates,
    bands: [...LEAD_BANDS],
  };

  const t0 = Date.now();
  const set = fitBuiltinSet(panelsByLocation, { bands: LEAD_BANDS, meta });
  console.log(`\nFitted builtin set in ${((Date.now() - t0) / 1000).toFixed(0)}s across ${panelsByLocation.length} locations.`);

  // Sanity report.
  const s = summariseModels(set);
  const bandLabels = LEAD_BANDS.map((b) => b.label).join(", ");
  console.log(`\nPer-model bands: ${s.fitted} fitted, ${s.nulled} null (gate/validation fallthrough).`);
  console.log(`Per-model fitted range: [${s.min.toFixed(3)}, ${s.max.toFixed(3)}]  (grid bounds [${MULT_MIN}, ${MULT_MAX}])`);
  console.log(`\nPer-class multipliers per band (${bandLabels}):`);
  for (const kind of CLASS_ORDER) console.log(`  ${classLine(set, kind)}`);

  if (s.fitted > 0 && (s.min < MULT_MIN - 1e-9 || s.max > MULT_MAX + 1e-9)) console.warn("WARNING: a fitted multiplier fell outside the grid bounds — check the fit.");
  if (Object.keys(set.perModel).length === 0) console.warn("WARNING: no per-model slots fitted — default tier would be class-only.");

  const outPath = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "analysis", "defaultWeights.ts");
  writeFileSync(
    outPath,
    `// GENERATED by scripts/fit-default-weights.ts — do not edit by hand.
// The shipped default weight tier (ADR 0011): per-model, per-lead-band weight
// multipliers fitted offline from verification runs at global reference
// locations, pooled across all of them. This is the app's lead-time weighting —
// it REPLACED the old hand-tuned per-class decay curves — resolved by
// weightLadder.resolveMultiplier (per-model → per-class → 1, each band
// independently). Regenerate with:
//   pnpm dlx tsx scripts/fit-default-weights.ts

import type { BuiltinWeightMeta, BuiltinWeightSet } from "@/domain/weightLadder";

export const DEFAULT_WEIGHTS_META: BuiltinWeightMeta | null = ${JSON.stringify(meta, null, 2)};

export const DEFAULT_WEIGHTS: BuiltinWeightSet | null = ${JSON.stringify(set, null, 2)};
`,
  );
  console.log(`\nWrote ${outPath}`);
}

await main();
