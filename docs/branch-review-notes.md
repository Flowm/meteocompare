# Data integrity changes

## Stored calculations

Gather new samples and retrain device weights after this update. The app ignores older analysis records, including ladder-era version 2 fits and version 3 fits that used stale built-in weights. It leaves their stored payloads intact. The ignored fits no longer influence forecasts or appear in the training overview.

Built-in weights and calibration also require the current analysis version. The app ignores incompatible defaults and uses its existing fallback behaviour. Regenerate weights before calibration. Offline evaluation caches include the built-in weight recipe, so calibration cannot reuse aggregates from an earlier weight fit.

## Location search

The search indicator includes the debounce interval. Selecting a saved location clears the query and cancels pending search work. These changes prevent stale results from remaining visible after a selection.
