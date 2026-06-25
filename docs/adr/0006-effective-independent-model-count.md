# Effective independent-model count for the predictability factor

The predictability model-count factor previously scaled with the _raw_ number of
contributing models (1→⅓, 2→⅔, 3+→1), treating every model as an independent
vote. The registry is not independent: it holds four ICON variants, five
HARMONIE-AROME CAMs built on Météo-France's AROME, three UK Unified Model
products (UKMO, BOM ACCESS, KMA), ECMWF IFS plus its AIFS, and NOAA GFS plus
GraphCast / AI-GFS / the GEFS mean. Relatives share systematic errors, so they
agree for reasons other than the weather being predictable — inflating
predictability exactly when the agreement is least independent.

We assign each model a lineage **family** (shared dynamical core, or shared
initial-condition / training analysis) in `models.ts` and compute an **effective
model count** — the first member of each family counts fully, each additional
sibling adds only `SIBLING_CREDIT` (0.25) — which now feeds `modelCountFactor`
in `predictability.ts` in place of the raw count.

## Status

accepted

## Considered Options

- **Raw count (status quo)** — simple, but treats four ICON variants as four
  independent corroborations; rejected.
- **Hard dedup (one vote per family)** — discards all within-family signal, but
  siblings at different resolutions / domains do add _some_ information; too blunt.
- **Effective count with partial sibling credit (chosen)** — first family member
  counts fully, each sibling adds `SIBLING_CREDIT`. One tunable constant, smooth
  behaviour.

## Consequences

- **Predictability is capped lower when contributors cluster in few families.**
  Only the four ICON variants present → effective 1.75 → factor 0.58 (was 1.0).
  A lineage-diverse roster still saturates the factor at 1.
- **Family assignments are judgment calls**, especially for AI products (grouped
  with the analysis they are initialised from / trained on: AIFS↔IFS;
  GraphCast / AI-GFS / GEFS-mean↔GFS). They live as data in `models.ts` and are
  meant to be tuned; `SIBLING_CREDIT` is a single knob. A test asserts every
  registered model is assigned a family, so a new model can't silently count as
  independent.
- **Scope: predictability only.** The aggregate weighting is unchanged — each
  sibling still gets its vote in the blend. Down-weighting siblings in the
  weights themselves is a possible future extension.
- **First concrete step toward the ADR 0005 "direction of travel":**
  predictability that reflects independent corroboration, not member count.

See also ADR 0005 (predictability framing).
