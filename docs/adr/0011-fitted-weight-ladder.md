# Fitted weight ladder replaces the hand-tuned lead-time decay

The weighting recipe's lead-time authority — the hand-drawn per-class decay
curves in `leadFactorForKind`, including the untested 0.75 AI factor — is
replaced by **fitted per-model, per-lead-band weight multipliers**, organised
as a resolution ladder exactly parallel to the calibration ladder (ADR 0008 /
0010). One parameterization, one fitting mechanism (the ADR 0007 coordinate
descent, extended per-band), two fitted tiers:

```
w = (1 + regionBonus) × camBoost
      × builtin[model][band]   ← shipped; fitted offline, pooled over reference locations
      × device[model][band]    ← per-location residual; opt-in via the existing toggle
```

Each band resolves independently down the ladder: device band → device pooled →
builtin per-model → builtin per-class → 1. `maxLeadHours` cutoffs, `regionBonus`
and `camBoost` are out of scope and stay as-is.

## Status

accepted for the builtin tier; the per-band **device** tier is rejected.
The pre-registered experiment ran 2026-07-12
(`docs/research/weight-ladder-experiment.md`): the new default beat the
hand-tuned decay in 11/12 held-out locations (median Δ +1.71 composite) —
adopted. Per-band device residuals won only 7/12 (median Δ +0.21) — not
shipped; device training stays per-model (pooled) multipliers per ADR 0007,
now fitted as residuals on top of the builtin tier. Ablations: per-day builtin
bands ≈ no gain over 4 bands; per-day device bands mostly negative; class-only
builtin loses to per-model (up to −2.16 at one location).

## The experiment gate

Fit and evaluate at the 12 ADR-0010 reference locations, ~24 runs each
(00Z, `forecast_days: 10`), builtin tier validated by leave-one-location-out,
device tier by the existing within-location temporal split. Pre-registered rule:

- Adopt the new default (skeleton deleted, builtin tier) only if it beats the
  current app's held-out composite at the median **and** in ≥ 8 of 12 locations.
- Ship the per-band device tier only if it additionally beats the new default
  by the same rule.
- Ablations ride along: per-day builtin bands, per-day device bands
  (falsification arm), class-only builtin.

## Considered Options

- **Per-band device multipliers on top of the kept decay + separate per-class
  offline curve refit** — two mechanisms, two parameterizations; rejected for
  the unified ladder once it was clear the pooled offline fit can reuse the
  device fitting machinery verbatim (panels are per-(run, location) already).
- **Keeping `leadFactorForKind` as a skeleton under the fitted tiers** —
  safer fallback, rejected to keep a single lead-time authority. The safety
  role moves to the fitted **class fallback** tier.
- **Per-day device bands** — deferred (≈100 free parameters per location on
  11–30 runs; per-band-day signal is ~1 wet/dry call + 1 amount error).
  Testable as an ablation arm.
- **Free per-band weights replacing rather than multiplying** at the device
  tier — rejected: violates "1 = whatever the tier below says", loses graceful
  degradation.

## Consequences

- **`LEAD_BANDS` gains a fourth band, 168–240 h ("7–10d")**, and training runs
  are gathered at `forecast_days: 10`. With the skeleton gone, fitted
  multipliers must cover everything the forecast page shows (240 h). This
  ripples into every band consumer: the scorecard grows a mostly-sparse column,
  and the calibration schema changes shape — stored device calibration needs
  migration and `DEFAULT_CALIBRATION` regeneration. It also fixes an existing
  honesty gap: days 8–10 previously clamped onto the 4–7d calibration curve.
- **New models resolve to their class's fitted multipliers** until the next
  offline refit has enough archive for a per-model fit (open-meteo's
  previous-runs archive for a new model starts at zero, so this window is
  structural). Without this tier, deleting the decay would make every model
  registration a silent long-lead overweighting.
- **Device-tier fits are hierarchical**: per-band deviations shrink toward the
  pooled per-model multiplier, which shrinks toward 1. A band that fails its
  data gate or validation inherits the pooled value. Sign-flipping patterns
  (great day 1, harmful day 6) are deliberately dampened twice.
- **Band edges are steps, not interpolated.** Weight discontinuities at 48 /
  96 / 168 h are accepted (precedent: the `maxLeadHours` cliffs); in exchange
  the objective decomposes and each band fits and validates independently.
- **Existing stored trained weights are invalidated** when the ladder ships —
  they were fitted against the old recipe and would double-apply decay
  corrections on top of a builtin tier that already contains them.
- **Season skew:** the single-runs archive starts 2026-04-02, so the first
  shipped builtin fit encodes northern-summer skill only. Same "regenerate
  periodically as the archive deepens" obligation as ADR 0010, but weights
  steer the headline forecast more directly.
- Band-4 truth requires runs ≥ ~15 days old (10 forecast days + ERA5's ~5-day
  lag), so its data gates run structurally thinner — absorbed by the ladder.

See ADR 0007 (device training — its "free per-lead-band weights" deferral is
resolved by the hierarchical structure here), ADR 0008 / 0010 (the ladder
pattern and the shipped-default precedent this copies).
