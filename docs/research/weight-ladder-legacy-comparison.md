# Is legacy beating the shipped default systematic, or single-run noise?

_Follow-up to [ADR 0011](../adr/0011-fitted-weight-ladder.md) and the
[weight-ladder experiment](weight-ladder-experiment.md). Real numbers only,
recomputed from the experiment's cached runs — nothing extrapolated._

## The question

The verification page now carries an **"Aggregate (legacy)"** comparator row
(`domain/legacyWeighting.ts`) scored against the shipping fitted-ladder
aggregate. On one single-run view — **Munich, run 2026-06-28 00Z, 7-day window**
— legacy (71) beat the default (68). ADR 0011's experiment found the opposite in
aggregate (default beats legacy in 11/12 held-out locations, median +1.71
composite). So: is legacy's win **systematic**, or **cherry-picked single-run
noise**? And if partly systematic, where does it come from?

The prime suspect was a **scope mismatch**: the ladder was fitted and measured on
the full **240 h** (10-day) window, but the single-run verification view fetches
`forecast_days` = 7 and a 7-day truth window
(`composables/useVerification.ts`, `api/omSingleRuns.ts` default), so it scores
only **168 h** — ~70 % of what the weights were fitted for.

## Method

For every cached experiment run (12 reference locations × the 24 pre-registered
00Z dates, `forecast_days: 10`; 283 scorable runs after null-marker runs are
dropped) I recomputed the aggregate composite for two arms straight from the
cached per-model series + ERA5 truth:

- **default** — production `weighting.modelWeight` with the shipped
  `DEFAULT_WEIGHTS` (per-model → per-class → 1, no device multipliers), exactly
  as `resolveMultiplier` applies them;
- **legacy** — `legacyWeighting.legacyModelWeight` (the hand-tuned per-class
  decay).

Both are scored with the scorecard's own `scoreScope` composite (temperature_2m

- precipitation), aggregating with the same weighted-mean-per-timestep the
  production aggregate uses, at two scopes — **240 h** (full) and **168 h** (page
  single-run scope) — and per lead band (0–48 / 48–96 / 96–168 / 168–240 h).
  Δ = composite(default) − composite(legacy), positive = default ahead.

The 4 extra Munich + 4 extra London cached runs (dates 04-19/05-06/05-23/06-09,
from a separate gather) are excluded so the set matches the experiment exactly.

### Method + recipe cross-check (exact)

Scored with the legacy arm over the full 240 h, this pipeline reproduces the
experiment's **arm 0** (the legacy incumbent) to the last decimal at all 12
locations (max |Δ| = 0.000). That simultaneously confirms (a) the scoring here is
faithful to the experiment, and (b) **`legacyWeighting.ts` reproduces the
pre-adoption `weighting.modelWeight` exactly** — the arithmetic
`(1 + regionBonus) × leadFactor × variableBoost` is identical (verified against
git `59f2c9e^`; only a comment differs and the unused `trained`=1 argument is
dropped).

## Results

### Per-run Δ, pooled over all 283 runs

| Scope                       | mean default | mean legacy |    mean Δ |  median Δ |   default wins |   legacy ahead |
| --------------------------- | -----------: | ----------: | --------: | --------: | -------------: | -------------: |
| **240 h** (fitted/measured) |        65.31 |       63.71 | **+1.59** | **+0.88** | 182/283 (64 %) | 101/283 (36 %) |
| **168 h** (page single-run) |        69.69 |       67.77 | **+1.92** | **+0.94** | 187/283 (66 %) |  96/283 (34 %) |

Default wins the mean, the median, and ~⅔ of individual runs at **both** scopes.
A user browsing single runs would nonetheless see **legacy ahead roughly 1 run in
3** — that is the run-to-run noise floor, not a defect.

**The scope-mismatch hypothesis is refuted.** Default's edge does **not** shrink
or flip at 168 h; it is if anything marginally _larger_ there (median +0.94 vs
+0.88, win rate 66 % vs 64 %). The page scoring only 70 % of the fitted window
therefore does **not** under-report the ladder — it shows it at, or slightly
above, its full-window value.

### Per lead band, pooled

| Band (h) | mean default | mean legacy |    mean Δ | median Δ | default wins |
| -------- | -----------: | ----------: | --------: | -------: | -----------: |
| 0–48     |        76.41 |       75.15 |     +1.26 |    +0.66 |      182/283 |
| 48–96    |        73.18 |       71.30 | **+1.87** |    +0.76 |      184/283 |
| 96–168   |        64.80 |       62.86 | **+1.94** |    +0.88 |      178/283 |
| 168–240  |        54.81 |       53.99 | **+0.82** |    +0.29 |      156/283 |

The fitted ladder wins **every** band, but its advantage is **largest in bands
1–3 (48–168 h) and smallest in band 4 (168–240 h)** — the opposite of a "wins
only via the long-lead band" story. The 168 h page view spans exactly the bands
where the ladder is strongest; adding band 4 (the 7–10 d tail, where the recipes
nearly converge because skill is low and legacy's 0.4 decay floor already keeps
the globals/AI in the blend) **dilutes** the edge rather than creating it.

### Per location, both scopes

| Location   | 240 h mean Δ | 240 h median Δ | 240 h legacy ahead | 168 h mean Δ | 168 h median Δ | 168 h legacy ahead |
| ---------- | -----------: | -------------: | -----------------: | -----------: | -------------: | -----------------: |
| Cape Town  |        +1.03 |          +0.72 |               8/24 |        +1.61 |          +1.12 |               5/24 |
| Denver     |        +3.15 |          +3.03 |               4/24 |        +2.68 |          +2.90 |               6/24 |
| Lisbon     |        +3.07 |          +1.10 |               8/24 |        +3.34 |          +1.15 |               9/24 |
| London     |        +1.21 |          +0.45 |              10/24 |        +1.36 |          +0.77 |               8/24 |
| **Munich** |        +1.97 |      **+0.50** |               8/24 |        +1.11 |      **+0.21** |          **11/24** |
| New York   |        +0.27 |          +0.84 |               9/24 |        +1.99 |          +1.60 |               9/24 |
| Oslo       |        +1.78 |          +2.02 |               7/23 |        +2.58 |          +1.30 |               7/23 |
| São Paulo  |        +0.27 |          +0.29 |              11/24 |        +1.08 |          +0.34 |               8/24 |
| Seattle    |        +1.63 |          +1.11 |               6/24 |        +1.98 |          +0.91 |               8/24 |
| Singapore  |        +3.00 |          +4.32 |               6/20 |        +3.67 |          +3.49 |               5/20 |
| Sydney     |        −0.14 |          +0.07 |              12/24 |        +0.97 |          +0.47 |              10/24 |
| Tokyo      |        +2.09 |          +0.56 |              12/24 |        +1.01 |          +0.96 |              10/24 |

Default's median Δ is positive at every location and scope (Sydney 240 h is a
near-tie, +0.07). But the per-location spread is real: **Munich at 168 h is the
default's weakest cell** — median Δ only +0.21 with legacy ahead on **11/24 runs
(46 %)**, essentially a coin flip. Sydney and Tokyo at 168 h (10/24 each) are the
next weakest.

### In-sample vs out-of-sample

The shipped `DEFAULT_WEIGHTS` were fitted on **all 12** locations, so scoring them
on this same cache is **in-sample** and mildly flatters the default. The
experiment's leave-one-location-out arm 1 is the honest **out-of-sample**
estimate. Both agree default wins:

- In-sample (this note): median per-location composite lift over legacy is
  positive at all 12 locations.
- Out-of-sample (LOLO, experiment): median Δ **+1.71**, 11/12 locations.

Per-location the in-sample default is only slightly above LOLO arm 1 (e.g.
Lisbon 70.49 vs 69.61, Denver 59.68 vs 59.13, Munich 63.79 vs 63.63) — the
in-sample flattering is small and does not manufacture the advantage.

### Munich specifically, incl. the user's exact run

| Munich scope | mean Δ | median Δ | default wins | legacy ahead |
| ------------ | -----: | -------: | -----------: | -----------: |
| 240 h        |  +1.97 |    +0.50 |        16/24 |  8/24 (33 %) |
| 168 h        |  +1.11 |    +0.21 |        13/24 | 11/24 (46 %) |

The user's exact run (**2026-06-28 00Z**) is not in the cache, so it was fetched
fresh via the gather machinery (truth covered 216/240 h — the 10-day tail lags
ERA5, so 240 h is scored over available truth):

| Scope | default | legacy |            Δ (def − leg) |
| ----- | ------: | -----: | -----------------------: |
| 168 h |   67.93 |  70.85 | **−2.92** (legacy ahead) |
| 240 h |   64.92 |  67.63 | **−2.71** (legacy ahead) |

This reproduces the user's 68 vs 71 almost exactly — and legacy's win **survives
at 240 h**. So this run's legacy lead is a genuine per-run event, **not** a
scope artifact: it is one of the ~34 % of runs where the pooled fit loses to the
hand-tuned decay, and it happens to sit in Munich-at-7-days, the location/scope
cell where that is most likely (46 %).

## Verdict — is it systematic?

**Mostly noise around a real, systematic default advantage.** The fitted ladder
beats legacy on the mean, the median, and ~⅔ of individual runs at both the 240 h
window it was fitted on _and_ the 168 h window the page shows, and the honest
out-of-sample LOLO estimate agrees (median +1.71, 11/12 locations). Legacy leads
on ~1 run in 3 purely from run-to-run variance — the user's Munich 2026-06-28 run
is one of them, and its legacy lead persists at 240 h, confirming it is not a
scope effect.

**The suspected scope mismatch does not exist in the harmful direction.** The
168 h page view spans bands 0–168 h, exactly where the ladder's edge is largest;
the 240 h fit-window adds only band 4 (168–240 h), where the two recipes nearly
converge. So the verification page, despite scoring only ~70 % of the fitted
window, is **not** under-selling the ladder — if anything it flatters it slightly.

**The one partially-systematic pocket is Munich at 7-day lead** (median Δ +0.21,
legacy ahead 46 %) — a near coin-flip, which is exactly the location and scope
the user was looking at. A single pooled weight fit is a compromise across 12
climates; Munich's short-lead regime is where that compromise sits closest to the
old hand-tuned decay. That is a per-location-precision limitation the (rejected)
device tier was meant to address, not a bug — and with n = 24 per location the
per-cell estimates carry wide error bars.

## Caveats

- **Season skew** — every cached run is northern-hemisphere late-spring/summer
  (archive starts 2026-04-02); the fit and this comparison encode that regime
  only.
- **n = 24 per location** — per-location and per-cell win rates carry wide
  confidence intervals; only the pooled and median-across-location figures are
  robust.
- **Band-4 truth is thin** — the 168–240 h band is scorable only for long-range
  models on runs old enough for run+10 d truth, so its numbers rest on the least
  data.
