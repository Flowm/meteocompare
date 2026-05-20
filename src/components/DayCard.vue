<script setup lang="ts">
import { computed } from "vue";

import { useUnits } from "@/composables/useUnits";
import { weatherLabel } from "@/domain/weatherCodes";

import ConfidenceBadge from "./ConfidenceBadge.vue";
import WeatherIcon from "./WeatherIcon.vue";

const props = defineProps<{
  date: string;
  code: number;
  high: number;
  low: number;
  precipProb: number | null;
  precipSum: number | null;
  windSpeed: number | null;
  windDirection: number | null;
  confidence: number;
  highlight?: boolean;
}>();

const { formatTemp, formatPercent, formatPrecip, formatWind, compassPoint } = useUnits();

/** The arrow visually points where the wind is going TO. Meteorological convention
 *  reports the direction the wind is coming FROM, so we rotate by direction + 180°. */
const arrowRotation = computed(() => (props.windDirection != null && !Number.isNaN(props.windDirection) ? (props.windDirection + 180) % 360 : 0));

const dayLabel = computed(() => {
  const d = new Date(props.date);
  if (props.highlight) return "Today";
  return d.toLocaleDateString([], { weekday: "short" });
});

const dateLabel = computed(() => new Date(props.date).toLocaleDateString([], { day: "numeric", month: "short" }));
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
    <div class="my-2 flex justify-center">
      <WeatherIcon :code="code" size="2.25rem" />
    </div>
    <div class="truncate text-center text-xs text-slate-400" :title="weatherLabel(code)">
      {{ weatherLabel(code) }}
    </div>
    <div class="mt-2 flex items-center justify-center gap-2 text-sm tabular-nums">
      <span class="font-medium text-rose-300">{{ formatTemp(high, 0) }}</span>
      <span class="text-sky-300">{{ formatTemp(low, 0) }}</span>
    </div>
    <div class="mt-1 flex items-center justify-center gap-1 text-xs text-slate-400 tabular-nums">
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
    <div
      v-if="windSpeed != null && !Number.isNaN(windSpeed)"
      class="mt-1 flex items-center justify-center gap-1 text-xs text-slate-400 tabular-nums"
      :title="`Wind from ${compassPoint(windDirection)} (${windDirection != null ? Math.round(windDirection) + '°' : '–'})`"
    >
      <svg
        v-if="windDirection != null"
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="size-3 text-slate-300"
        :style="{ transform: `rotate(${arrowRotation}deg)` }"
        aria-hidden="true"
      >
        <line x1="12" y1="20" x2="12" y2="4" />
        <polyline points="6 10 12 4 18 10" />
      </svg>
      <span>{{ formatWind(windSpeed, 0) }}</span>
    </div>
    <div class="mt-2 flex justify-center">
      <ConfidenceBadge :value="confidence" size="sm" :label="`${Math.round(confidence * 100)}%`" />
    </div>
  </div>
</template>
