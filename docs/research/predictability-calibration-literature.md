# Predictability & probability in weather forecasting — literature digest

Research digest gathered 2026-07-10 to ground the calibrated-predictability
design (ADR 0008, ADR 0009). Sources favour AMS journals, ECMWF, NOAA/NWS, NRC,
and the peer-reviewed postprocessing literature. Kept verbatim-dense on purpose:
this is the audit trail for the parameter choices, not prose.

## 1. The spread–skill relationship: how well does spread predict error?

**Core result: spread is a real but weak *per-case* predictor of error; it is a
good *aggregate* predictor.** The canonical reference is Whitaker & Loughe
(1998, *Mon. Wea. Rev.* 126, 3292–3302,
https://journals.ametsoc.org/view/journals/mwre/126/12/1520-0493_1998_126_3292_trbesa_2.0.co_2.xml):

1. **Even a perfect ensemble need not show high spread-error correlation.** The
   achievable correlation is bounded by the day-to-day variability of spread
   itself: if spread barely varies from case to case (relative to its mean),
   the correlation is necessarily near zero *even when the ensemble is
   perfectly calibrated*.
2. Correlation is larger where/when the **temporal variability of spread is
   large**.
3. Spread is most informative **when it is extreme** — very large or very small
   vs. its climatological value. Mid-range spread carries little
   case-discriminating information.

**Concrete magnitudes.** Hopson (2014, *Mon. Wea. Rev.* 142(3), "Assessing the
Ensemble Spread–Error Relationship",
https://journals.ametsoc.org/view/journals/mwre/142/3/mwr-d-12-00111.1.xml;
ECMWF slides
https://www.ecmwf.int/sites/default/files/elibrary/2007/15443-verifying-relationship-between-ensemble-forecast-spread-and-skill.pdf)
reports, for ECMWF precipitation forecasts over the Brahmaputra: **spread-error
correlation r = 0.36, while the perfect-model ceiling for that same system was
only r = 0.49**. The maximum attainable correlation depends on a governing
ratio g = ⟨s⟩²/(⟨s⟩²+var(s)); as g→1 (constant spread) the ceiling is 0.
Hopson's conclusion: if that ratio → 1.0, a fixed "climatological" error
distribution may be a far cheaper estimate of forecast error — and in his case
a heteroscedastic statistical error model *beat* ensemble spread at short
leads.

**Recommended diagnostics** (Hopson 2014; Grimit & Mass 2007, *Wea.
Forecasting*, "Measuring the Ensemble Spread–Error Relationship with a
Probabilistic Approach",
https://www.researchgate.net/publication/249621386): don't use raw Pearson
spread-error correlation; use **binned spread-skill plots** (bin cases by
spread decile, average error per bin, compare to the 1:1 line) and normalized
skill against no-skill/perfect-model references. A perfect ensemble's *binned*
curve approaches the 1:1 line even when its per-case correlation is ~0.4.

**Regional/seasonal caveats.** Scherrer et al. (2004, *Wea. Forecasting* 19,
552, ECMWF EPS over Europe,
https://journals.ametsoc.org/view/journals/wefo/19/3/1520-0434_2004_019_0552_aotsru_2_0_co_2.xml)
and the COSMO-LEPS study (Salmi/Marsigli, COSMO Newsletter 11,
https://www.cosmo-model.org/content/model/documentation/newsLetters/newsLetter11/4_salmi.pdf):
spread-error relationship decent for T850 in summer, **poor in autumn at
+24 h**, improves with lead (day 4+); spread systematically **underestimates
error at short leads** (under-dispersion — the norm for raw ensembles; Hamill
2001 on rank histograms). Mid-range spread bins showed error and spread
essentially uncorrelated; strong geographic dependence.

**ECMWF's operational stance** (Forecast User Guide §8.1.2,
https://confluence.ecmwf.int/display/FUG/Section+8.1.2+ENS+Mean+and+Spread):
larger spread implies larger expected error of the ensemble mean, with strong
RMSE–spread correlation when aggregated across lead times; ECMWF normalizes
current spread by the **last 30 days' spread at the same lead time** — the
same role our per-lead "typical spread" denominator plays.

## 2. Multi-model (poor man's) ensembles vs. proper ensembles

**Multi-model deterministic spread is a legitimate, literature-backed
uncertainty proxy.** Ebert (2001, *Mon. Wea. Rev.* 129, 2461, "Ability of a
Poor Man's Ensemble to Predict the Probability and Distribution of
Precipitation",
https://journals.ametsoc.org/view/journals/mwre/129/10/1520-0493_2001_129_2461_aoapms_2.0.co_2.xml):
a 7-model deterministic PME over Australia (28 months) produced **useful
probabilistic precipitation forecasts, with skill saturating at ~7 independent
models**. Also: the plain multi-model mean over-predicts rain area and kills
intensity maxima (fixed via probability matching).

**Superensemble line.** Krishnamurti et al. (1999, *Science* 285, 1548,
https://www.science.org/doi/10.1126/science.285.5433.1548; review 2016, *Rev.
Geophys.*, https://agupubs.onlinelibrary.wiley.com/doi/full/10.1002/2015RG000513):
regression-weighted multi-model combinations beat every individual model and
the unweighted mean — supports verification-learned per-model weights.

**But a multimodel does not automatically beat the best single system.**
Hagedorn et al. (2012, *QJRMS* 138,
https://rmets.onlinelibrary.wiley.com/doi/10.1002/qj.1895): a 9-system TIGGE
multimodel **did not beat ECMWF ENS alone** for 2m/850hPa temperature; a
4-best-system multimodel did; **statistically calibrated ECMWF alone matched or
beat the multimodel**. Hamill (2012, *Mon. Wea. Rev.* 140, 2232,
https://journals.ametsoc.org/view/journals/mwre/140/7/mwr-d-11-00220.1.xml)
found similar for CONUS precipitation. Lesson: quality-weight; calibration
beats adding mediocre models.

**Shared lineage / effective ensemble size.** Pennell & Reichler (2011, *J.
Climate* 24, 2358, "On the Effective Number of Climate Models",
https://journals.ametsoc.org/view/journals/clim/24/9/2010jcli3814.1.xml): **24
CMIP3 models behaved like ~7.5–9 independent models** due to correlated errors.
Kuma et al. (2023, *JAMES*, "Climate Model Code Genealogy",
https://agupubs.onlinelibrary.wiley.com/doi/abs/10.1029/2022MS003588) traced
this to shared code/schemes across ~12 families; within-family error
correlations ~0.65 vs ~0.5 cross-family. Applies verbatim to NWP (GFS-driven
downscales, IFS-initialized LAMs, AI models trained on ERA5/IFS analyses).
Validates the effective-model-count lineage discount (ADR 0006); N_eff ≈
N/(1+(N−1)·r̄) per family cluster is a reasonable frame; skill saturates near
~7 effective members (Ebert 2001).

## 3. Calibration methods: spread → probability

**Standard toolbox.** EMOS/NGR (Gneiting et al. 2005, *Mon. Wea. Rev.* 133,
1098, https://journals.ametsoc.org/view/journals/mwre/133/5/mwr2904.1.pdf);
BMA (Raftery et al. 2005); logistic regression on ensemble statistics for
binary events; reliability diagrams for diagnosis; Platt scaling vs. isotonic
regression on the ML side.

**Sample-size requirements (the numbers that sized our design):**

- **Isotonic regression needs ~1000+ points to beat sigmoid/Platt scaling;
  below that it overfits** (Niculescu-Mizil & Caruana 2005, ICML,
  https://www.cs.cornell.edu/~alexn/papers/calibration.icml05.crc.rev3.pdf;
  scikit-learn calibration guide,
  https://scikit-learn.org/stable/modules/calibration.html). At 100–300 points:
  jagged, overconfident steps. Mitigations: **fixed few-bin binning (4–6 bins,
  ≥30–50 points/bin) with Beta/Laplace smoothing toward the base rate**, PAVA
  across the smoothed bins, or a 2-parameter logistic.
- **EMOS training lengths in operations are 20–40 day sliding windows**
  (Gneiting 2005 used 40; CRPS minima at ~25–51 days; Baran & Lerch,
  https://arxiv.org/pdf/1312.3763). Rule of thumb: **~10 forecast cases per
  fitted parameter**.
- **Seasonal nonstationarity is first-order**: sliding windows exist because
  error statistics drift with season; alternatives are day-of-year harmonics in
  the calibration (https://arxiv.org/pdf/1912.11827). Wessel et al. (2024,
  *QJRMS*, "Lead-time-continuous statistical postprocessing",
  https://rmets.onlinelibrary.wiley.com/doi/10.1002/qj.4701): enlarging
  training windows beyond ~25 days *hurt* because seasonal heterogeneity
  entered the training set.
- Landry et al. (2024, *Mon. Wea. Rev.* 152,
  https://journals.ametsoc.org/view/journals/mwre/152/9/MWR-D-23-0273.1.xml;
  https://arxiv.org/html/2406.02141): **a learned error climatology conditioned
  on station + lead time + forecast values recovers most probabilistic skill
  with no spread input at all** — lead-time/location error climatology carries
  the bulk of the information; per-case spread is a real but second-order
  increment.

**Pitfalls:** isotonic overfitting at small N; reliability diagrams need
≥~20–50 cases/bin; serial correlation of daily verification points (effective
N ≈ 0.5–0.7× nominal for temperature); base-rate drift (wet-day frequency
varies seasonally — trivial "dry" calls inflate P(correct) in dry seasons);
truth error (ERA5 is a model product — treat P(hit) as "vs ERA5").

## 4. How providers communicate confidence to lay users

- **ECMWF**: spread charts + normalized spread vs. last-30-days M-climate (FUG
  §8.1.2); historical categorical **Forecast Confidence Index** from EPS spread
  (1999 tech memo,
  https://www.ecmwf.int/sites/default/files/elibrary/1999/8619-forecast-confidence-index-derived-ensemble-prediction-system.pdf).
- **NWS**: experimental confidence products with **three tiers** (e.g. Hanford,
  https://www.weather.gov/hnx/certainty.html); words anchored to numbers —
  **Watch ≈ 50% confidence, Warning/Advisory ≈ 80%**
  (https://www.weather.gov/box/criteria); NBM communicates 10th/90th percentile
  ranges (https://www.weather.gov/fsd/etforecasts). NOAA "Conceptualizing
  Confidence": https://repository.library.noaa.gov/view/noaa/60569/noaa_60569_DS1.pdf.
- **Met Office**: severity × likelihood matrix (4 likelihood levels).
- **yr.no**
  (https://hjelp.yr.no/hc/en-us/articles/4402772811026-Weather-forecasts-and-uncertainty):
  10–90 percentile shaded temperature bands; precipitation as min–max
  intervals. Best consumer-app precedent: uncertainty as a *range on the
  displayed quantity*.
- **NRC "Completing the Forecast" (2006,
  https://www.nationalacademies.org/read/11699/chapter/6)**: numeric
  probabilities beat verbal labels (words like "possible" span most of the
  probability spectrum); endorses confidence intervals/skill scores per
  variable; consistency across products is critical.
- **PoP misunderstanding**: Gigerenzer et al. (2005, *Risk Analysis*); Morss,
  Demuth & Lazo (2008, *BAMS*); Juanchich & Sirota
  (https://repository.essex.ac.uk/17012/): **>50% of the public misreads PoP**
  as % of time or area; root cause is a **missing reference class**.
  Comprehension improves when the event is stated explicitly next to the number
  ("70% chance of at least 1 mm of rain at this location tomorrow"). Burgeno &
  Joslyn ("Not as gloomy as we thought",
  https://www.researchgate.net/publication/329563436) soften this — decisions
  are often sensible anyway — but the design advice stands: **define the event,
  in words, next to the number.**

## 5. Verification targets and thresholds

- **|T error| ≤ 2 °C is a defensible, industry-standard "good forecast"
  tolerance** (e.g. OpenWeather reliability definition,
  https://openweathermap.medium.com/accuracy-and-quality-of-weather-data-f63d072fa54).
  NWS MOS max-T MAE runs ~2–4 °F days 1–4, 5–6 °F days 5–8
  (https://www.weather.gov/media/crh/publications/ARP/arp26-02.pdf) — ±2 °C
  (≈3.6 °F) sits in the discriminating range: expect hit rates ~85–90% (day 1)
  falling to ~50–60% (day 7+), which is the calibration's dynamic range.
- **Wet-day threshold: ≥1 mm/day is the WMO/ETCCDI standard**
  (https://etccdi.pacificclimate.org/list_27_indices.shtml). 0.1 mm is used by
  some services (DWD "Niederschlagstag") but is at detection noise — **ERA5
  notoriously drizzles**, so 0.1 mm against ERA5 truth would classify far too
  many days wet.
- **Brier score**: report as **Brier Skill Score vs. the climatological base
  rate** (sample wet-day frequency); decompose reliability/resolution when N
  permits (WWRP/Stanski verification guide,
  https://www.cawcr.gov.au/projects/verification/Stanski_et_al/VerificationSWBPart2.pdf).
  At N=100–300, BSS vs local climatology is the honest headline metric for the
  wet/dry calibration.

## 6. Design implications adopted (see ADR 0008 / 0009)

Validated: multi-model deterministic spread as uncertainty proxy; per-lead
typical-spread normalization (mirrors ECMWF Nstd); lineage discount; monotone
raw→P(hit) recalibration; ±2 °C and ≥1 mm/day targets; per-location fit with
pooled fallback.

Challenged and adopted as changes: **per-lead-band curves** (not one global
map); **few-bin smoothed fit, not raw isotonic**; tempered expectations for
mid-range discrimination; tiers anchored to NWS conventions (≥0.8 / ≥0.5).

Noted for later: excluding persistently bad models from the spread (not just
down-weighting the mean); warm/cold-season split once a location exceeds ~200
points; BSS-vs-climatology as the calibration health metric; effective-N cap
near ~7.
