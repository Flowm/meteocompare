# Calibrate predictability against verified outcomes, with the heuristic as fallback

Raw predictability (spread ÷ typical spread × model-count factor) is uncalibrated
and clusters in the mid tier, telling users little. We close that gap by
publishing, wherever verification data allows, a **calibrated predictability**:
the observed frequency with which past forecasts of similar raw predictability
verified "close enough" — P(|daily t_max error| ≤ 2 °C) for temperature,
P(correct wet/dry day call, wet = ≥1 mm/day) for precipitation. The raw
heuristic stays untouched as both the input to and the fallback for the
calibrated signal.

## Status

accepted — extends (does not supersede) ADR 0005: the "uncalibrated" caveat now
applies only where no calibration curve exists.

## Decision

- **Semantics.** The published number is a verified frequency of a defined
  day-level event (a **calibration hit**): temperature |t_max error| ≤ 2 °C (an
  industry-standard tolerance, sitting in the discriminating range across lead
  times); precipitation correct wet/dry call with wet = daily sum ≥ 1 mm — the
  WMO/ETCCDI wet-day threshold, and the right one against ERA5 truth, whose
  drizzle makes 0.1 mm unusable. The hourly `WET_THRESHOLD_MM_PER_H` (0.1) is a
  different concept and is untouched.
- **Model.** A monotone recalibration of the existing raw score — not a new
  feature model. Per verified variable and per **lead-time band** (the
  scorecard's `LEAD_BANDS`): raw scores are split into 4–5 quantile bins, each
  bin's calibration-hit rate is Beta-smoothed toward the band's base rate, and
  PAVA enforces monotonicity across bins. No raw-point isotonic regression — it
  overfits below ~1000 points (Niculescu-Mizil & Caruana 2005) and our budget is
  ~50–100 points per band.
- **Per lead-time band, not one global curve.** Lead-time error climatology
  dominates forecast error; per-case spread is a real but second-order
  refinement (Whitaker & Loughe 1998; Hopson 2014; Landry et al. 2024). One
  all-lead curve would let any miscalibration of the hand-picked typical-spread
  bands leak into the published probability as systematic bias.
- **Resolution ladder.** Per-location curve (same 0.25° grid key and reach
  semantics as trained weights) when the location meets the data gate (~50
  points per band), else the device-pooled curve fitted from all stored
  samples, else the identity — which *is* the raw heuristic. Uncalibrated,
  insufficient data, and unverified variables are all the same code path.
- **Lifecycle.** Curves are fitted during training (the runs are already in
  memory), persisted in localStorage beside `StoredWeights` (per-location) and
  under one global key (pooled), refit on every completed training. No settings
  toggle: calibration applies whenever a curve exists — the heuristic-when-absent
  ladder is the off state, and a toggle would only select the less truthful
  number. Curves are fitted on the default-weight surfaces (always present in
  stored runs); the raw-score mismatch when trained weights are active is
  accepted as second-order for a monotone map.
- **Naming and tiers.** The user-facing label stays **predictability** (ADR
  0005): the same badge slot serves both ladder states, and "confidence" would
  be honest only in the calibrated one. Tiers split by state: calibrated high
  ≥0.8 / mid ≥0.5 (NWS convention anchors warnings near 80% and watches near
  50%); raw fallback keeps 0.7 / 0.4, matched to the heuristic's distribution.
- **Surfaces.** Calibrated values appear only where the curve's event
  definition matches the displayed granularity: forecast day cards and
  verification day cards (the latter doubles as the standing calibration sanity
  check). Hourly surfaces (σ band, per-hour scores) stay raw — rescaling hourly
  values through a daily curve would be fabrication.

## Considered Options

- **Heuristic-only fixes** (stretch the score distribution, retune tiers) —
  rejected: makes the badge prettier, not truer.
- **Percentile-ranking spread against history** — rejected: fakes variation in
  genuinely stable or genuinely chaotic weeks.
- **Expected-error display ("±1.8 °C")** — rejected as the primary signal (no
  comparable 0..1 score across variables, no natural tiers); lives on as
  tooltip material.
- **Direct (spread, lead) → P model (logistic/EMOS)** — rejected at our sample
  sizes; discards the domain knowledge already in the raw score; needs its own
  fallback path.
- **Per-lead-band *weight* training** (the analogous change on the aggregate
  side) — deferred, not rejected: ~63 fitted multipliers against 20–40 runs
  violates the ~10-cases-per-parameter rule. Revisit as an experiment gated on
  the trainer's out-of-sample `improvement` metric.

## Consequences

- **Day-1 vs day-7 finally differ.** Expected dynamic range for temperature is
  roughly 0.85–0.9 (day 1) down to ~0.5–0.6 (day 7) — the original
  "everything reads mid" complaint dissolves structurally, not cosmetically.
- **Uniform weeks are possible and correct.** A stable high-pressure week will
  read uniformly high. Variation appears when the atmosphere is uncertain, not
  because the scale demands it.
- **Mid-range discrimination is limited by physics, not code.** Spread
  discriminates mainly at its extremes (Whitaker & Loughe 1998); two raw scores
  of 0.55 and 0.65 in the same lead band will calibrate to nearly the same
  probability. Don't chase resolution the signal doesn't carry.
- **Seasonal drift is accepted, unhandled.** A static curve fitted across
  seasons is mildly miscalibrated in each; per-season stratification needs
  ~200+ points per location. Revisit when data allows.
- **Truth caveats inherit.** Calibration is against ERA5-Seamless, so P(hit)
  means "vs ERA5", not "vs your garden thermometer"; serial correlation of
  consecutive days means effective n is ~0.5–0.7× nominal — the data gates are
  set with that in mind.

The literature grounding all of the above is digested in
`docs/research/predictability-calibration-literature.md`. See ADR 0009 for the
day-card collapse.
