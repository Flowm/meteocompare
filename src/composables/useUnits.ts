import { useLocalStorage } from '@vueuse/core'
import { computed } from 'vue'

export type TemperatureUnit = 'c' | 'f'
export type PrecipitationUnit = 'mm' | 'in'
export type WindUnit = 'kmh' | 'mph'

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const

/** Format a percentage. Stateless — hoisted out of the composable. */
export function formatPercent(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return '–'
  return `${Math.round(v)}%`
}

/** Convert a 0–360° bearing into an 8-point compass label (N, NE, E, …). */
export function compassPoint(deg: number | null | undefined): string {
  if (deg == null || Number.isNaN(deg)) return '–'
  const idx = Math.round((((deg % 360) + 360) % 360) / 45) % 8
  return COMPASS[idx]
}

export function useUnits() {
  const temp = useLocalStorage<TemperatureUnit>('meteocompare:unit:temp', 'c')
  const precip = useLocalStorage<PrecipitationUnit>('meteocompare:unit:precip', 'mm')
  const wind = useLocalStorage<WindUnit>('meteocompare:unit:wind', 'kmh')

  const formatTemp = computed(() => (v: number | null | undefined, digits = 0): string => {
    if (v == null || Number.isNaN(v)) return '–'
    const x = temp.value === 'f' ? v * 9 / 5 + 32 : v
    return `${x.toFixed(digits)}°${temp.value === 'f' ? 'F' : 'C'}`
  })

  const formatPrecip = computed(() => (v: number | null | undefined, digits = 1): string => {
    if (v == null || Number.isNaN(v)) return '–'
    const x = precip.value === 'in' ? v / 25.4 : v
    return `${x.toFixed(digits)} ${precip.value === 'in' ? 'in' : 'mm'}`
  })

  const formatWind = computed(() => (v: number | null | undefined, digits = 0): string => {
    if (v == null || Number.isNaN(v)) return '–'
    // open-meteo returns km/h by default.
    const x = wind.value === 'mph' ? v / 1.609344 : v
    return `${x.toFixed(digits)} ${wind.value === 'mph' ? 'mph' : 'km/h'}`
  })

  return { temp, precip, wind, formatTemp, formatPrecip, formatWind, formatPercent, compassPoint }
}
