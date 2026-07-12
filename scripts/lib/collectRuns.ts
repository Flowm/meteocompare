// One tool for local run collection + caching, shared by the three offline
// fitting scripts. Wraps the production gatherRuns (fetch single runs + ERA5
// truth, concurrency-capped, failures skipped) with an on-disk cache so repeated
// regenerations — and the three scripts between them — never re-fetch a run.
//
// The cache is keyed by (location, runDate, runHour) and stores a RunEvaluation
// (or an explicit `null` marker for a ref that yielded nothing). A cached run is
// fetched with the same TRAINING_FORECAST_DAYS horizon regardless of caller, so
// every script consumes an identical object — which is why they can, and do,
// share one cache directory.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { gatherRuns, type RunRef } from "@/analysis/collectSample";
import type { RunEvaluation } from "@/analysis/runEvaluation";
import { ARCHIVE_START_MOST_MODELS } from "@/api/omSingleRuns";
import { addDaysIso, daysBetweenIso } from "@/utils/date";

import type { RefLocation } from "./referenceLocations";

/** Oldest usable run date: most models are archived only from 2 April 2026
 *  (ARCHIVE_START_MOST_MODELS). Reaching further back is possible for ECMWF
 *  alone, but ECMWF-only runs produce single-model aggregates whose raw scores
 *  are capped by the model-count factor — unrepresentative points. The window
 *  (and its seasonal coverage) grows as the archive deepens; regenerate
 *  periodically. */
export const ARCHIVE_START = ARCHIVE_START_MOST_MODELS;

/** Politeness cap for the free-tier gather (sequential per location). */
export const DEFAULT_CONCURRENCY = 2;

/** Shared cache root. All three scripts default here so a run fetched by one is
 *  reused by the others (they only differ in how many run dates they sample). */
const DEFAULT_CACHE_DIR = join(tmpdir(), "meteocompare-runs-cache");

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

/** `count` 00Z run dates, evenly spaced ARCHIVE_START → today − `truthLagDays`
 *  (the newest run old enough for its full forecast window to have ERA5 truth). */
export function runDates(count: number, truthLagDays: number): string[] {
  const end = addDaysIso(isoToday(), -truthLagDays);
  const span = daysBetweenIso(ARCHIVE_START, end);
  return Array.from({ length: count }, (_, i) => addDaysIso(ARCHIVE_START, Math.round((i * span) / (count - 1))));
}

/** Resolve the cache directory from `--cache-dir <path>` / `--cache-dir=<path>`,
 *  falling back to the shared default so regenerations accumulate one cache. */
export function cacheDirFromArgv(argv: readonly string[] = process.argv.slice(2)): string {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--cache-dir") return argv[i + 1] ?? DEFAULT_CACHE_DIR;
    if (a?.startsWith("--cache-dir=")) return a.slice("--cache-dir=".length);
  }
  return DEFAULT_CACHE_DIR;
}

const slug = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

function cachePath(cacheDir: string, loc: RefLocation, ref: RunRef): string {
  return join(cacheDir, `${slug(loc.name)}__${ref.runDate}__${String(ref.runHour).padStart(2, "0")}.json`);
}

export interface GatherCachedOptions {
  cacheDir: string;
  /** Max concurrent fetches; defaults to DEFAULT_CONCURRENCY (polite to the free tier). */
  concurrency?: number;
}

/** Cache-backed gather: cached refs are read from disk, misses are fetched via
 *  gatherRuns and written back (a ref that yielded nothing is cached as an
 *  explicit `null`, so a partial cache tops itself up and never re-fetches a
 *  known gap). Returns the successful evaluations; order is not guaranteed. */
export async function gatherCached(loc: RefLocation, refs: readonly RunRef[], opts: GatherCachedOptions): Promise<RunEvaluation[]> {
  const { cacheDir, concurrency = DEFAULT_CONCURRENCY } = opts;
  const out: RunEvaluation[] = [];
  const missing: RunRef[] = [];
  for (const ref of refs) {
    const p = cachePath(cacheDir, loc, ref);
    if (existsSync(p)) {
      const data = JSON.parse(readFileSync(p, "utf8")) as RunEvaluation | null;
      if (data) out.push(data);
    } else {
      missing.push(ref);
    }
  }
  if (missing.length > 0) {
    mkdirSync(cacheDir, { recursive: true });
    // Newest-first: matches gatherRuns' retention-window memo (planRuns' order).
    const ordered = missing.toSorted((a, b) => b.runDate.localeCompare(a.runDate));
    const fetched = await gatherRuns(ordered, { location: { latitude: loc.latitude, longitude: loc.longitude }, concurrency });
    const byKey = new Map(fetched.map((e) => [`${e.runDate}:${e.runHour}`, e]));
    for (const ref of missing) {
      const e = byKey.get(`${ref.runDate}:${ref.runHour}`);
      writeFileSync(cachePath(cacheDir, loc, ref), JSON.stringify(e ?? null));
      if (e) out.push(e);
    }
  }
  return out;
}
