# ADR 0011 — fitted weight-ladder experiment results

_Generated 2026-07-12T02:58:27.843Z by `scripts/run-weight-experiment.ts`._

## Protocol

Work package 3 of [ADR 0011](../adr/0011-fitted-weight-ladder.md): the pre-registered
offline experiment that gates adopting the fitted weight ladder over the hand-tuned
lead-time decay.

- **Locations:** 12 ADR-0010 reference points — Munich, London, Lisbon, Oslo, New York, Denver, Seattle, Tokyo, Singapore, Sydney, São Paulo, Cape Town.
- **Runs:** 24 × 00Z per location, evenly spaced 2026-04-02 → 2026-06-26 (archive floor 2026-04-02, newest = today − 16 d so band-4 truth exists), `forecast_days: 10`.
- **Truth:** ERA5-Seamless via the historical-weather API.
- **Metric:** mean `scoreScope` composite (temperature_2m + precipitation, the fitting
  machinery's own aggregation) across a location's evaluated runs. Higher is better (0–100).
- **Arms:**
  - **Arm 0 (incumbent):** aggregate under production `modelWeight` (hand-tuned decay), no multipliers.
  - **Arm 1 (new default):** `ladderModelWeight` with a builtin set fitted **leave-one-location-out** (for each L, fit on the other 11, evaluate on all of L's runs).
  - **Arm 2 (device tier):** per L, oldest 30% -complement train / newest val split (min 3 val, min 8 train — learnedWeights constants); device residuals fitted on train with L's LOLO builtin baked in, evaluated builtin+device vs builtin-only on val.
  - **Ablation A:** arm 1 with a 10-band per-day builtin partition.
  - **Ablation B (falsification):** arm 2 with per-day device bands only.
  - **Ablation C:** arm 1 resolving the per-class tier only (perModel emptied).

```
Pre-registered decision rule (ADR 0011, verbatim):
  - Adopt the new default (arm 1) iff arm 1 beats arm 0 at the median
    per-location composite AND in >= 8 of 12 locations.
  - Ship the device tier (arm 2) iff arm 2 additionally beats arm 1
    (on val runs) at the median AND in >= 8 of 12 locations.
  - Ablations (A per-day builtin, B per-day device, C class-only builtin)
    are informational only.
```

## Data actually gathered

| Location  | Runs | Median max lead | Band-4 scorable runs | ~Band-4 models |
| --------- | ---: | --------------: | -------------------: | -------------: |
| Munich    |   24 |           239 h |                24/24 |            7.2 |
| London    |   24 |           239 h |                24/24 |            7.0 |
| Lisbon    |   24 |           239 h |                24/24 |            7.3 |
| Oslo      |   23 |           239 h |                23/23 |            7.6 |
| New York  |   24 |           239 h |                24/24 |            7.3 |
| Denver    |   24 |           239 h |                24/24 |            7.2 |
| Seattle   |   24 |           239 h |                24/24 |            7.3 |
| Tokyo     |   24 |           239 h |                24/24 |            7.2 |
| Singapore |   20 |           239 h |                20/20 |            7.3 |
| Sydney    |   24 |           239 h |                24/24 |            7.3 |
| São Paulo |   24 |           239 h |                24/24 |            7.3 |
| Cape Town |   24 |           239 h |                24/24 |            7.3 |

Band-4 = the "7–10d" band (168–240 h); only long-range models (globals, AI,
ensemble-mean) reach it, so its per-run model count is structurally low.

## Verdicts

- **Adopt new default (arm 1)?** **YES** — median composite 65.87 → 67.09 (median Δ +1.71), wins 11/12 (needs median gain AND ≥ 8/12).
- **Ship device tier (arm 2)?** **NO** — on val runs median 65.92 → 65.71 (median Δ +0.21), wins 7/12 (needs adoption to pass first, plus median gain AND ≥ 8/12).

## Arm 1 vs arm 0 (per location)

| Location  | Arm 0 (incumbent) | Arm 1 (new default) | Δ (arm1−arm0) | Arm 1 wins? |
| --------- | ----------------: | ------------------: | ------------: | :---------: |
| Munich    |             61.82 |               63.63 |         +1.81 |      ✓      |
| London    |             59.72 |               60.92 |         +1.20 |      ✓      |
| Lisbon    |             67.42 |               69.61 |         +2.20 |      ✓      |
| Oslo      |             66.35 |               68.22 |         +1.87 |      ✓      |
| New York  |             58.95 |               59.01 |         +0.06 |      ✓      |
| Denver    |             56.52 |               59.13 |         +2.61 |      ✓      |
| Seattle   |             65.38 |               66.99 |         +1.61 |      ✓      |
| Tokyo     |             59.08 |               60.95 |         +1.87 |      ✓      |
| Singapore |             67.51 |               70.40 |         +2.89 |      ✓      |
| Sydney    |             68.32 |               67.31 |         -1.01 |      ·      |
| São Paulo |             67.07 |               67.19 |         +0.12 |      ✓      |
| Cape Town |             67.16 |               68.18 |         +1.02 |      ✓      |

## Arm 2 (device) vs builtin-only, held-out val runs

| Location  | nTrain/nVal | Builtin-only (val) | Arm 2 +device (val) |     Δ | Device wins? |
| --------- | ----------: | -----------------: | ------------------: | ----: | :----------: |
| Munich    |        17/7 |              61.16 |               61.75 | +0.59 |      ✓       |
| London    |        17/7 |              62.57 |               62.54 | -0.02 |      ·       |
| Lisbon    |        17/7 |              65.95 |               67.33 | +1.38 |      ✓       |
| Oslo      |        16/7 |              65.89 |               65.50 | -0.39 |      ·       |
| New York  |        17/7 |              57.36 |               57.26 | -0.10 |      ·       |
| Denver    |        17/7 |              54.02 |               55.77 | +1.75 |      ✓       |
| Seattle   |        17/7 |              68.16 |               68.60 | +0.43 |      ✓       |
| Tokyo     |        17/7 |              62.33 |               62.51 | +0.18 |      ✓       |
| Singapore |        14/6 |              75.07 |               75.32 | +0.25 |      ✓       |
| Sydney    |        17/7 |              67.22 |               67.46 | +0.25 |      ✓       |
| São Paulo |        17/7 |              66.28 |               65.93 | -0.35 |      ·       |
| Cape Town |        17/7 |              68.13 |               68.04 | -0.09 |      ·       |

## Ablations (informational)

### A — per-day builtin bands vs arm 1's 4 bands

| Location  | Arm 1 (4-band builtin) | Ablation A (per-day builtin) | Δ (A−arm1) |
| --------- | ---------------------: | ---------------------------: | ---------: |
| Munich    |                  63.63 |                        63.70 |      +0.07 |
| London    |                  60.92 |                        60.81 |      -0.11 |
| Lisbon    |                  69.61 |                        70.44 |      +0.82 |
| Oslo      |                  68.22 |                        67.80 |      -0.43 |
| New York  |                  59.01 |                        59.40 |      +0.38 |
| Denver    |                  59.13 |                        58.91 |      -0.22 |
| Seattle   |                  66.99 |                        66.89 |      -0.10 |
| Tokyo     |                  60.95 |                        60.93 |      -0.02 |
| Singapore |                  70.40 |                        70.19 |      -0.20 |
| Sydney    |                  67.31 |                        67.55 |      +0.24 |
| São Paulo |                  67.19 |                        67.27 |      +0.09 |
| Cape Town |                  68.18 |                        68.04 |      -0.15 |

### B — per-day device bands vs arm 2's 4 bands (falsification arm)

| Location  | Arm 2 +device (4-band) | Ablation B (per-day device) | Δ (B−arm2) |
| --------- | ---------------------: | --------------------------: | ---------: |
| Munich    |                  61.75 |                       61.65 |      -0.10 |
| London    |                  62.54 |                       61.56 |      -0.99 |
| Lisbon    |                  67.33 |                       67.38 |      +0.05 |
| Oslo      |                  65.50 |                       66.33 |      +0.83 |
| New York  |                  57.26 |                       57.69 |      +0.44 |
| Denver    |                  55.77 |                       55.37 |      -0.40 |
| Seattle   |                  68.60 |                       67.61 |      -0.99 |
| Tokyo     |                  62.51 |                       61.54 |      -0.96 |
| Singapore |                  75.32 |                       75.43 |      +0.12 |
| Sydney    |                  67.46 |                       66.79 |      -0.67 |
| São Paulo |                  65.93 |                       65.81 |      -0.12 |
| Cape Town |                  68.04 |                       68.59 |      +0.55 |

### C — class-only builtin vs arm 1's per-model builtin

| Location  | Arm 1 (per-model builtin) | Ablation C (class-only builtin) | Δ (C−arm1) |
| --------- | ------------------------: | ------------------------------: | ---------: |
| Munich    |                     63.63 |                           62.15 |      -1.48 |
| London    |                     60.92 |                           60.87 |      -0.05 |
| Lisbon    |                     69.61 |                           70.10 |      +0.49 |
| Oslo      |                     68.22 |                           67.55 |      -0.67 |
| New York  |                     59.01 |                           59.31 |      +0.30 |
| Denver    |                     59.13 |                           59.24 |      +0.10 |
| Seattle   |                     66.99 |                           64.83 |      -2.16 |
| Tokyo     |                     60.95 |                           60.59 |      -0.37 |
| Singapore |                     70.40 |                           70.42 |      +0.03 |
| Sydney    |                     67.31 |                           67.37 |      +0.06 |
| São Paulo |                     67.19 |                           67.07 |      -0.11 |
| Cape Town |                     68.18 |                           67.58 |      -0.60 |

## Timing

Per-location builtin fit (arm 1 + ablations A/C, 2 fits each): 26.7–31.1 s (median 29.9 s). Device fit (arm 2 + ablation B, 2 fits each): 0.6–1.3 s (median 0.7 s).

## Caveats

- **Season skew.** The single-runs archive starts 2026-04-02; every run
  here is northern-hemisphere late-spring/summer. The fit encodes that regime only —
  the same "regenerate as the archive deepens" obligation ADR 0010 carries, but weights
  steer the headline forecast more directly.
- **Archive depth & band-4 thinness.** Band 4 is scorable only for the long-range
  models and only on runs old enough for run+10d truth; its data gate runs structurally
  thin, so many (model, band-4) slots stay `null` and inherit down the ladder — see the
  gathered-data table for the actual coverage.
- **LOLO ≠ production fit.** Each arm-1 builtin is fitted on 11 locations and scored on
  the held-out 12th, which is the honest generalisation estimate but is _not_ the set the
  shipping default would be fitted on (all 12). Adoption evidence, not the shipped weights.
- **Southern-hemisphere / tropical members** (Sydney, São Paulo, Cape Town, Singapore)
  are in their own seasons and climates; a single pooled builtin is a compromise across
  all regimes, which the per-location device tier exists to refine.
