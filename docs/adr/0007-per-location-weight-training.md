# Per-location weight training, in the browser

The aggregate uses fixed heuristic weights (ADR 0004 / 0006). The training plan's
endgame (`docs/plans/frontend-model-training.md`, phase 5) lets a user tune those
weights for a location from its stored verification sample — closing the loop
ADR 0005 calls the "direction of travel", but **frontend-only**: training runs
on-device, on demand, per location.

`fitWeights` (`src/analysis/learnedWeights.ts`) fits a per-model weight
**multiplier** on top of the heuristic weight, by coordinate descent over a small
grid, maximising the aggregate's composite skill (the same `scoreScope` the
scorecard uses) across the sample. Trained multipliers are stored per gridded
location in localStorage and applied — only when the user opts in via a settings
toggle — through an optional `multipliers` argument now threaded through
`modelWeight` → `normalizedWeights` → `aggregateSeries` → `aggregateVariables`.

## Status

accepted

## Considered Options

- **Per-model multiplier (chosen)** — one knob per model, on top of the heuristic
  recipe (lead decay, region bonus, class factors stay intact). Interpretable,
  cheap to fit, and degrades gracefully to the heuristic.
- **Free per-model-per-lead-band weights** — more expressive but far more
  parameters on a small per-location sample → overfits; deferred.
- **Full ML re-derivation of weights** — out of scope for a frontend-only,
  on-device, per-location tool.

## Consequences

- **Overfitting is the central risk** (small per-location samples). Mitigated by a
  train/validation split by run date (fit on older runs, validate on recent),
  **shrinkage toward 1** (the heuristic), a **minimum-sample guard**, and only
  recommending "apply" when the fit improves the held-out validation composite.
  Train-vs-validation is reported honestly on the training page.
- **The heuristic stays the default and the fallback.** Trained weights apply only
  for locations that have them, only when the toggle is on; the `multipliers`
  argument defaults to 1, so every other path is byte-for-byte unchanged.
- **"What we train" == "what we score"** — the fit reuses the real `modelWeight`
  and `scoreScope`, so a training gain corresponds to a scorecard gain.
- Per-location, on-device, user-initiated — not a global server pipeline; the
  frontend-only realisation of ADR 0005's direction.

See ADR 0004 (composite), ADR 0005 (predictability direction), ADR 0006
(effective model count), and `docs/plans/frontend-model-training.md`.
