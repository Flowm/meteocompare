# Day-card overall predictability = min of the temperature and precipitation values

The forecast day card needs one glanceable number, but its former definition —
the unweighted mean of temperature, precipitation, and weather-code
predictability — regressed almost every day toward "mid": one certain variable
could never lift a day, one uncertain variable could never sink it, and after
ADR 0008 it would average two calibrated probabilities with an uncalibrated
agreement score. The overall is now the **minimum of the two per-variable
values for temperature and precipitation** — the day is as trustworthy as its
least certain headline variable — with weather code excluded, and the two parts
shown separately when the badge is clicked (with their reference-classed
sentences: "8 of 10 forecasts this confident landed within 2 °C").

This resolves the "overall predictability (under review)" flag that CONTEXT.md
carried since ADR 0005.

## Status

accepted

## Considered Options

- **Keep the three-part mean** — rejected: the mean-regression was cause #1 of
  the "everything reads mid" complaint, and post-calibration it mixes
  semantics.
- **Product of the two** — the crispest day-level claim ("P(temp right AND rain
  call right)") but assumes independence that weather regimes violate, so it
  systematically understates. Min is the defensible upper bound of the same
  idea without the independence lie.
- **No overall, two badges per card** — most honest, rejected for chrome cost
  on the vertical-space-constrained mobile layout, and users do want one
  glanceable number.
- **Excluding weather code** — its severity-agreement score partly proxies the
  precipitation call (double-counting), its within-severity-slug agreement
  reads as full agreement (inflated), and it is uncalibrated. It stays visible
  on per-variable surfaces.

## Consequences

- The same min rule applies in both ladder states (calibrated and raw
  fallback), so the collapse behaves identically up and down the ladder — only
  the inputs change.
- The overall inherits the tier scale of its inputs' state (ADR 0008).
- A day can now honestly read "low" (one shaky headline variable) or "high"
  (both solid) — the dynamic range the mean destroyed.
