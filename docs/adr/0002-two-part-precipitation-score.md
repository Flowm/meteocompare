# Two-part precipitation score (Amount + Timing) instead of a single rolling-MAE

Hourly precipitation verification has a well-known pitfall: strict hourly MAE double-penalises a forecast that gets the right amount 1–2 hours off. A model perfectly predicting 5 mm/h at 14:00 when the truth arrived at 15:00 scores as badly as a model that completely missed the event. The standard fix in the verification literature is MAE on a centred N-hour rolling sum, which is one number and meteorologically clean — but "your model scored 1.4 mm rolling-3h-MAE today" is opaque to non-specialists.

We instead decompose precipitation scoring into **two interpretable numbers** per model per day: signed **amount error** (forecast daily sum minus truth daily sum, in mm) and a **timing score** (the Critical Success Index `hits / (hits + misses + false_alarms)` within ±1 h tolerance, where each hour is categorically labelled as `hit / miss / false alarm / correct dry`). The hit/miss labels also drive a per-hour colour strip below the chart that visualises exactly where timing went wrong. This answers the two questions users actually ask about precipitation — was the total roughly right, and did it fall at roughly the right time — separately, instead of collapsing them into one academically-pure score.

The timing score was originally a bare **hit rate** (POD — `hits / (hits + misses)`), which ignored false alarms entirely: a model predicting rain that never fell was never penalised, so a constant-rain forecast could score 100%. We switched to the Critical Success Index, which puts false alarms in the denominator so over-prediction is penalised symmetrically with under-prediction. NaN (no meaningful score) now means only that nothing happened on either side, rather than merely that truth was dry.

**Missing data is ignored, not penalised.** A forecast/truth pair contributes only when both values are present. Hours with a missing value receive the `no_data` label and do not contribute to timing CSI. Both precipitation sums use the same **scored hours**. The composite amount error uses that count to express the error per day. With no scored hours, precipitation is unscorable rather than dry. The hourly strip shows missing pairs as gaps.

This protects short-lead models from penalties for hours beyond their forecast horizon. It also prevents missing truth from acting as zero rainfall or diluting the error. Temperature bias and MAE also use paired values.

## Amendment: missing truth (2026-09-13)

The earlier amount rule aligned truth to forecast coverage alone. The corrected rule also excludes forecast values where truth is missing. Precipitation calibration requires every hour of the day to have a forecast/truth pair, because partial totals cannot establish a daily wet/dry outcome.

Trade-off: more UI surface (two numbers per variable per card plus a 24-cell strip) and a custom timing-tolerance methodology rather than a literature-standard metric. We accept this because the app is informational, not a research-grade verification tool, and interpretability beats meteorological orthodoxy for this audience.
