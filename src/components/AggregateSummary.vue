<script setup lang="ts">
import { computed } from 'vue'
import type { ForecastResponse } from '@/api/openMeteo'
import type { DailyAggregate } from '@/composables/useForecast'
import { useUnits } from '@/composables/useUnits'
import { weatherLabel } from '@/domain/weatherCodes'
import WeatherIcon from './WeatherIcon.vue'
import ConfidenceBadge from './ConfidenceBadge.vue'

const props = defineProps<{
  raw: ForecastResponse
  daily: DailyAggregate
  locationName: string
}>()

const { formatTemp, formatPercent } = useUnits()

const currentTemp = computed(() => props.raw.current.temperature_2m ?? null)
const currentCode = computed(() => Number(props.raw.current.weather_code ?? 0))
const todayHigh = computed(() => props.daily.series.temperature_2m_max[0]?.value ?? null)
const todayLow = computed(() => props.daily.series.temperature_2m_min[0]?.value ?? null)
const todayPrecipProb = computed(() => props.daily.series.precipitation_probability_max[0]?.value ?? null)
const todayConfidence = computed(() => {
  const vals = [
    props.daily.confidence.temperature_2m_max[0],
    props.daily.confidence.precipitation_sum[0],
    props.daily.confidence.weather_code[0],
  ].filter((v): v is number => Number.isFinite(v))
  if (vals.length === 0) return 0
  return vals.reduce((a, b) => a + b, 0) / vals.length
})
const lastUpdated = computed(() => new Date(props.raw.current.time))
</script>

<template>
  <section class="rounded-2xl bg-slate-900/60 ring-1 ring-slate-800 p-6 sm:p-8">
    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6">
      <div class="flex items-center gap-5">
        <WeatherIcon :code="currentCode" size="4.5rem" />
        <div>
          <div class="text-sm uppercase tracking-wider text-slate-400">{{ locationName }}</div>
          <div class="flex items-baseline gap-3 mt-0.5">
            <div class="text-5xl sm:text-6xl font-semibold tabular-nums">{{ formatTemp(currentTemp, 0) }}</div>
            <div class="text-slate-300 hidden sm:block">{{ weatherLabel(currentCode) }}</div>
          </div>
          <div class="text-slate-300 sm:hidden mt-1 text-sm">{{ weatherLabel(currentCode) }}</div>
        </div>
      </div>

      <div class="flex flex-col items-start sm:items-end gap-2">
        <ConfidenceBadge :value="todayConfidence" />
        <div class="text-slate-300 text-sm tabular-nums">
          <span class="text-rose-300">{{ formatTemp(todayHigh, 0) }}</span>
          <span class="mx-2 text-slate-500">·</span>
          <span class="text-sky-300">{{ formatTemp(todayLow, 0) }}</span>
          <template v-if="todayPrecipProb != null && todayPrecipProb > 0">
            <span class="mx-2 text-slate-500">·</span>
            <span>💧 {{ formatPercent(todayPrecipProb) }}</span>
          </template>
        </div>
        <div class="text-xs text-slate-500" :title="lastUpdated.toString()">
          Updated {{ lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }}
        </div>
      </div>
    </div>
  </section>
</template>
