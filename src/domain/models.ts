// Registry of NWP models we expose via open-meteo. Each `id` matches the
// `models=` value accepted by https://api.open-meteo.com/v1/forecast.
// The `seamless` variants let open-meteo auto-pick the highest-resolution
// component (e.g. AROME inside France, ARPEGE elsewhere) — we still treat
// the whole product as one logical "model" for the user.

export type ModelKind = 'global' | 'regional-cam' | 'regional-mid'

export interface BBox {
  /** lat min, lat max */
  lat: [number, number]
  /** lon min, lon max */
  lon: [number, number]
}

export interface ModelDef {
  id: string
  label: string
  provider: string
  kind: ModelKind
  /** Approximate maximum useful lead time, hours. Past this the value returned
   *  by open-meteo may be from a lower-resolution fallback or null. */
  maxLeadHours: number
  /** Geographic region where this model has a structural advantage.
   *  `null` for genuinely global models (ECMWF, GFS). */
  homeRegion: BBox | null
  /** Short description shown in the model breakdown UI. */
  description: string
}

export const MODELS: ModelDef[] = [
  {
    id: 'ecmwf_ifs025',
    label: 'ECMWF IFS',
    provider: 'ECMWF',
    kind: 'global',
    maxLeadHours: 240,
    homeRegion: null,
    description: '25 km global; the medium-range gold standard.',
  },
  {
    id: 'gfs_seamless',
    label: 'NOAA GFS',
    provider: 'NOAA',
    kind: 'global',
    maxLeadHours: 384,
    homeRegion: null,
    description: '13–25 km global; long horizon, fast updates.',
  },
  {
    id: 'icon_seamless',
    label: 'DWD ICON',
    provider: 'DWD',
    kind: 'regional-mid',
    maxLeadHours: 180,
    homeRegion: { lat: [35, 72], lon: [-25, 45] },
    description: 'ICON family: 2 km D2 in central Europe, 7 km EU, 11 km global.',
  },
  {
    id: 'gem_seamless',
    label: 'EC GEM',
    provider: 'Environment Canada',
    kind: 'regional-mid',
    maxLeadHours: 240,
    homeRegion: { lat: [25, 72], lon: [-170, -50] },
    description: '2.5–15 km, strongest over North America.',
  },
  {
    id: 'meteofrance_seamless',
    label: 'Météo-France',
    provider: 'Météo-France',
    kind: 'regional-cam',
    maxLeadHours: 102,
    homeRegion: { lat: [41, 52], lon: [-5, 10] },
    description: 'AROME (1.3 km) over France, ARPEGE globally.',
  },
  {
    id: 'ukmo_seamless',
    label: 'UKMO',
    provider: 'UK Met Office',
    kind: 'regional-mid',
    maxLeadHours: 168,
    homeRegion: { lat: [49, 61], lon: [-11, 2] },
    description: '2 km UKV over the British Isles, 10 km global.',
  },
  {
    id: 'knmi_seamless',
    label: 'KNMI Harmonie',
    provider: 'KNMI',
    kind: 'regional-cam',
    maxLeadHours: 60,
    homeRegion: { lat: [49, 54], lon: [2, 8] },
    description: '2.5 km over the Benelux & North Sea.',
  },
  {
    id: 'metno_seamless',
    label: 'MET Norway',
    provider: 'MET Norway',
    kind: 'regional-cam',
    maxLeadHours: 60,
    homeRegion: { lat: [55, 72], lon: [-5, 35] },
    description: '2.5 km MEPS over Scandinavia.',
  },
  {
    id: 'jma_seamless',
    label: 'JMA',
    provider: 'JMA',
    kind: 'regional-mid',
    maxLeadHours: 264,
    homeRegion: { lat: [24, 46], lon: [122, 146] },
    description: 'GSM + MSM, strongest over Japan & nearby seas.',
  },
  {
    id: 'kma_seamless',
    label: 'KMA',
    provider: 'KMA',
    kind: 'regional-mid',
    maxLeadHours: 288,
    homeRegion: { lat: [33, 43], lon: [124, 132] },
    description: '1.5–13 km, strongest over the Korean peninsula.',
  },
  {
    id: 'bom_access_global',
    label: 'BOM ACCESS-G',
    provider: 'BOM',
    kind: 'global',
    maxLeadHours: 240,
    homeRegion: { lat: [-45, -10], lon: [110, 155] },
    description: '15 km, strongest over Australasia.',
  },
]

export const MODEL_IDS: string[] = MODELS.map((m) => m.id)

const MODEL_INDEX: Record<string, ModelDef> = Object.fromEntries(
  MODELS.map((m) => [m.id, m]),
)

export function getModel(id: string): ModelDef | undefined {
  return MODEL_INDEX[id]
}

export function isInBBox(lat: number, lon: number, bbox: BBox): boolean {
  return (
    lat >= bbox.lat[0] &&
    lat <= bbox.lat[1] &&
    lon >= bbox.lon[0] &&
    lon <= bbox.lon[1]
  )
}

/** 0..0.3 bonus when (lat,lon) sits inside the model's home region. */
export function regionBonus(model: ModelDef, lat: number, lon: number): number {
  if (!model.homeRegion) return 0
  if (!isInBBox(lat, lon, model.homeRegion)) return 0
  return model.kind === 'regional-cam' ? 0.3 : 0.2
}
