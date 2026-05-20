import type { ModelDef } from './models'
import { regionBonus } from './models'

export type Variable =
  | 'temperature_2m'
  | 'precipitation'
  | 'precipitation_probability'
  | 'weather_code'
  | 'wind_speed_10m'
  | 'wind_direction_10m'
  | 'cloud_cover'

/** Per-model lead-time decay, returning a multiplier in [0, 1]. */
function leadFactor(model: ModelDef, leadHours: number): number {
  if (leadHours < 0) return 0
  if (leadHours > model.maxLeadHours) return 0

  switch (model.kind) {
    case 'regional-cam':
      // Full weight ≤24 h, linear → 0 by 60 h.
      if (leadHours <= 24) return 1
      return Math.max(0, 1 - (leadHours - 24) / 36)
    case 'regional-mid':
      // Full weight ≤48 h, linear → 0.3 by 120 h.
      if (leadHours <= 48) return 1
      if (leadHours >= 120) return 0.3
      return 1 - ((leadHours - 48) / 72) * 0.7
    case 'global':
      // Globals carry the medium-range; ECMWF gets a small bonus past 72 h.
      if (model.id === 'ecmwf_ifs025' && leadHours > 72) return 1.1
      return 1
  }
}

/** Variable-specific boost — CAMs get a precipitation bonus. */
function variableBoost(model: ModelDef, variable: Variable): number {
  if (
    (variable === 'precipitation' || variable === 'precipitation_probability') &&
    model.kind === 'regional-cam'
  ) {
    return 1.3
  }
  return 1
}

export function modelWeight(
  model: ModelDef,
  leadHours: number,
  lat: number,
  lon: number,
  variable: Variable,
): number {
  const base = 1 + regionBonus(model, lat, lon)
  return base * leadFactor(model, leadHours) * variableBoost(model, variable)
}

/** Compute normalized weights (sum = 1) given a list of models and a context.
 *  Models whose raw weight is 0 are dropped — they don't cover this lead time. */
export function normalizedWeights(
  models: ModelDef[],
  leadHours: number,
  lat: number,
  lon: number,
  variable: Variable,
): Map<string, number> {
  const raw = new Map<string, number>()
  let total = 0
  for (const m of models) {
    const w = modelWeight(m, leadHours, lat, lon, variable)
    if (w > 0) {
      raw.set(m.id, w)
      total += w
    }
  }
  if (total === 0) return raw
  for (const [id, w] of raw) raw.set(id, w / total)
  return raw
}
