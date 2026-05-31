# MeteoCompare

Multi-model weather forecast comparison. The app pulls operational forecast products from many models via open-meteo, weights them, and produces a single aggregate forecast plus a per-timestep confidence score. A secondary verification surface compares past forecasts against a reference reanalysis field to expose which models (and the aggregate) were actually right.

## Language

### Models & runs

**Model**:
A specific forecast product exposed by open-meteo, e.g. ECMWF IFS HRES, DWD ICON-EU, or ECMWF AIFS. One logical model per row in `src/domain/models.ts`.
_Avoid_: provider, source, dataset.

**Probability graft**:
open-meteo derives `precipitation_probability` only from ensembles, so deterministic models return null for it. Where a model has an ensemble-backed _seamless_ sibling, we fetch that sibling solely for the probability variable and read its series under the registered model's id — the _graft_. Today `icon_seamless` is grafted onto DWD ICON (`icon_global`). The **graft source** (`icon_seamless`) is never a Model: no registry row, no chip, no aggregate vote of its own; it supplies one variable under the host model's identity and weight. Note we consume open-meteo's _derived_ probability, never raw ensemble members (see "Aggregate").
_Avoid_: registering a graft source as a Model.

**Model class**:
Resolution/product-and-scope tier: `global`, `regional-mid`, `regional-cam` (convection-allowing), `ai` (machine-learned single forecast product), or `ensemble-mean` (mean of ensemble members exposed as one forecast product). Drives lead-time decay, the precipitation (amount + probability) boost, and how strongly a model contributes relative to deterministic NWP products.

**Home region**:
The geographic bounding box where a regional model has a structural advantage. Drives the region bonus inside the weighting recipe. Global models have no home region.

**Run**:
A single forecast cycle issued by a model at a specific datetime, e.g. "the GFS run from 2026-05-11 00:00 UTC". Runs are the unit identified by the single-runs API.

**Run date**:
The date component of a run. By app convention, every run on the verification page is 00Z, so a date alone uniquely identifies one.
_Avoid_: issue date, cycle date.

**Lead time**:
Hours elapsed since run start. A value forecast 36 h into the future has lead time 36 h. Drives lead-time decay in the weighting recipe.

**Available models**:
The subset of registered models for which the single-runs API actually returned data for a given run date. Retention varies per model, so this is a runtime fact, not a static list.

### Aggregation

**Aggregate**:
The weighted ensemble of contributing models at a timestep — the app's primary forecast surface. Computed by `aggregateSeries` in `src/domain/aggregate.ts`. Falls back to a circular mean for wind direction and a severity-weighted mode for weather codes.
_Avoid_: ensemble (overloaded with the ensemble-members concept we deliberately don't use), consensus.

**Contributing model**:
A model whose data is actually included in a particular aggregate point — i.e. one that passed the lead-time filter and returned a non-null value at that timestep. Distinct from "registered model".

**Spread**:
Weighted standard deviation across the contributing models at a timestep. Inputs to the confidence formula.

**Typical spread**:
Empirically chosen reference spread per variable per lead-time band, used to normalise raw spread into a 0..1 score. Defined in `confidence.ts`.

**Hourly series chart**:
The single shared hourly chart rendered on both the forecast and verification pages. It draws the aggregate for a selected variable (with its confidence band), optionally overlays the per-model lines, and — on the verification page — the truth series. One surface, configured per page.
_Avoid_: per-page names ("forecast chart", "verification chart", "compare-models chart"); these described the three separate charts that preceded it.

**Per-model overlay**:
The opt-in mode of the hourly series chart that draws one line per contributing model, overlaid on the aggregate. Secondary surface — the aggregate view is primary.
_Avoid_: spaghetti view, breakdown view (both used historically). "Spaghetti" specifically implies ensemble members, which we don't use (see "Aggregate"); "per-model overlay" is the term we keep.

### Confidence

**Confidence**:
A 0..1 score expressing how much to trust an aggregate value at a timestep, derived from inter-model spread normalised against typical spread, multiplied by a model-count factor. Computed per variable. When unqualified, refers to the per-variable primitive — see "Flagged ambiguities".

**Confidence tier**:
Categorical bucket of a confidence value: `high` (≥0.7), `mid` (≥0.4), `low` (<0.4).

**Overall confidence** _(forecast-view only, under review)_:
The single 0..1 number shown on the forecast view's confidence badge. Currently computed as the unweighted mean of per-variable confidences. Flagged for reconsideration once the verification page produces calibration evidence.

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
Not provided. ERA5-Seamless has no WMO weather code, so the verification page shows the forecast aggregate's weather icon but no truth-side icon. Deliberately not derived from precipitation + cloud + temperature — that would score the forecast against our own derivation rule, not against truth.

**Timing hit rate**:
Fraction of truth's wet hours classified as hits. The "did rain fall at roughly the right time?" score per day.

**Amount error** _(precipitation only)_:
Signed daily-sum forecast minus daily-sum truth, in mm. The "was the total roughly right?" score per day. Distinct from MAE; coexists with timing hit rate.

## Flagged ambiguities

**"Confidence", unqualified.**
The per-variable primitive (one number per variable per timestep) lives in the domain layer and is what the verification page exposes. The single-number "overall confidence" shown on the forecast view's badge is a UI-side unweighted-mean collapse of the primitive across three variables (temp, precip, weather*code). Always say \_per-variable confidence* or _overall confidence_ when the distinction matters.

**"Analysis".**
In meteorology, the **analysis** is a model's initial-condition field after assimilating observations — _not_ a verification activity. The user-facing analysis-comparison surface in this app is therefore called **Verification**, never "Analysis". The route is `/verify`, not `/analyze`.

**"Model".**
Always refers to an NWP source (ECMWF, GFS, ICON, etc.), never to a UI/data shape or a domain type. When you mean a TypeScript type, name it explicitly (`ModelDef`, `ModelRow`).

**"Calibration".**
Three unrelated things have worn this word; keep them apart. **Bias correction** — adjusting model weights against past performance — is what the README's "No bias correction" limitation means; the app does none. **Confidence calibration** — whether a 0.7 confidence actually verifies ~70% of the time — is what the verification page surfaces informally (per-variable confidence shown beside the measured error) and the "evidence" the under-review _overall confidence_ collapse is waiting on. The reference values that normalise raw spread are **typical spread**, never "calibration". Reserve the bare word "calibration" for confidence calibration.

## Example dialogue

> **Dev:** I'm seeing the aggregate score worse than ECMWF on this day card. Bug?
>
> **Domain:** Probably not. What's the bias for ECMWF specifically?
>
> **Dev:** +1.8 °C. Aggregate bias is +0.4 °C, MAE 1.1 °C.
>
> **Domain:** Right — ECMWF ran warm that day, but it was the only model in the aggregate with a positive bias. The aggregate pulled toward zero bias but spent some MAE doing it. That's exactly what an aggregate is supposed to do.
>
> **Dev:** And the per-variable confidence on that point was high?
>
> **Domain:** Yes — high agreement, low spread. Which is honest: the models _did_ agree, they were just all wrong in the same direction. Confidence measures agreement, not correctness. The verification page exists to make that distinction visible.
>
> **Dev:** What about the timing hit rate? It says 40% — that's bad, right?
>
> **Domain:** Within ±1 h tolerance, yes. Look at the per-hour strip — if you see a lot of false alarms clustered around noon, the models all predicted a midday shower that arrived three hours later. The amount error might still be near zero in that case. That's why timing and amount are separate scores.
