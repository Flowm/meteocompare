<script setup lang="ts">
import { computed, ref } from 'vue'
import VChart from 'vue-echarts'
import type { EChartsOption } from 'echarts'
import type { HourlyAggregate } from '@/composables/useForecast'
import type { ModelDef } from '@/domain/models'
import type { HourlyVar } from '@/api/openMeteo'
import { useUnits } from '@/composables/useUnits'

const props = defineProps<{
  hourly: HourlyAggregate
  contributingModels: ModelDef[]
  /** Current local time at the location (open-meteo's `current.time`). */
  currentTime: string
}>()

function findNowIndex(times: string[], nowStr: string): number {
  for (let i = 0; i < times.length; i++) {
    if (times[i] >= nowStr) return i
  }
  return -1
}

const { temp, precip, wind, formatTemp, formatPrecip, formatWind } = useUnits()

const variable = ref<HourlyVar>('temperature_2m')
const hoursWindow = ref(72)

const WINDOW_CHOICES = [
  { hours: 24, label: '24h' },
  { hours: 72, label: '3d' },
  { hours: 168, label: '7d' },
] as const
const selected = ref<Set<string>>(new Set(props.contributingModels.map((m) => m.id)))

const variableOptions: { id: HourlyVar; label: string }[] = [
  { id: 'temperature_2m', label: 'Temperature' },
  { id: 'precipitation', label: 'Precipitation' },
  { id: 'precipitation_probability', label: 'Precip. probability' },
  { id: 'wind_speed_10m', label: 'Wind speed' },
  { id: 'cloud_cover', label: 'Cloud cover' },
]

const palette = [
  '#f472b6', '#60a5fa', '#34d399', '#fbbf24',
  '#a78bfa', '#fb7185', '#22d3ee', '#f87171',
  '#facc15', '#4ade80', '#c084fc',
]

function toggle(id: string): void {
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selected.value = next
}

function selectAll(): void {
  selected.value = new Set(props.contributingModels.map((m) => m.id))
}

function selectNone(): void {
  selected.value = new Set()
}

function convertValue(v: number | null, varId: HourlyVar): number | null {
  if (v == null || Number.isNaN(v)) return null
  if (varId === 'temperature_2m') return temp.value === 'f' ? (v * 9) / 5 + 32 : v
  if (varId === 'precipitation') return precip.value === 'in' ? v / 25.4 : v
  if (varId === 'wind_speed_10m') return wind.value === 'mph' ? v / 1.609344 : v
  return v
}

function unitFor(varId: HourlyVar): string {
  if (varId === 'temperature_2m') return temp.value === 'f' ? '°F' : '°C'
  if (varId === 'precipitation') return precip.value === 'in' ? 'in' : 'mm'
  if (varId === 'wind_speed_10m') return wind.value === 'mph' ? 'mph' : 'km/h'
  return '%'
}

function formatFor(varId: HourlyVar, v: number | null): string {
  if (varId === 'temperature_2m') return formatTemp.value(v, 1)
  if (varId === 'precipitation') return formatPrecip.value(v, 1)
  if (varId === 'wind_speed_10m') return formatWind.value(v, 1)
  if (v == null || Number.isNaN(v)) return '–'
  return `${Math.round(v)}%`
}

const option = computed<EChartsOption>(() => {
  const n = Math.min(hoursWindow.value, props.hourly.times.length)
  const times = props.hourly.times.slice(0, n)
  const nowIdx = findNowIndex(times, props.currentTime)
  const labels = times.map((t) => {
    const d = new Date(t)
    return d.getHours() === 0
      ? d.toLocaleDateString([], { weekday: 'short' })
      : `${d.getHours().toString().padStart(2, '0')}:00`
  })

  const aggregateSeries = {
    name: 'Aggregate',
    type: 'line' as const,
    data: props.hourly.series[variable.value]
      .slice(0, n)
      .map((p) => convertValue(p.value, variable.value)),
    smooth: true,
    symbol: 'none',
    lineStyle: { width: 3, color: '#e2e8f0' },
    z: 10,
    // Dim already-elapsed timestamps so the past reads as context, not forecast.
    markArea:
      nowIdx > 0
        ? {
            silent: true,
            itemStyle: { color: 'rgba(2, 6, 23, 0.7)' },
            z: 50,
            data: [[{ xAxis: 0 }, { xAxis: nowIdx - 1 }]],
          }
        : undefined,
  }

  const perModelSeries = props.contributingModels
    .filter((m) => selected.value.has(m.id))
    .map((m, i) => ({
      name: m.label,
      type: 'line' as const,
      data: (props.hourly.perModel[variable.value][m.id] ?? [])
        .slice(0, n)
        .map((v) => convertValue(v, variable.value)),
      smooth: true,
      symbol: 'none',
      lineStyle: { width: 1.25, color: palette[i % palette.length] },
      opacity: 0.85,
    }))

  return {
    backgroundColor: 'transparent',
    textStyle: { color: '#cbd5e1' },
    grid: { left: 48, right: 24, top: 12, bottom: 36 },
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(15, 23, 42, 0.95)',
      borderColor: '#334155',
      textStyle: { color: '#e2e8f0' },
      valueFormatter: (v: unknown) => formatFor(variable.value, v as number | null),
    },
    xAxis: {
      type: 'category',
      data: labels,
      axisLine: { lineStyle: { color: '#475569' } },
      axisLabel: {
        color: '#94a3b8',
        interval: hoursWindow.value <= 24 ? 2 : hoursWindow.value <= 72 ? 11 : 23,
        hideOverlap: true,
      },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      name: unitFor(variable.value),
      nameTextStyle: { color: '#94a3b8' },
      axisLine: { show: false },
      axisLabel: { color: '#94a3b8' },
      splitLine: { lineStyle: { color: '#1e293b' } },
      ...(variable.value === 'precipitation_probability' || variable.value === 'cloud_cover'
        ? { min: 0, max: 100 }
        : {}),
    },
    series: [aggregateSeries, ...perModelSeries],
  }
})
</script>

<template>
  <details class="rounded-2xl bg-slate-900/60 ring-1 ring-slate-800 group">
    <summary
      class="cursor-pointer list-none px-4 sm:px-6 py-4 flex items-center justify-between"
    >
      <div>
        <h2 class="text-sm font-medium text-slate-300 uppercase tracking-wider">Compare models</h2>
        <p class="text-xs text-slate-500 mt-0.5">
          {{ contributingModels.length }} models contributed to the aggregate.
        </p>
      </div>
      <span class="text-slate-500 group-open:rotate-180 transition-transform">▾</span>
    </summary>

    <div class="px-4 sm:px-6 pb-6 space-y-4">
      <div class="flex flex-wrap items-center gap-4">
        <div class="flex items-center gap-2 text-xs">
          <span class="text-slate-500">Variable:</span>
          <div class="flex rounded-md bg-slate-950 ring-1 ring-slate-800 overflow-hidden">
            <button
              v-for="o in variableOptions"
              :key="o.id"
              class="px-3 py-1.5 transition-colors"
              :class="variable === o.id
                ? 'bg-slate-700 text-slate-100'
                : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'"
              @click="variable = o.id"
            >{{ o.label }}</button>
          </div>
        </div>

        <div class="flex items-center gap-2 text-xs ml-auto">
          <span class="text-slate-500">Window:</span>
          <div class="flex rounded-md bg-slate-950 ring-1 ring-slate-800 overflow-hidden">
            <button
              v-for="c in WINDOW_CHOICES"
              :key="c.hours"
              class="px-3 py-1.5"
              :class="hoursWindow === c.hours
                ? 'bg-slate-700 text-slate-100'
                : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'"
              @click="hoursWindow = c.hours"
            >{{ c.label }}</button>
          </div>
        </div>
      </div>

      <VChart style="height: 22rem;" :option="option" autoresize />

      <div class="flex flex-wrap items-center gap-2 text-xs">
        <span class="text-slate-500 mr-1">Models:</span>
        <button
          v-for="(m, i) in contributingModels"
          :key="m.id"
          class="px-2 py-1 rounded-md ring-1 transition-colors tabular-nums"
          :class="selected.has(m.id)
            ? 'bg-slate-800 text-slate-100 ring-slate-700'
            : 'bg-slate-950 text-slate-500 ring-slate-800 hover:text-slate-300'"
          :title="`${m.provider} · ${m.description}`"
          @click="toggle(m.id)"
        >
          <span
            class="inline-block size-2 rounded-full mr-1.5"
            :style="{ backgroundColor: palette[i % palette.length] }"
          />{{ m.label }}
        </button>
        <button class="text-slate-500 hover:text-slate-300 ml-2 underline" @click="selectAll">all</button>
        <button class="text-slate-500 hover:text-slate-300 underline" @click="selectNone">none</button>
      </div>
    </div>
  </details>
</template>
