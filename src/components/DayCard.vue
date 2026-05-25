<script setup lang="ts">
import { computed, ref } from "vue";

import { useUnits } from "@/composables/useUnits";
import { weatherLabel } from "@/domain/weatherCodes";

import ConfidenceBadge from "./ConfidenceBadge.vue";
import WeatherIcon from "./WeatherIcon.vue";

export interface ModelRow {
  id: string;
  label: string;
  high: number | null;
  low: number | null;
  precipProb: number | null;
}

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
  models?: ModelRow[];
}>();

const { formatTemp, formatPercent, formatPrecip, formatWind, compassPoint } = useUnits();

const expanded = ref(false);

/** The arrow visually points where the wind is going TO. Meteorological convention
 *  reports the direction the wind is coming FROM, so we rotate by direction + 180°. */
const arrowRotation = computed(() => (props.windDirection != null && !Number.isNaN(props.windDirection) ? (props.windDirection + 180) % 360 : 0));

const dayLabel = computed(() => {
  const d = new Date(props.date);
  if (props.highlight) return "Today";
  return d.toLocaleDateString([], { weekday: "short" });
});

const dateLabel = computed(() => new Date(props.date).toLocaleDateString([], { day: "numeric", month: "short" }));

const visibleModels = computed(() => props.models?.filter((m) => m.high != null || m.low != null) ?? []);
</script>

<template>
  <div
    class="min-w-32 flex-shrink-0 rounded-xl p-3 ring-1 transition-colors"
    :class="[highlight ? 'bg-slate-800/80 ring-slate-700' : 'bg-slate-900/40 ring-slate-800 hover:bg-slate-900/70', visibleModels.length ? 'cursor-pointer select-none' : '']"
    @click="visibleModels.length ? (expanded = !expanded) : undefined"
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

    <!-- Per-model breakdown (click to toggle) -->
    <Transition
      enter-active-class="transition-all duration-200 ease-out overflow-hidden"
      leave-active-class="transition-all duration-150 ease-in overflow-hidden"
      enter-from-class="opacity-0 max-h-0"
      enter-to-class="opacity-100 max-h-[32rem]"
      leave-from-class="opacity-100 max-h-[32rem]"
      leave-to-class="opacity-0 max-h-0"
    >
      <div v-if="expanded && visibleModels.length" class="mt-2 border-t border-slate-700 pt-2">
        <div v-for="m in visibleModels" :key="m.id" class="flex items-baseline justify-between gap-1 py-px text-[10px]">
          <span class="max-w-[5rem] truncate text-slate-500">{{ m.label }}</span>
          <span class="whitespace-nowrap tabular-nums">
            <template v-if="m.precipProb != null && m.precipProb > 5">
              <span class="text-slate-400">{{ formatPercent(m.precipProb) }}</span>
              <span class="text-slate-600"> </span>
            </template>
            <span class="text-rose-300">{{ formatTemp(m.high, 0) }}</span>
            <span class="text-slate-600">/</span>
            <span class="text-sky-400">{{ formatTemp(m.low, 0) }}</span>
          </span>
        </div>
      </div>
    </Transition>
  </div>
</template>
