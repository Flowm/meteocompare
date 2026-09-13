# ERA5-Seamless as the sole ground truth for verification

The verification page needs a reference field to score past forecasts against. Open-meteo's historical-weather API offers several candidates — the **Best Match** default (IFS HRES + ERA5 + ERA5-Land merged seamlessly), **ERA5-Seamless** (ERA5 + ERA5-Land merged, no IFS), bare **ERA5-Land** (~9 km, no precipitation/wind/weather_code), and bare **ERA5** (~25 km, full variable coverage). We pick **ERA5-Seamless exclusively, with no user-facing choice** (request the historical-weather API with `models=era5_seamless`).

Best Match is rejected for the same reason ECMWF IFS analysis is: it includes IFS HRES, and verifying ECMWF IFS _forecasts_ against any reanalysis derived from IFS HRES is the textbook self-verification trap (the analysis is the model's own next-cycle initial condition after assimilating observations, so ECMWF looks unrealistically good). Bare ERA5-Land is rejected because it lacks precipitation, wind, and weather_code — the variables verification cares most about. Bare ERA5 is rejected because its 25 km grid is too coarse to fairly score the 1–3 km CAM models in the registry (HRRR, ICON-D2, etc.) on temperature. ERA5-Seamless resolves all three: temperature is served from ERA5-Land at 9 km, precipitation falls back to ERA5 at 25 km (the only available option), and IFS HRES never enters the truth field.

The original picker limit was `today − 12`: seven forecast days plus an assumed five-day ERA5 delay. The amendment below supersedes that limit. Not offering a user-facing truth-source picker is deliberate: it would mostly enable methodologically junk comparisons (Best Match's IFS contamination) and the residual ECMWF-favouring bias from ERA5-Seamless's shared ECMWF lineage at the model-development level is well-understood and small compared to a direct IFS-vs-IFS comparison.

## Amendment: complete truth windows (2026-09-13)

The latest permitted run date reserves the forecast horizon plus six days that cover truth publication and the safety margin. Single-run verification uses seven forecast days, so its latest run date is `today − 13`. Training uses ten forecast days, so its latest run date is `today − 16`. These are UTC dates. The default selection is one day older than the latest permitted date.

Truth requests use GMT so their hourly timestamps align with the UTC run grid, including locations with fractional time offsets. The chart converts solar timestamps to the forecast response's clock for display.
