# Plan: calibrated predictability (spread → verified probability)

Status: **decisions resolved** — captured in ADR 0008 (calibration) and ADR 0009
(day-overall = min); literature grounding in
`docs/research/predictability-calibration-literature.md`.

## Goal

Make the predictability badge mean something. Today the raw heuristic clusters
in the mid tier for almost every day. We publish, wherever verification data
allows, the observed frequency with which past forecasts of similar raw
predictability verified as **calibration hits** (|daily t_max error| ≤ 2 °C;
correct wet/dry day call at ≥ 1 mm/day) — per verified variable, per lead-time
band, resolved through a per-location → device-pooled → identity ladder. The
day-card overall becomes the min of the two calibrated values.

## The one subtle constraint (read before touching code)

Stored samples carry, per day, `DailyVerification.aggregate.<var>.predictability`
— the **day-mean of the hourly raw predictability**, computed at hourly cadence.
That is the only raw score the historical data contains, so it is the statistic
the curve is fitted on — and therefore the statistic the forecast path must
compute at apply time. The forecast day cards currently use the **daily-cadence**
score (`daily.predictability[...]`, lead anchored at noon, daily typical-spread
bands) — a _different distribution_. Applying a curve fitted on one to values
from the other would miscalibrate silently. So: the calibrated day-card values
are computed from the forecast's **hourly** predictability arrays (day-mean per
calendar day), not from the daily-cadence arrays. The daily-cadence arrays stay
for the unverified variables and any surface that isn't calibrated.

Outcomes come from the same stored records: temperature hit =
|forecastMax − truthMax| ≤ 2; precipitation hit = (forecastSum ≥ 1) ===
(truthSum ≥ 1). Lead band = the `LEAD_BANDS` entry containing the day's
`leadHoursStart + 12`. Days beyond the last band clamp to the last band's curve.

## Phases

### Phase 1 — Calibration domain core (pure) ✅

New `src/domain/calibration.ts` — framework-free, fully unit-tested:

- Constants: `TEMP_HIT_TOLERANCE_C = 2`, `WET_DAY_THRESHOLD_MM = 1`,
  `MIN_POINTS_PER_BAND = 50`, smoothing strength `SMOOTHING_PSEUDOCOUNT ≈ 4`.
- Types: `CalibrationCurve` (bin centers + calibrated p per bin, n),
  `VariableCalibration` (one curve or null per `LEAD_BANDS` entry),
  `CalibrationSet` (`Record<VerifiedVariable, VariableCalibration>`).
- `calibrationPoints(runs: RunEvaluation[])` → `{variable, band, raw, hit}[]`
  extracted from stored daily verifications (skip days with non-finite raw or
  missing scores; default-weight surfaces only).
- `fitCalibrationSet(points)` → per variable × band: 4–5 quantile bins of raw,
  per-bin hit rate Beta-smoothed toward the band base rate
  (`p̂ = (hits + k·base) / (n + k)`), PAVA across bins for monotone
  non-decreasing p; band → null below `MIN_POINTS_PER_BAND` (the identity /
  heuristic fallback).
- `applyCalibration(set | null, variable, leadHours, raw)` → linear
  interpolation between bin centers, clamped at the ends; identity when the
  set/band is null. The single lookup both forecast and verification paths use.
- Tests: known synthetic relationships recover expected curves; monotonicity
  enforced; gates respected; identity fallback; band clamping.

### Phase 2 — Storage + training-flow integration ✅

- Extend `StoredWeights` with optional `calibration?: CalibrationSet`
  (additive — no migration; ADR 0008 "beside trained weights", inherits the
  reach semantics for free).
- Pooled curve: one global localStorage key
  (`meteocompare:calibration:pooled`, versioned envelope via `keyedStore`),
  fitted from **all** stored samples (`listSamples()`).
- `useTrainingFlow`: `train()` also fits the location's `CalibrationSet` from
  the in-memory sample; `apply()` persists it inside `StoredWeights` and kicks
  off a background pooled refit (fire-and-forget; IndexedDB read).
- Tests: flow fits + persists calibration; pooled refit merges all samples;
  absent calibration stays absent (old entries load unchanged).

### Phase 3 — Resolution ladder + application (forecast & verification) ✅

- `resolveCalibration(lat, lon)` in the store module: exact-cell entry's
  calibration → nearest in-reach entry's → pooled → null. Mirrors
  `loadWeights`.
- `forecastEvaluation`: `evaluateForecast` gains optional `calibration` input;
  new per-day output `dayPredictability: { overall, temperature,
precipitation, calibrated }[]` — per-variable day-mean of hourly raw scores
  (calendar-day grouping by date prefix), passed through `applyCalibration`,
  overall = **min** of the two (skip non-finite parts; ADR 0009).
  `dailyOverallPredictability` (the mean-of-three collapse) is deleted.
- `predictabilityTier(value, scale: "calibrated" | "raw")` — calibrated
  high ≥ 0.8 / mid ≥ 0.5; raw keeps 0.7 / 0.4.
- `useForecast` resolves calibration for the location (always on — no toggle)
  and threads it into `evaluateForecast`.
- Verification page: calibrate the per-day per-variable badges through the same
  `applyCalibration` (band from the day's lead hours) in the view-model layer,
  so `VerificationDayCard` stays dumb; badges get the calibrated tier scale
  when a curve applied.
- Tests: evaluateForecast with a fake curve (calibrated values + min overall +
  fallback when null); tier scales.

### Phase 4 — Badge UI + copy ✅

- `PredictabilityBadge`: `calibrated` prop switches tier scale + tooltip copy
  (calibrated: reference-classed — "N of 10 past forecasts this confident
  verified within 2 °C" / "…called wet/dry correctly"; raw: today's
  "uncalibrated" wording). Click (day cards) opens a small popover with the two
  per-variable rows; keep the hover title for the sm badge.
- `DayCard`/`DailyStrip`: consume `dayPredictability`, pass parts + calibrated
  flag; badge click wired.
- README "How the predictability signal works" section updated (two states,
  event definitions, ladder).
- Browser-verify (preview tools) incl. mobile viewport; typecheck + tests +
  lint green.

Commit after each phase (`feat(predictability): …` / `feat(training): …`).

## Deferred (recorded, not planned)

- Per-lead-band **weight** multipliers (ADR 0008 "Considered Options") — gate on
  the trainer's out-of-sample improvement when attempted.
- Warm/cold-season curve split once a location exceeds ~200 points per band.
- Brier Skill Score vs. climatology as a calibration-health readout on the
  training page.
- Excluding persistently bad models from the spread computation (not just
  down-weighting the mean).
