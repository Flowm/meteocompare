import { useLocalStorage } from '@vueuse/core'
import { computed } from 'vue'

export type TemperatureUnit = 'c' | 'f'
export type PrecipitationUnit = 'mm' | 'in'

export function useUnits() {
  const temp = useLocalStorage<TemperatureUnit>('meteocompare:unit:temp', 'c')
  const precip = useLocalStorage<PrecipitationUnit>('meteocompare:unit:precip', 'mm')

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

  const formatPercent = (v: number | null | undefined): string => {
    if (v == null || Number.isNaN(v)) return '–'
    return `${Math.round(v)}%`
  }

  return { temp, precip, formatTemp, formatPrecip, formatPercent }
}
