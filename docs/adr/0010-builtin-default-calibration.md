# Ship a built-in default calibration fitted from global reference locations

The calibration ladder (ADR 0008) left untrained devices on the raw heuristic —
and the raw day-card values turned out to be actively misleading there: the
hand-picked hourly typical-spread bands are much tighter than real multi-model
spread, so temperature raw scores floor near 0 at short lead and _rise_ with
lead time, inverting the true ordering. Rather than wait for every user to
train, we ship a **built-in default calibration**: curves fitted offline from
verification samples gathered at a set of climatically diverse reference
locations worldwide, baked into the bundle, and slotted into the ladder as a
third tier — location fit → device-pooled → **built-in default** → raw
identity. Untrained devices get honest, outcome-anchored percentages out of the
box; anything the user trains locally still wins per (variable, lead band).

## Status

accepted — extends ADR 0008's ladder.

## Decision

- **Fitting**: `scripts/fit-default-calibration.ts` reuses the production path
  byte-for-byte (`gatherRuns → evaluateRun → calibrationPoints →
  fitCalibrationSet`) over ~12 reference locations spanning alpine, maritime,
  continental, tropical and southern-hemisphere climates, with run dates spread
  across the single-runs archive's retention window so both hemispheres'
  seasons contribute. The output is a generated TypeScript module
  (`src/analysis/defaultCalibration.ts`) with fit metadata; regenerate by
  re-running the script.
- **Provenance is carried on the curve** (`source: "builtin"`) and surfaced in
  the UI: built-in rows say "at reference locations worldwide", device-fitted
  rows keep the local claim. The badge tier scale treats both as calibrated —
  both are verified frequencies, they just answer for different reference
  classes.
- **Ladder position**: below the device tiers. A location fit and the device
  pool reflect the user's actual places; the global default is the floor above
  the raw heuristic, which remains the final identity fallback (unverified
  variables, hourly surfaces, and any band the default fit couldn't gate).

## Considered Options

- **Fix the typical-spread bands instead** — re-anchoring the heuristic's
  normalization empirically. Still worth doing (tracked separately); but it
  only makes the raw score better-scaled, not outcome-anchored, and the two
  fixes compose: better raw scores make every calibration curve's input more
  discriminating.
- **Per-climate-zone defaults** (e.g. Köppen-keyed curve sets) — richer, but
  needs many more reference locations per zone to clear the per-band data gate,
  and zone lookup adds complexity. The literature says the raw→P mapping is
  only second-order location-dependent once lead time is a dimension; one
  global set is the right first step. Revisit if verification pages show the
  default badly miscalibrated somewhere.
- **Fetch defaults from a CDN at runtime** — keeps the bundle static across
  refits, but adds a network dependency and a stale-cache axis to a
  frontend-only app for a payload of a few hundred bytes. Baking wins.

## Consequences

- The shipped curves encode the reference period's weather; they should be
  regenerated occasionally (the metadata records locations, window, and
  per-band sample counts).
- A location climatically unlike every reference location gets a default that
  is calibrated *on average* but possibly biased for it — still strictly more
  honest than the raw heuristic, and the verification page exposes any gap.
- The "uncalibrated" state effectively disappears from daily temperature and
  precipitation badges; the raw heuristic remains visible on hourly surfaces
  and unverified variables.
