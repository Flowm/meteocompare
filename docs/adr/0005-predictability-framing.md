# Adopt "predictability" for the agreement-derived trust signal

meteocompare derives a 0..1 trust signal from inter-model **spread** (how much
the different models disagree at a timestep). We rename it from "confidence" to
**predictability** in code and UI, and adopt the three-output frame the
multi-model industry uses — **best estimate** (the aggregate), **probabilistic**
(event likelihood; today only the grafted `precipitation_probability`), and
**predictability** (trust, from spread). This matches the three-output frame
mature multi-model products expose, which label this exact spread-derived signal
"predictability".

The honest catch: in mature multi-model products, predictability is
_verification-calibrated_; ours is not. meteocompare is a **poor man's ensemble** (Ebert 2001) — a weighted
blend of _deterministic_ outputs with _fixed_ heuristic weights, no bias
correction, and an _open_ verification loop. So our predictability is an
**uncalibrated, agreement-based estimate**, and the spread→reliability
relationship has not been demonstrated. We adopt the word anyway (matching the
frame and our direction of travel) but mark the calibration gap explicitly in
the badge tooltip and glossary, in the same "under review" spirit as the
overall-predictability collapse.

## Status

accepted

## Considered Options

- **Keep "confidence"** — rejected: "confidence" reads as a probability of being
  correct, which the signal is not; the least honest of the options.
- **"Agreement" now, "predictability" once calibrated** — the maximally honest
  path (the number literally is inter-model agreement), deferring the stronger
  word until a verified spread–skill relationship exists. Rejected in favour of
  adopting the destination vocabulary immediately, to align the codebase with
  the target architecture and avoid a later second relabel.
- **"Predictability" now (chosen)** — single rename straight to the
  industry/north-star term, with the uncalibrated status surfaced, not hidden.

## Consequences

- **The word out-runs the evidence, deliberately.** "Predictability" in the
  literature implies a verified spread–skill relationship; ours has none yet.
  Mitigated by the explicit "uncalibrated" caveat in the badge tooltip and the
  **Predictability** glossary entry, and by keeping **overall predictability**
  flagged "under review".
- **Mechanism vs signal split.** "Agreement" / "spread" remain the names of the
  _mechanism_ in the domain layer (`spread`, `stdDev`, `typicalSpread`,
  `modelCountFactor`); "predictability" is the _derived signal_. Don't collapse
  the two.
- **Probability stays reserved.** Only the ensemble-derived
  `precipitation_probability` graft (ADR 0003) may be called a probability;
  predictability is not a probability.
- **Sets a direction, not a destination.** Earning the word means closing the
  verification loop — calibrating the spread→predictability mapping against
  measured error, and ideally bias-correcting members and discounting
  non-independent ones (multiple ICON / AROME-Harmonie / IFS-trained-AI members
  inflate apparent agreement). That is a larger, still-open architectural
  decision — it pushes against the frontend-only constraint — tracked
  separately, not decided here.
- **Rename executed.** `confidence.ts`→`predictability.ts`,
  `ConfidenceBadge.vue`→`PredictabilityBadge.vue`,
  `confidenceFor`/`overallConfidence`/`confidenceTier` and all call sites and CSS
  tokens renamed; type-check, tests, and build green.

See also ADR 0003 (the precipitation-probability graft — the one genuine
probability) and the README "No bias correction" limitation.
