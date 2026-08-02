// Fit the shipped default weight ladder (ADR 0011) and regenerate
// src/analysis/defaultWeights.ts — the weights sibling of
// scripts/fit-default-calibration.ts.
//
// Reuses the production pipeline byte-for-byte — gatherCached (at
// forecast_days: 10) → buildPanels → fitBuiltinSet — with run dates spread over
// the usable archive window. The builtin tier is fitted on ALL 12 reference
// locations pooled; the experiment's leave-one-location-out arm was the adoption
// evidence, not the shipped weights (docs/research/weight-ladder-experiment.md).
// Most models are archived only from 2 April 2026, so seasonal coverage grows as
// the archive deepens: regenerate periodically.
//
// Run with:  pnpm dlx tsx scripts/fit-default-weights.ts [--cache-dir <path>]
//   --cache-dir : reuse (and top up) a directory of cached RunEvaluation JSON
//                 instead of re-fetching; defaults to the shared cache the
//                 experiment fills (see scripts/lib/collectRuns). The experiment
//                 samples the same 24 × 00Z dates, so its cache is reused verbatim.
// (Node's global fetch; the api layer's localStorage guard makes it free-tier.)

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildPanels, fitBuiltinSet, MULT_MAX, MULT_MIN, type RunPanel } from "@/analysis/bandWeights";
import type { RunRef } from "@/analysis/collectSample";
import type { ModelKind } from "@/domain/models";
import { LEAD_BANDS } from "@/domain/scorecard";
import type { BuiltinWeightSet } from "@/domain/weightLadder";

import { cacheDirFromArgv, gatherCached, runDates } from "./lib/collectRuns";
import { REFERENCE_LOCATIONS } from "./lib/referenceLocations";

/** Runs per location, spread evenly across the usable archive window. Matches the
 *  experiment (WP3) so its cache is reused verbatim. */
const RUNS_PER_LOCATION = 24;

/** Newest usable run: today − (10 forecast days + ~5-day ERA5 lag + 1 margin) so
 *  band 4 (168–240 h) has truth. Matches the WP3 experiment's TRUTH_LAG_DAYS. */
const TRUTH_LAG_DAYS = 16;

/** Model classes, in the About page's display order — the per-class sanity rows. */
const CLASS_ORDER: ModelKind[] = ["global", "regional-mid", "regional-cam", "ai", "ensemble-mean"];

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
  const cacheDir = cacheDirFromArgv();
  const dates = runDates(RUNS_PER_LOCATION, TRUTH_LAG_DAYS);
  const refs: RunRef[] = dates.map((runDate) => ({ runDate, runHour: 0 }));
  console.log(`Cache dir: ${cacheDir}`);
  console.log(`Reference run dates (${dates.length}): ${dates[0]} … ${dates[dates.length - 1]}`);

  const panelsByLocation: RunPanel[][] = [];
  const usedNames: string[] = [];
  for (const location of REFERENCE_LOCATIONS) {
    const t0 = Date.now();
    // eslint-disable-next-line no-await-in-loop -- sequential per location on purpose: polite to open-meteo's free tier.
    const runs = await gatherCached(location, refs, { cacheDir });
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
