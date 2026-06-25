# Per-model composite score: fixed-scale normalised blend

The per-model scorecard ranks each model (and the aggregate) over the full run
window with a single **Overall** 0–100 number. To combine metrics of different
units — temperature MAE (°C), precip amount error (mm), precip timing hit rate
(%) — we map each to a 0..1 "goodness" against a **fixed per-variable reference
scale**, then take an **equal-per-metric** weighted mean (×100). The same blend
produces the per-lead-band composites.

This mirrors the **typical-spread** methodology already in `predictability.ts`:
educated-guess anchors that normalise a raw quantity into a comparable score.
The anchors (`TEMP_MAE_REF_BAD = 5 °C`, `AMOUNT_REF_BAD_PER_DAY = 5 mm/day`;
timing hit rate is already 0..1) live as named constants in
`src/domain/scorecard.ts` and are expected to be tuned against real data.

## Status

accepted

## Considered Options

- **Mean rank across metrics** — unit-free and robust, but hides magnitude (1st
  by a hair reads the same as 1st by a mile) and is purely relative to the field.
- **Min–max across the field, per run** — no anchors needed, but purely relative
  (a field of all-bad models still crowns a 100), outlier-sensitive, and not
  comparable run-to-run.
- **Relative to the aggregate** — meaningful anchor, but not comparable across
  runs/locations in absolute terms.
- **No composite (sortable columns only)** — most honest, but never answers
  "which model was best overall" in one glance.

We chose the fixed-scale blend for **cross-run/-location stability** (a score of
80 means the same thing every run) and **methodological consistency** with
predictability.

## Consequences

- **Precip-leaning weighting.** Equal-per-metric (⅓ each) gives precipitation ~⅔
  of the weight, since it contributes two of the three metrics (amount + timing)
  and temperature one (MAE). Deliberate for a forecasting tool where precip is
  the harder problem; revisit by reweighting `COMPOSITE_WEIGHTS`.
- **Temperature bias is excluded** from the composite (shown as a column only):
  `|bias| ≤ MAE` always, so including it would double-count temperature error.
- **Coverage-fair amount.** Amount error is normalised per _covered_ day, so a
  short-lead model isn't flattered by the dry hours it never forecast. Temp MAE
  and timing are already per-hour averages/fractions.
- **Dry-scope renormalisation.** When a scope has no truth-wet hours, the timing
  term is undefined and dropped, and the remaining weights renormalise; amount
  still penalises false precipitation.
- **Partial coverage is ranked, not hidden.** Models that don't span the full
  window are scored over their available hours, flagged `*`, and their empty
  lead bands render as `—`. They can still out-rank full-coverage models — the
  bands and flag are the signal, not a ranking cut-off.

See also ADR 0002 (two-part precipitation score) for the underlying amount +
timing metrics this composite consumes.
