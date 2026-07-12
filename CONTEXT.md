# MeteoCompare

Multi-model weather forecast comparison. The app pulls operational forecast products from many models via open-meteo, weights them, and produces a single aggregate forecast (the _best estimate_) plus a per-timestep _predictability_ signal. A secondary verification surface compares past forecasts against a reference reanalysis field to expose which models (and the aggregate) were actually right.

We follow the three-output frame the multi-model industry uses: **Best estimate** (the blended value), **Probabilistic** (likelihood of an event — today only the grafted precipitation probability), and **Predictability** (how trustworthy the forecast is, estimated from inter-model spread and — where verification data allows — calibrated against measured outcomes). We are a _poor man's ensemble_ with a partially closed verification loop: fitted default weights (ADR 0011), per-location trained weights (ADR 0007), and calibrated predictability for the verified variables (ADR 0008); heuristics fill the remaining gaps. See ADR 0005.

## Language

### Models & runs

**Model**:
A specific forecast product exposed by open-meteo, e.g. ECMWF IFS HRES, DWD ICON-EU, or ECMWF AIFS. One logical model per row in `src/domain/models.ts`.
_Avoid_: provider, source, dataset.

**Probability graft**:
open-meteo derives `precipitation_probability` only from ensembles, so deterministic models return null for it. Where a model has an ensemble-backed _seamless_ sibling, we fetch that sibling solely for the probability variable and read its series under the registered model's id — the _graft_. Today `icon_seamless` is grafted onto DWD ICON (`icon_global`). The **graft source** (`icon_seamless`) is never a Model: no registry row, no chip, no aggregate vote of its own; it supplies one variable under the host model's identity and weight. Note we consume open-meteo's _derived_ probability, never raw ensemble members (see "Aggregate").
_Avoid_: registering a graft source as a Model.

**Model class**:
Resolution/product-and-scope tier: `global`, `regional-mid`, `regional-cam` (convection-allowing), `ai` (machine-learned single forecast product), or `ensemble-mean` (mean of ensemble members exposed as one forecast product). Drives the precipitation (amount + probability) boost and the class tier of the **weight ladder** — the fitted fallback weighting for models without per-model **default weights** (ADR 0011; formerly the hand-tuned per-class decay curves).

**Home region**:
The geographic bounding box where a regional model has a structural advantage. Drives the region bonus inside the weighting recipe. Global models have no home region.

**Run**:
A single forecast cycle issued by a model at a specific datetime, e.g. "the GFS run from 2026-05-11 00:00 UTC". Runs are the unit identified by the single-runs API.

**Run date**:
The date component of a run. The verification page also lets you pick the **run cycle**, so a run is identified by date + cycle — not date alone. The default cycle is 00Z.
_Avoid_: issue date, cycle date.

**Run cycle**:
The hour-of-day a run was issued (00 / 06 / 12 / 18 Z), selectable on the verification page; defaults to 00Z. Models publish different cycles (e.g. ECMWF issues 00/12Z), so picking a non-00Z cycle naturally drops the models that don't issue it — the single-runs API reports them missing and they're pruned (see "Available models").

**Lead time**:
Hours elapsed since run start. A value forecast 36 h into the future has lead time 36 h. Selects the **lead-time band**, and with it the **weight ladder** multiplier, in the weighting recipe.

**Available models**:
The subset of registered models for which the single-runs API actually returned data for a given run (date + cycle). Retention varies per model — and not every model issues every cycle — so this is a runtime fact, not a static list.

**Model family**:
A lineage group of models that share a dynamical core, or are initialised from / trained on the same analysis, and therefore share systematic errors — they are not independent votes. Examples: the ICON variants (`icon_global`/`icon_eu`/`icon_d2`/`meteoswiss_icon`); the HARMONIE-AROME CAMs built on Météo-France's AROME; the UK Unified Model products (UKMO / BOM ACCESS / KMA); and each AI product grouped with the analysis it derives from (AIFS↔IFS; GraphCast / AI-GFS / GEFS-mean↔GFS). The **effective model count** discounts same-family siblings (the first member counts fully, each sibling adds `SIBLING_CREDIT`) and feeds the predictability model-count factor, so a cluster of relatives doesn't read as independent corroboration. Defined in `models.ts`; see ADR 0006.

### Aggregation

**Aggregate**:
The weighted blend of contributing models at a timestep — the app's primary forecast surface, the **best estimate** in the three-output frame. Computed by `aggregateSeries` in `src/domain/aggregate.ts`. Falls back to a circular mean for wind direction and a severity-weighted mode for weather codes.
Technically a **weighted consensus** / **poor man's ensemble** ([Ebert 2001](https://journals.ametsoc.org/view/journals/mwre/129/10/1520-0493_2001_129_2461_aoapms_2.0.co_2.xml)) — a multi-model _ensemble of opportunity_ of _deterministic_ outputs, not the perturbed single-model ensemble that the bare word "ensemble" implies. We keep the neutral term **Aggregate** in code and UI; the academic names only situate the design.
_Avoid_: bare _ensemble_ (overloaded with the ensemble-members concept we deliberately don't use) and bare _consensus_; _weighted consensus_ is fine as the cited technical lineage.

**Contributing model**:
A model whose data is actually included in a particular aggregate point — i.e. one that passed the lead-time filter and returned a non-null value at that timestep. Distinct from "registered model".

**Spread**:
Weighted standard deviation across the contributing models at a timestep. Inputs to the predictability formula.

**Typical spread**:
Empirically chosen reference spread per variable per lead-time band, used to normalise raw spread into a 0..1 score. Defined in `predictability.ts`.

**Hourly series chart**:
The single shared hourly chart rendered on both the forecast and verification pages. It draws the aggregate for a selected variable (with its predictability band), optionally overlays the per-model lines, and — on the verification page — the truth series. One surface, configured per page.
_Avoid_: per-page names ("forecast chart", "verification chart", "compare-models chart"); these described the three separate charts that preceded it.

**Per-model overlay**:
The opt-in mode of the hourly series chart that draws one line per contributing model, overlaid on the aggregate. Secondary surface — the aggregate view is primary.
_Avoid_: spaghetti view, breakdown view (both used historically). "Spaghetti" specifically implies ensemble members, which we don't use (see "Aggregate"); "per-model overlay" is the term we keep.

### Predictability

**Predictability**:
A 0..1 signal estimating how much to trust an aggregate value, computed per variable. It has two states, one label: **calibrated predictability** where a **calibration curve** exists (verified variables, daily granularity), and the **raw predictability** heuristic everywhere else. The label stays "predictability" in both states because it must be honest in both; the badge tooltip says which state applies (ADR 0008). Stored in code as `predictability` (renamed from `confidence`). When unqualified, refers to the per-variable primitive — see "Flagged ambiguities".
_Avoid_: _confidence_ (the prior term — reads as a probability of being correct, which only the calibrated state earns).

**Raw predictability**:
The agreement-based heuristic primitive: inter-model **spread** normalised against typical spread, multiplied by a model-count factor based on the _effective_ (lineage-discounted) number of contributing models — see **Model family**. Uncalibrated — a _poor man's predictability_ (ADR 0005). The mechanism-side score, and the input the calibration curve maps from. The only state available for unverified variables, hourly surfaces, and locations below the calibration data gate.

**Calibration curve**:
A learned monotone mapping from raw predictability to the observed **calibration hit** frequency, fitted per verified variable per **lead-time band** from stored verification samples (ADR 0008). Resolved through a fallback ladder: the location's own curve when it meets the data gate, else the device-pooled curve, else the **default calibration**, else the identity (raw heuristic unchanged). Device curves persist beside trained weights, with the same **reach** semantics.

**Default calibration**:
The built-in calibration curve set shipped with the app (ADR 0010), fitted offline from verification samples at climatically diverse reference locations worldwide, with run dates spread across seasons. The ladder's floor above the raw heuristic: untrained devices get outcome-anchored percentages out of the box. Curves carry `source: "builtin"` so the UI names the reference class honestly ("at reference locations worldwide", not "at this location").
_Avoid_: calling it _global calibration_ (reads as "calibrated for the globe" — it is a global-average default, not a per-place fit).

**Calibrated predictability**:
The published signal where a calibration curve exists: the fraction of past forecasts with similar raw predictability that verified as calibration hits — "8 of 10 forecasts this confident landed within 2 °C". A verified frequency with an explicit reference class, shown with that reference class in the badge tooltip.

**Calibration hit**:
The day-level outcome that the aggregate forecast verified "close enough" against truth: for temperature, |daily t*max error| ≤ 2 °C; for precipitation, a correct wet/dry day call with wet = daily sum ≥ 1 mm (the WMO/ETCCDI wet-day threshold — also robust to ERA5 drizzle). The event the calibration curve counts.
\_Avoid*: bare _hit_ (taken — the hourly precipitation classification, see "Hit / Miss / False alarm / Correct dry").

**Predictability tier**:
Categorical bucket of a predictability value. Two scales, one per state: calibrated — `high` (≥0.8), `mid` (≥0.5), `low` (<0.5), aligned with NWS confidence conventions; raw fallback — `high` (≥0.7), `mid` (≥0.4), `low` (<0.4), tuned to the heuristic score's distribution. One threshold set for both would either mark coin-flips "mid" or make untrained locations look uniformly worse (ADR 0008).

**Overall predictability** _(forecast-view only)_:
The single 0..1 number on a forecast day card: the **minimum** of the two per-variable predictabilities for temperature and precipitation — the day is as trustworthy as its least certain headline variable. Weather code is excluded (its agreement score partly proxies the precipitation call and is uncalibrated). Clicking the badge reveals the two parts separately. Replaces the unweighted three-variable mean, whose averaging regressed every day toward "mid" (ADR 0009 — resolves the prior "under review" flag).

### Verification

**Verification**:
Comparing a past forecast against truth, producing per-variable error scores. The act and the page. Distinct from "analysis" — see "Flagged ambiguities".
_Avoid_: backtest (finance-flavoured), hindcast (different concept: re-running models against past dates with current model versions), analysis (overloaded).

**Truth** (or **Ground truth**):
The reference field a forecast is scored against. In this app, always **ERA5-Seamless** (requested from open-meteo's historical-weather API with `models=era5_seamless`), which stitches ERA5-Land at 9 km for variables it provides (temperature, cloud cover) with ERA5 at 25 km elsewhere (precipitation, wind). The Best Match default is explicitly avoided because it includes IFS HRES — see ADR 0001.
_Avoid_: observation (we don't use point observations; the truth is a gridded field). "ERA5-Land" alone (it lacks precipitation).

**Reanalysis**:
A backward-looking model rerun that assimilates all available observations into a consistent gridded history. The basis for the truth field. Distinct from a forecast (which is forward-looking) and from an analysis (which is just the assimilated initial-condition snapshot at one moment).

**Bias**:
Signed mean error (forecast minus truth) over a window. Positive bias = forecast ran warm / wet / fast; negative bias = ran cold / dry / slow. Reveals systematic over/under-prediction.
_Avoid_: error (too generic), drift.

**MAE**:
Mean absolute error over a window. The magnitude of being wrong, regardless of direction. Sibling of bias, not a replacement.

**Hit / Miss / False alarm / Correct dry**:
Per-hour categorical outcomes for precipitation, with a ±1 h timing tolerance:

- **Hit** — forecast says wet AND truth is wet (within tolerance).
- **Miss** — truth is wet AND no forecast wet hour within tolerance.
- **False alarm** — forecast says wet AND no truth wet hour within tolerance.
- **Correct dry** — both dry.

**Weather code on truth**:
Not provided. ERA5-Seamless has no WMO weather code, so the verification page shows no truth-side icon. The forecast-side icon was dropped too: it needed the single-runs `daily=` block, whose aggregation requires the run to start at 00:00 in the requested timezone — unsatisfiable for our UTC run cycles (00/06/12/18Z) at a location-local timezone. A code was also deliberately never derived from precipitation + cloud + temperature — that would score the forecast against our own derivation rule, not against truth.

**Timing score**:
The "did rain fall at roughly the right time, without crying wolf?" score, as the **Critical Success Index** (threat score) `hits / (hits + misses + false_alarms)` — so it penalises both missed rain and false alarms, not just misses. `NaN` only when nothing happened on either side (all correct-dry). Supersedes the earlier "timing hit rate" (a bare hit rate / POD that ignored false alarms — see ADR 0002).
_Avoid_: timing hit rate, POD (the metric it replaced).

**Amount error** _(precipitation only)_:
Signed daily-sum forecast minus daily-sum truth, in mm. The "was the total roughly right?" score per day. Distinct from MAE; coexists with the timing score.

### Per-model scoring

**Daily breakdown**:
The per-day cards on the verification page. Scores the **aggregate** against truth and pairs each day's measured error with that day's per-variable **predictability** — the calibration lens, and the page's core purpose. Aggregate-only: per-model detail lives in the scorecard, not here.

**Per-model scorecard**:
The table scoring each **Model** (and the **Aggregate**, ranked inline) over the full run window, sorted by composite score. The per-model lens, as opposed to the aggregate-per-day daily breakdown. Carries no predictability — predictability is defined only over the aggregate (see "Predictability"). An **Aggregate (legacy)** row — the superseded pre-ADR-0011 hand-tuned decay recipe (`domain/legacyWeighting`, a verification-page comparator only, never a production weight path, and temporary: slated for removal once confidence in the fitted ladder is established) — is always scored inline, and when the location has stored tuned weights (training page) a second **Aggregate (tuned)** row joins it. Whenever any such comparator is present the shipping-weights row is relabelled **Aggregate (default)**, for a direct comparison. Bare "Aggregate" elsewhere (the chart, the forecast page) means whichever weighting is currently active — so every aggregate row is qualified here to avoid overloading the term.

**Composite score**:
A single 0–100 number blending a model's temperature MAE, precip amount error and precip timing score over a scope — each mapped to a 0..1 goodness against a _fixed per-variable reference scale_ (cf. typical spread) and averaged with equal per-metric weight, so precipitation carries ~⅔. Computed per model over the full window and per lead-time band. A deliberate collapse, kin to the under-review _overall predictability_; see ADR 0004.
_Avoid_: skill (a skill score is improvement over a reference like climatology — this is not that), accuracy (too vague).

**Lead-time band**:
A coarse lead-hour bucket (0–48 h / 48–96 h / 96–168 h / 168–240 h) the scorecard scores separately, exposing how a model's composite decays with lead time. Empty bands read as coverage gaps. Also the bucketing of the **calibration curve** — one curve per band, because lead-time error climatology dominates forecast error and a single all-lead curve would bake the typical-spread heuristic's biases into the published probability (ADR 0008) — and of the **weight ladder**'s fitted multipliers (ADR 0011). The one partition, shared by all three consumers; the 7–10d band exists because the forecast page shows 10 days and only the long-range models reach it.

**Coverage**:
The hours a model actually returned data for within the window — a runtime fact (retention varies per model and run date). Sub-full-coverage models are flagged `*` and still ranked; their empty lead bands show the gap. Distinct from **Available models**, which is the binary did-it-return-anything set.

### Training

**Trained weights**:
Per-model weight **multipliers** fitted from a location's stored verification sample (ADR 0007), persisted on-device and applied to the aggregate only when the user opts in via the settings toggle. The device tier of the **weight ladder**: fitted as residuals on top of the **default weights**, one multiplier per model — _not_ per band; the per-band device variant failed its pre-registered gate (ADR 0011) and was rejected. A multiplier of 1 leaves the tier below unchanged. **Training** is the act of fitting; **trained weights** are the stored result. The per-model scorecard scores these as the **Aggregate (tuned)** row.
_Avoid_: _training weights_ (blurs the act and the result); _tuned weights_ as a separate concept (it is the same thing — "tuned" survives only in the scorecard's **Aggregate (tuned)** row label).

**Default weights**:
The shipped per-model, per-band weight multipliers fitted offline from verification samples at the reference locations (the ADR 0010 pattern applied to weights; ADR 0011). Always on — they are the app's lead-time weighting, replacing the earlier hand-tuned per-class decay curves. Models the offline fit has never seen (open-meteo archives a new model only from its addition date) resolve to their **model class**'s fitted multipliers instead.
_Avoid_: _global weights_ (reads as "fitted for the globe" — it is a reference-location default, not a per-place fit); _decay_ for the fitted multipliers (the curve-shaped hand-tuned mechanism is gone; bands and multipliers are the vocabulary).

**Weight ladder**:
The resolution order for one model's weight multiplier in one **lead-time band**: **default weights** (per-model → per-class → 1, each band resolving independently), multiplied by the device **trained weights** residual where the user opted in. The weights sibling of the calibration curve's fallback ladder — same shape, same honesty rule: lower tiers are broader claims.
_Avoid_: conflating with the calibration ladder (same pattern, different signal).

**Training location**:
The gridded location whose stored sample a fit was computed from — and the center of any **reach**. The training page is scoped to one training location at a time; the trained-weights overview at the bottom lists every training location stored on the device.

**Reach** (or **reach radius**):
The distance around a **training location** within which its **trained weights** also apply to other locations. Uniform within the radius, hard cutoff at the edge — no distance falloff. The default is _this point only_ (no reach: the weights apply solely to the training location's own grid cell). Resolution precedence when several sources could apply: a location's own exact-cell fit always wins; otherwise the nearest training location whose reach covers the point.
_Avoid_: **coverage** (taken — it means temporal data availability, see "Coverage") and **region** (taken — a model's structural-advantage box, see "Home region") for this spatial concept; reserve **reach** for it.

## Flagged ambiguities

**"Predictability" / "probability" / "agreement".**
Three neighbouring terms; keep them apart. **Probability** is _initial-condition_ uncertainty — many perturbed runs of one model (an ensemble), read as a calibrated "% chance" that verifies at its stated rate. meteocompare surfaces a genuine one only via the `precipitation_probability` graft, and never computes one from ensemble members. **Predictability** (the industry's headline reliability signal, which we adopt) is the broad trust signal — verification-calibrated where a calibration curve exists (see "Calibrated predictability"), an _uncalibrated, agreement-based_ estimate everywhere else (see "Raw predictability" and ADR 0005). **Agreement** is the _mechanism_ — how much different models disagree at one run (inter-model spread) — and is what raw predictability is computed from. Raw predictability is blind in two ways: models that share lineage or bias can agree and all be wrong (high predictability, low accuracy — see the example dialogue), and a chaotic, initial-condition-sensitive situation reads as calm because we run no ensemble; the calibration curve corrects the published _rate_ for these blindnesses on average, but cannot restore per-day discrimination the spread signal doesn't carry. In UI copy, reserve the word **probability** for the precip graft; describe calibrated predictability by its reference class ("N of 10 forecasts like this…") rather than calling it a probability, even though it is one in the technical sense; say **agreement** or **spread** for the raw mechanism.

**"Calibration hit" vs "Hit".**
A **calibration hit** is the day-level "close enough" outcome the calibration curve counts (≤2 °C / correct wet-dry call). A **Hit** is the per-hour precipitation timing outcome (wet forecast matching wet truth within ±1 h). The hourly Hit feeds the timing score; the calibration hit feeds predictability. Never shorten "calibration hit" to "hit".

**"Predictability", unqualified.**
The per-variable primitive (one number per variable per timestep) lives in the domain layer and is what the verification page exposes. The single-number "overall predictability" shown on the forecast view's badge is the minimum of the temperature and precipitation per-variable values (ADR 0009). Always say _per-variable predictability_ or _overall predictability_ when the distinction matters, and _raw_ or _calibrated_ when the state matters.

**"Analysis".**
In meteorology, the **analysis** is a model's initial-condition field after assimilating observations — _not_ a verification activity. The user-facing analysis-comparison surface in this app is therefore called **Verification**, never "Analysis". The route is `/verify`, not `/analyze`.

**"Model".**
Always refers to an NWP source (ECMWF, GFS, ICON, etc.), never to a UI/data shape or a domain type. When you mean a TypeScript type, name it explicitly (`ModelDef`, `ModelRow`).

**"Calibration".**
Three unrelated things have worn this word; keep them apart. **Bias correction** — adjusting forecast _values_ against past error — is what the README's "No bias correction" limitation means; the app still does none (trained weights reweight models, they don't correct values). **Predictability calibration** — whether a stated 0.7 actually verifies ~70% of the time — is now implemented as the **calibration curve** (ADR 0008); the verification page remains its standing sanity check (per-variable predictability shown beside the measured error). The reference values that normalise raw spread are **typical spread**, never "calibration". Reserve the bare word "calibration" for predictability calibration.

## Example dialogue

> **Dev:** I'm seeing the aggregate score worse than ECMWF on this day card. Bug?
>
> **Domain:** Probably not. What's the bias for ECMWF specifically?
>
> **Dev:** +1.8 °C. Aggregate bias is +0.4 °C, MAE 1.1 °C.
>
> **Domain:** Right — ECMWF ran warm that day, but it was the only model in the aggregate with a positive bias. The aggregate pulled toward zero bias but spent some MAE doing it. That's exactly what an aggregate is supposed to do.
>
> **Dev:** And the per-variable predictability on that point was high?
>
> **Domain:** Yes — high agreement, low spread. Which is honest: the models _did_ agree, they were just all wrong in the same direction. Predictability measures agreement, not correctness — that's exactly why it can read high while the forecast is wrong. The verification page exists to make that distinction visible.
>
> **Dev:** What about the timing score? It says 40% — that's bad, right?
>
> **Domain:** Within ±1 h tolerance, yes. Look at the per-hour strip — if you see a lot of false alarms clustered around noon, the models all predicted a midday shower that never arrived (or arrived three hours later). Those false alarms drag the score down now, not just the misses. The amount error might still be near zero in that case. That's why timing and amount are separate scores.
