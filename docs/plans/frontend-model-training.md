# Plan: frontend-only model training (per-location weight tuning)

Status: **draft / decisions resolved** (not an ADR yet — Phase 4 becomes ADR-worthy when built).

## Goal

Close the verification loop **without leaving the browser**. Today the
verification ("analysis") page scores one location at one run date. We want to
(1) collect verification data for a single location across *many* runs, (2) show
how each model performs over that whole sample, and (3) use stored samples to
fine-tune the aggregate weighting per location — turning the fixed heuristic
weights into per-location, evidence-fed weights. This is the concrete first step
toward the "direction of travel" in ADR 0005, kept inside the frontend-only
constraint: training is **per-location, on-device, user-initiated**, not a
global server-side pipeline.

## What already helps us

The scoring domain is **already pure and decoupled from Vue**:

- `domain/aggregateVariables.ts` → aggregate + per-variable predictability from flat per-model arrays.
- `domain/verification.ts` `buildDailyVerification` → per-day bias/MAE/amount/timing.
- `domain/scorecard.ts` `buildModelScorecard` → per-model (+ aggregate) composite per lead-time band, **coverage-aware** (ADR 0004).
- `domain/weighting.ts` `normalizedWeights` → the only place weights are produced.
- `api/omSingleRuns.ts` `fetchSingleRuns({lat,lon,runDate})` and `api/omHistoricalWeather.ts` `fetchHistoricalWeather(...)` — both cached by the service worker (SWR); `fetchSingleRuns` already prunes models that have aged out of the archive.

The only Vue-coupled piece is `composables/useVerification.ts`, which wires one
run of fetch → domain → reactive refs. So most of Phase 1 is *moving* logic.

## Phases

### Phase 1 — Decouple analysis data from the UI

Extract a framework-free evaluation unit so the same computation feeds the
single-run view, the multi-run view, and the trainer.

- New `domain/analysis/runEvaluation.ts`: `interface RunEvaluation { location; run; perModel: ScorecardRow[]; aggregate: ScorecardRow; coverageByModel; … }` and `evaluateRun(runs, truth, location, run): RunEvaluation` — the body of `useVerification`'s computeds, with no `Ref`s.
- Refactor `useVerification` to fetch → `evaluateRun(...)`. Behaviour-preserving; existing tests stay green; UI unchanged.

Decision-free, low-risk — the dependency-free foundation.

### Phase 2 — Run-cycle selection on the single-run analysis page (early)

Drop the **00Z-only** assumption so a single run is identified by **date + cycle
hour**, not date alone.

- `SingleRunsRequest.runDate` (`YYYY-MM-DD`, hard-coded `T00:00`) → a run **datetime / cycle** (`run: YYYY-MM-DDTHH:00`); add a cycle picker (00 / 06 / 12 / 18 Z, bounded by what each model publishes) on the analysis page.
- Thread the cycle through state/URL (`runDate` → run datetime) and `baseTime` (lead-time math already keys off the first timestamp, so it follows for free).
- **Glossary impact (must update CONTEXT.md when this lands):** the **Run date** entry currently says "every run on the verification page is 00Z, so a date alone uniquely identifies one." That invariant goes away — run identity becomes (date, cycle). Revisit **Run**, **Run date**, and **Available models** then.

### Phase 3 — Multi-run analysis mode (gather + view + store)

A **mode switch on the analysis page** between *single-run* and *multi-run*
analysis (no separate route).

- **Sampling controls:** a **duration (days)** input, and a **single-run-per-day vs multiple-runs-per-day** toggle (multiple = use the available cycles per day from Phase 2).
- **Gather:** enumerate runs in the window, `fetchSingleRuns` + `fetchHistoricalWeather` + `evaluateRun` each, **concurrency-capped** (≈3–4) with progress + cancel, reusing the **SW cache** so overlapping windows are nearly free.
  - **Window bounds:** start ≥ `now − archive_retention` (per-model, drifting — coverage thins at the old end; `fetchSingleRuns` drops aged-out models); end ≤ `now − ~7–10 days` so ERA5 truth fully covers each run's forecast.
- **View** (Phase 4 content) renders from the gathered, in-memory sample.
- **Explicit "Store data" button** → persist the gathered sample to **IndexedDB** (keyed by gridded location), merging/accruing into any existing stored sample for that location. Nothing is persisted without the button; the gather itself is ephemeral (SW-cache backed).

### Phase 4 — Multi-run performance view

The content of the multi-run mode: **per-model performance across the whole
sample**, not one run.

- Per-model mean composite + per-lead-band means, **coverage-weighted** (only average runs where the model was present; show n).
- Distribution, not just mean (bias/MAE/amount/timing spread) so a usually-good-but-occasionally-terrible model is visible.
- Aggregate-vs-best-model and ranking stability across the sample.

### Phase 5 — Training (per-location weight fit)

A training **page** (its own route) fed by the **stored** IndexedDB samples.

- **What is fit:** a **per-model weight multiplier** (v1 — not per-lead-band) applied on top of the heuristic `modelWeight` (keeps lead-time decay / region bonus / variable boost intact).
- **Objective:** minimise aggregate error over the sample, mirroring the composite (temp MAE + precip amount + timing) by reusing `buildModelScorecard` — "what we train" == "what we score".
- **Method:** temp term alone is non-negative least squares (convex); the blended objective is non-convex → gradient-free optimiser (coordinate descent / Nelder–Mead) over ~21 multipliers, in-browser on the cached sample.
- **Anti-overfitting (load-bearing):** train/validation split by run; **shrinkage toward 1.0** (the heuristic); a **minimum-sample guard**; surface the train-vs-val improvement honestly.
- **Persist** accepted multipliers in localStorage keyed by gridded location.
- **Apply:** a **toggle in user settings** — "use stored (trained) weights" — switches the live aggregate from the default heuristic weights to stored per-location weights where available (falling back to the heuristic otherwise). Heuristic stays the default and the fallback. Implementation: `normalizedWeights` gains optional per-model overrides loaded for the current location when the setting is on.

This phase is **ADR-worthy when built** (hard to reverse, surprising, real trade-offs: per-location overfitting vs global robustness).

## Data-model sketch

```
RunEvaluation   // one (location, run = date + cycle)
  location, run                 // run carries cycle hour, not just date
  perModel: ScorecardRow[]
  aggregate: ScorecardRow
  coverageByModel: Record<id, hours>

LocationSample  // one location, many runs — persisted in IndexedDB on "Store data"
  location, runs: RunEvaluation[], gatheredAt

LearnedWeights  // localStorage, per gridded location; used when the settings toggle is on
  location, multipliers: Record<modelId, number>, trainedAt, validationDelta
```

## Resolved decisions

1. **Surface:** multi-run analysis is a **mode toggle on the analysis page** (single-run ⇄ multi-run), not a new route. An explicit **"Store data"** button persists the gathered sample for training. Training is its **own page (route)**, fed by stored data.
2. **Sample definition:** a **duration (days)** input; **non-00Z run-cycle selection** added to the single-run page in an early phase (Phase 2); the multi-run view offers **single-run-per-day vs multiple-runs-per-day**.
3. **Persistence:** **IndexedDB**, written by the explicit "Store data" button.
4. **What gets fit:** **per-model multiplier only** for now.
5. **Applying weights:** a **user-settings toggle** to switch the live aggregate from default heuristic weights to stored (trained) weights.

## Risks / constraints

- **Archive retention** caps the window and thins old-end coverage; sampling, the Phase 4 aggregation, and the Phase 5 fit must all be coverage-aware.
- **API volume / politeness:** many runs × many models. Concurrency cap, reuse SW cache, make gather resumable/incremental.
- **Truth latency:** ERA5 lags ~5 days; exclude runs whose forecast window isn't fully covered yet.
- **Overfitting** is the central scientific risk (small per-location samples) → split + shrinkage + min-sample + honest validation reporting.
- **Storage growth:** cap/evict oldest runs per location in IndexedDB.

## Relationship to existing decisions

- Realises the ADR 0005 "direction of travel" (closed, verification-fed loop) **frontend-only**.
- A learned per-location weighting is the **bias-correction / dynamic-weighting** the README lists as a current limitation and ADR 0006 defers.
- Phase 2 changes the 00Z-only **Run date** invariant in CONTEXT.md — update the glossary when it lands.
