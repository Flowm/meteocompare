// Registry of NWP models we expose via open-meteo. Each `id` matches the
// `models=` value accepted by https://api.open-meteo.com/v1/forecast.
// The `seamless` variants let open-meteo auto-pick the highest-resolution
// component (e.g. AROME inside France, ARPEGE elsewhere) — we still treat
// the whole product as one logical "model" for the user. We avoid seamless
// variants that fall back to ECMWF outside their native availability region.

export type ModelKind = "global" | "regional-cam" | "regional-mid" | "ai" | "ensemble-mean";

/** Whether this model's runs are in open-meteo's single-runs archive (used for
 *  verification). Empirical, and only `never` gates behaviour: the single-runs
 *  client attempts every non-`never` model and prunes whichever runs the API
 *  reports missing for the chosen date (see omSingleRuns.fetchSingleRuns). The
 *  core/partial split is informational — retention is a drifting per-model
 *  window, so any model can age out if you scroll back far enough.
 *  - `core`: archived deep and reliably (ECMWF goes back to March 2024; most
 *    other models only to 2 April 2026 — see omSingleRuns.ARCHIVE_START_*).
 *  - `partial`: shallower or patchier retention, drops out of older batches.
 *  - `never`: not archived at all, excluded entirely.
 */
export type SingleRunAvailability = "core" | "partial" | "never";

export interface BBox {
  /** lat min, lat max */
  lat: [number, number];
  /** lon min, lon max */
  lon: [number, number];
}

export interface ModelDef {
  id: string;
  label: string;
  provider: string;
  kind: ModelKind;
  /** Approximate maximum useful lead time, hours. Past this the value returned
   *  by open-meteo may be from a lower-resolution fallback or null. */
  maxLeadHours: number;
  /** Geographic region where this model has a structural advantage.
   *  `null` for genuinely global models (ECMWF, GFS). */
  homeRegion: BBox | null;
  /** Short description shown in the per-model overlay UI. */
  description: string;
  /** Presence in open-meteo's single-runs archive (verification). See type docs. */
  singleRunAvailability: SingleRunAvailability;
}

export const MODELS: ModelDef[] = [
  {
    id: "ecmwf_ifs",
    label: "ECMWF IFS HRES",
    provider: "ECMWF",
    kind: "global",
    maxLeadHours: 240,
    homeRegion: null,
    description: "9 km global HRES; the medium-range gold standard.",
    singleRunAvailability: "core",
  },
  {
    id: "gfs_seamless",
    label: "NOAA GFS",
    provider: "NOAA",
    kind: "global",
    maxLeadHours: 384,
    homeRegion: null,
    description: "Seamless NOAA forecast, global long horizon with high-resolution U.S. coverage.",
    singleRunAvailability: "partial",
  },
  {
    id: "gem_seamless",
    label: "EC GEM",
    provider: "Environment Canada",
    kind: "regional-mid",
    maxLeadHours: 240,
    homeRegion: { lat: [25, 72], lon: [-170, -50] },
    description: "2.5–15 km seamless, strongest over North America.",
    singleRunAvailability: "never",
  },
  {
    id: "ukmo_seamless",
    label: "UKMO",
    provider: "UK Met Office",
    kind: "regional-mid",
    maxLeadHours: 168,
    homeRegion: { lat: [49, 61], lon: [-11, 2] },
    description: "2 km UKV over the British Isles, 10 km global.",
    singleRunAvailability: "core",
  },
  {
    id: "meteofrance_seamless",
    label: "Météo-France",
    provider: "Météo-France",
    kind: "regional-cam",
    maxLeadHours: 102,
    homeRegion: { lat: [41, 52], lon: [-5, 10] },
    description: "AROME (1.3 km) over France, ARPEGE globally.",
    singleRunAvailability: "core",
  },
  {
    id: "cma_grapes_global",
    label: "CMA GRAPES",
    provider: "CMA",
    kind: "global",
    maxLeadHours: 240,
    homeRegion: { lat: [15, 55], lon: [70, 140] },
    description: "15 km global; strongest over China and East Asia.",
    singleRunAvailability: "partial",
  },
  {
    id: "bom_access_global",
    label: "BOM ACCESS-G",
    provider: "BOM",
    kind: "global",
    maxLeadHours: 240,
    homeRegion: { lat: [-45, -10], lon: [110, 155] },
    description: "15 km, strongest over Australasia.",
    singleRunAvailability: "never",
  },
  {
    id: "jma_seamless",
    label: "JMA",
    provider: "JMA",
    kind: "regional-mid",
    maxLeadHours: 264,
    homeRegion: { lat: [24, 46], lon: [122, 146] },
    description: "GSM + MSM, strongest over Japan & nearby seas.",
    // jma_gsm ages out of the single-runs archive within a few weeks.
    singleRunAvailability: "partial",
  },
  {
    id: "kma_seamless",
    label: "KMA",
    provider: "KMA",
    kind: "regional-mid",
    maxLeadHours: 288,
    homeRegion: { lat: [33, 43], lon: [124, 132] },
    description: "1.5–13 km, strongest over the Korean peninsula.",
    singleRunAvailability: "partial",
  },
  {
    id: "icon_global",
    label: "DWD ICON",
    provider: "DWD",
    kind: "global",
    maxLeadHours: 180,
    homeRegion: null,
    description: "11 km global; strong all-rounder, 6-hourly updates.",
    singleRunAvailability: "core",
  },
  {
    id: "icon_eu",
    label: "DWD ICON-EU",
    provider: "DWD",
    kind: "regional-mid",
    maxLeadHours: 120,
    homeRegion: { lat: [29, 70], lon: [-23, 45] },
    description: "7 km regional, strongest over Europe.",
    singleRunAvailability: "core",
  },
  {
    id: "icon_d2",
    label: "DWD ICON-D2",
    provider: "DWD",
    kind: "regional-cam",
    maxLeadHours: 48,
    homeRegion: { lat: [43, 58], lon: [-3, 20] },
    description: "2 km convection-allowing over central Europe.",
    singleRunAvailability: "core",
  },
  {
    id: "knmi_harmonie_arome_europe",
    label: "KNMI Harmonie",
    provider: "KNMI",
    kind: "regional-cam",
    maxLeadHours: 60,
    homeRegion: { lat: [45, 58], lon: [-5, 16] },
    description: "2 km Harmonie AROME Europe without ECMWF fallback.",
    singleRunAvailability: "core",
  },
  {
    id: "dmi_harmonie_arome_europe",
    label: "DMI Harmonie",
    provider: "DMI",
    kind: "regional-cam",
    maxLeadHours: 60,
    homeRegion: { lat: [50, 65], lon: [-5, 20] },
    description: "2 km Harmonie AROME Europe without ECMWF fallback.",
    singleRunAvailability: "core",
  },
  {
    id: "metno_nordic",
    label: "MET Norway",
    provider: "MET Norway",
    kind: "regional-cam",
    maxLeadHours: 60,
    homeRegion: { lat: [55, 72], lon: [-5, 35] },
    description: "2.5 km Nordic forecast without ECMWF fallback.",
    singleRunAvailability: "partial",
  },
  {
    id: "meteoswiss_icon_seamless",
    label: "MeteoSwiss ICON",
    provider: "MeteoSwiss",
    kind: "regional-cam",
    maxLeadHours: 120,
    homeRegion: { lat: [45.5, 48.5], lon: [5.5, 11] },
    description: "1–2 km ICON seamless over Switzerland.",
    singleRunAvailability: "core",
  },
  {
    id: "geosphere_arome_austria",
    label: "GeoSphere AROME",
    provider: "GeoSphere Austria",
    kind: "regional-cam",
    maxLeadHours: 60,
    homeRegion: { lat: [46, 50], lon: [9, 18] },
    description: "AROME Austria without ECMWF fallback.",
    singleRunAvailability: "partial",
  },
  {
    id: "ecmwf_aifs025_single",
    label: "ECMWF AIFS",
    provider: "ECMWF",
    kind: "ai",
    maxLeadHours: 360,
    homeRegion: null,
    description: "0.25° AI forecast product from ECMWF.",
    singleRunAvailability: "core",
  },
  {
    id: "gfs_graphcast025",
    label: "NOAA GraphCast",
    provider: "NOAA",
    kind: "ai",
    maxLeadHours: 384,
    homeRegion: null,
    description: "0.25° GraphCast forecast based on NOAA inputs.",
    singleRunAvailability: "partial",
  },
  {
    id: "ncep_aigfs025",
    label: "NOAA AIGFS",
    provider: "NOAA",
    kind: "ai",
    maxLeadHours: 384,
    homeRegion: null,
    description: "0.25° AI-enhanced GFS forecast product.",
    singleRunAvailability: "partial",
  },
  {
    id: "ncep_hgefs025_ensemble_mean",
    label: "NOAA HGEFS mean",
    provider: "NOAA",
    kind: "ensemble-mean",
    maxLeadHours: 384,
    homeRegion: null,
    description: "0.25° ensemble-mean forecast product.",
    singleRunAvailability: "partial",
  },
];

export const MODEL_IDS: string[] = MODELS.map((m) => m.id);

const MODEL_INDEX: Record<string, ModelDef> = Object.fromEntries(MODELS.map((m) => [m.id, m]));

export function getModel(id: string): ModelDef | undefined {
  return MODEL_INDEX[id];
}

export function isInBBox(lat: number, lon: number, bbox: BBox): boolean {
  return lat >= bbox.lat[0] && lat <= bbox.lat[1] && lon >= bbox.lon[0] && lon <= bbox.lon[1];
}

/** 0..0.3 bonus when (lat,lon) sits inside the model's home region. */
export function regionBonus(model: ModelDef, lat: number, lon: number): number {
  if (!model.homeRegion) return 0;
  if (!isInBBox(lat, lon, model.homeRegion)) return 0;
  return model.kind === "regional-cam" ? 0.3 : 0.2;
}

/** Shared-lineage groups: models that share a dynamical core, or are initialised
 *  from / trained on the same analysis, also share systematic errors — so they
 *  are not independent votes. Used to discount near-duplicates in the
 *  predictability model-count factor (see effectiveModelCount and ADR 0006).
 *  AI products are grouped with the analysis they derive from. Assignments are
 *  approximate and tunable; keep in sync with MODELS (a test asserts coverage). */
const MODEL_FAMILIES: Record<string, readonly string[]> = {
  ifs: ["ecmwf_ifs", "ecmwf_aifs025_single"],
  gfs: ["gfs_seamless", "gfs_graphcast025", "ncep_aigfs025", "ncep_hgefs025_ensemble_mean"],
  icon: ["icon_global", "icon_eu", "icon_d2", "meteoswiss_icon_seamless"],
  um: ["ukmo_seamless", "bom_access_global", "kma_seamless"],
  arome: ["meteofrance_seamless", "knmi_harmonie_arome_europe", "dmi_harmonie_arome_europe", "metno_nordic", "geosphere_arome_austria"],
  gem: ["gem_seamless"],
  grapes: ["cma_grapes_global"],
  jma: ["jma_seamless"],
};

const FAMILY_OF: Record<string, string> = Object.fromEntries(Object.entries(MODEL_FAMILIES).flatMap(([family, ids]) => ids.map((id) => [id, family])));

export function familyOf(id: string): string | undefined {
  return FAMILY_OF[id];
}

/** Independent information each additional same-family sibling contributes beyond
 *  the first member of its family (0 = siblings add nothing, 1 = fully independent). */
const SIBLING_CREDIT = 0.25;

/** Effective independent-model count for a set of contributing model ids: the
 *  first member of each lineage family counts fully, each additional sibling adds
 *  only SIBLING_CREDIT, since relatives share systematic errors and tend to agree
 *  for reasons other than the weather being predictable. Unknown ids (test
 *  fixtures, or future models not yet assigned a family) are treated as
 *  independent. Feeds the predictability model-count factor — see ADR 0006. */
export function effectiveModelCount(ids: Iterable<string>): number {
  const perFamily = new Map<string, number>();
  for (const id of ids) {
    const family = FAMILY_OF[id] ?? id;
    perFamily.set(family, (perFamily.get(family) ?? 0) + 1);
  }
  let effective = 0;
  for (const count of perFamily.values()) effective += 1 + SIBLING_CREDIT * (count - 1);
  return effective;
}
