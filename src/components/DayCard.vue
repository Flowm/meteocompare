<script setup lang="ts">
import { computed } from 'vue'
import WeatherIcon from './WeatherIcon.vue'
import ConfidenceBadge from './ConfidenceBadge.vue'
import { useUnits } from '@/composables/useUnits'
import { weatherLabel } from '@/domain/weatherCodes'

const props = defineProps<{
  date: string
  code: number
  high: number
  low: number
  precipProb: number | null
  precipSum: number | null
  confidence: number
  highlight?: boolean
}>()

const { formatTemp, formatPercent, formatPrecip } = useUnits()

const dayLabel = computed(() => {
  const d = new Date(props.date)
  if (props.highlight) return 'Today'
  return d.toLocaleDateString([], { weekday: 'short' })
})

const dateLabel = computed(() =>
  new Date(props.date).toLocaleDateString([], { day: 'numeric', month: 'short' }),
)
</script>

<template>
  <div
    class="min-w-32 flex-shrink-0 rounded-xl p-3 ring-1 transition-colors"
    :class="highlight ? 'bg-slate-800/80 ring-slate-700' : 'bg-slate-900/40 ring-slate-800 hover:bg-slate-900/70'"
  >
    <div class="flex items-baseline justify-between">
      <span class="text-sm font-semibold text-slate-200">{{ dayLabel }}</span>
      <span class="text-[10px] text-slate-500">{{ dateLabel }}</span>
    </div>
    <div class="flex justify-center my-2">
      <WeatherIcon :code="code" size="2.25rem" />
    </div>
    <div class="text-center text-xs text-slate-400 truncate" :title="weatherLabel(code)">
      {{ weatherLabel(code) }}
    </div>
    <div class="flex items-center justify-center gap-2 mt-2 tabular-nums text-sm">
      <span class="text-rose-300 font-medium">{{ formatTemp(high, 0) }}</span>
      <span class="text-sky-300">{{ formatTemp(low, 0) }}</span>
    </div>
    <div class="flex items-center justify-center gap-1 text-xs text-slate-400 mt-1 tabular-nums">
      <template v-if="precipProb != null && precipProb > 5">
        💧 {{ formatPercent(precipProb) }}
        <template v-if="precipSum && precipSum > 0.1">
          <span class="text-slate-500">·</span>
          <span>{{ formatPrecip(precipSum, 1) }}</span>
        </template>
      </template>
      <template v-else>
        <span class="text-slate-600">no precip</span>
      </template>
    </div>
    <div class="mt-2 flex justify-center">
      <ConfidenceBadge :value="confidence" size="sm" :label="`${Math.round(confidence * 100)}%`" />
    </div>
  </div>
</template>
