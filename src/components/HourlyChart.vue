<script setup lang="ts">
import { computed } from 'vue'
import VChart from 'vue-echarts'
import type { EChartsOption } from 'echarts'
import type { HourlyAggregate } from '@/composables/useForecast'
import { useUnits } from '@/composables/useUnits'

const props = defineProps<{
  hourly: HourlyAggregate
  /** Current local time at the location (open-meteo's `current.time`).
   *  Used to grey out elapsed hours and mark "Now". */
  currentTime: string
  /** How many hours to show. Default 72. */
  hours?: number
}>()

const { temp, precip, formatTemp, formatPrecip } = useUnits()

const n = computed(() => Math.min(props.hours ?? 72, props.hourly.times.length))
const tempUnit = computed(() => (temp.value === 'f' ? '°F' : '°C'))
const precipUnit = computed(() => (precip.value === 'in' ? 'in' : 'mm'))

function toTempUnit(v: number | null | undefined): number | null {
  if (v == null || Number.isNaN(v)) return null
  return temp.value === 'f' ? v * 9 / 5 + 32 : v
}
function toPrecipUnit(v: number | null | undefined): number | null {
  if (v == null || Number.isNaN(v)) return null
  return precip.value === 'in' ? v / 25.4 : v
}

/** Find the first index in `times` whose timestamp is at or after `currentTime`.
 *  Both are local-time ISO strings from open-meteo (same TZ), so string compare works. */
function findNowIndex(times: string[], nowStr: string): number {
  for (let i = 0; i < times.length; i++) {
    if (times[i] >= nowStr) return i
  }
  return -1
}

const option = computed<EChartsOption>(() => {
  const times = props.hourly.times.slice(0, n.value)
  const temps = props.hourly.series.temperature_2m.slice(0, n.value)
  const precips = props.hourly.series.precipitation.slice(0, n.value)
  const nowIdx = findNowIndex(times, props.currentTime)

  const tempValues = temps.map((p) => toTempUnit(p.value))
  const tempLower = temps.map((p) => toTempUnit(p.value - p.stdDev))
  // ECharts confidence-band trick: a transparent baseline + a stacked filled "delta".
  const tempDelta = temps.map((p) =>
    Number.isFinite(p.stdDev) ? (temp.value === 'f' ? (p.stdDev * 2 * 9) / 5 : p.stdDev * 2) : 0,
  )
  const precipValues = precips.map((p) => toPrecipUnit(p.value))

  const labels = times.map((t) => {
    const d = new Date(t)
    const h = d.getHours()
    const isMidnight = h === 0
    return isMidnight
      ? d.toLocaleDateString([], { weekday: 'short' })
      : `${h.toString().padStart(2, '0')}:00`
  })

  return {
    backgroundColor: 'transparent',
    textStyle: { color: '#cbd5e1' },
    grid: { left: 48, right: 48, top: 32, bottom: 36 },
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(15, 23, 42, 0.95)',
      borderColor: '#334155',
      textStyle: { color: '#e2e8f0' },
      formatter: (params: unknown) => {
        const arr = params as Array<{ axisValue: string; seriesName: string; value: number; color: string }>
        const t = arr[0]?.axisValue ?? ''
        const idx = labels.indexOf(t)
        const tempP = temps[idx]
        const precP = precips[idx]
        if (!tempP) return ''
        const date = new Date(times[idx])
        const header = date.toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })
        const tempStr = `<span style="color:#fda4af">${formatTemp.value(tempP.value, 1)}</span>` +
          ` <span style="color:#94a3b8">± ${formatTemp.value(tempP.stdDev, 1).replace(/°[CF]/, '')} ${tempUnit.value}</span>`
        const precStr = precP.value > 0.05
          ? `<br/><span style="color:#7dd3fc">${formatPrecip.value(precP.value, 1)}</span>`
          : ''
        return `<div style="font-weight:600;margin-bottom:4px">${header}</div>${tempStr}${precStr}`
      },
    },
    xAxis: {
      type: 'category',
      data: labels,
      axisLine: { lineStyle: { color: '#475569' } },
      axisLabel: { color: '#94a3b8', interval: 11, hideOverlap: true },
      axisTick: { show: false },
    },
    yAxis: [
      {
        type: 'value',
        name: tempUnit.value,
        nameTextStyle: { color: '#94a3b8' },
        axisLine: { show: false },
        axisLabel: { color: '#94a3b8' },
        splitLine: { lineStyle: { color: '#1e293b' } },
      },
      {
        type: 'value',
        name: precipUnit.value,
        nameTextStyle: { color: '#94a3b8' },
        position: 'right',
        min: 0,
        axisLine: { show: false },
        axisLabel: { color: '#94a3b8' },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: 'precipitation',
        type: 'bar',
        yAxisIndex: 1,
        data: precipValues,
        itemStyle: { color: 'rgba(56, 189, 248, 0.7)' },
        barWidth: '60%',
      },
      // Confidence band: invisible bottom + filled "delta" stacked on top.
      {
        name: 'band_base',
        type: 'line',
        stack: 'band',
        symbol: 'none',
        lineStyle: { opacity: 0 },
        itemStyle: { opacity: 0 },
        tooltip: { show: false },
        data: tempLower,
      },
      {
        name: 'band_range',
        type: 'line',
        stack: 'band',
        symbol: 'none',
        lineStyle: { opacity: 0 },
        areaStyle: { color: 'rgba(244, 114, 182, 0.18)' },
        tooltip: { show: false },
        data: tempDelta,
      },
      {
        name: 'temperature',
        type: 'line',
        data: tempValues,
        smooth: true,
        symbol: 'none',
        lineStyle: { width: 2.5, color: '#f472b6' },
        z: 5,
        markArea:
          nowIdx > 0
            ? {
                silent: true,
                itemStyle: { color: 'rgba(2, 6, 23, 0.7)' },
                z: 50,
                data: [[{ xAxis: 0 }, { xAxis: nowIdx - 1 }]],
              }
            : undefined,
      },
    ],
  }
})
</script>

<template>
  <section class="rounded-2xl bg-slate-900/60 ring-1 ring-slate-800 p-4 sm:p-6">
    <div class="flex items-center justify-between mb-3">
      <h2 class="text-sm font-medium text-slate-300 uppercase tracking-wider">Next 3 days</h2>
      <span class="text-xs text-slate-500">Shaded area: model spread (±1σ)</span>
    </div>
    <VChart style="height: 18rem;" :option="option" autoresize />
  </section>
</template>
