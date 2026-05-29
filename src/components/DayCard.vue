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
    class="group bg-ink-900/40 relative min-w-36 flex-shrink-0 border transition-colors"
    :class="[
      highlight ? 'border-sodium-300/60 bg-ink-850/80' : 'border-ink-700 hover:border-paper-300/40 hover:bg-ink-900/70',
      visibleModels.length ? 'cursor-pointer select-none' : '',
    ]"
    @click="visibleModels.length ? (expanded = !expanded) : undefined"
  >
    <!-- Header row: tabular weekday + ordinal date, divided by a hairline -->
    <div class="border-ink-700/60 flex items-baseline justify-between border-b px-3 py-2">
      <span class="font-mono text-xs font-semibold tracking-wide" :class="highlight ? 'text-sodium-300' : 'text-paper-100'">{{ dayLabel }}</span>
      <span class="text-paper-400 font-mono text-[10px] tracking-wide tabular-nums">{{ dateLabel }}</span>
    </div>

    <div class="px-3 pt-3 pb-3">
      <div class="flex justify-center">
        <WeatherIcon :code="code" size="2rem" />
      </div>
      <div class="text-paper-300 mt-1 truncate text-center font-mono text-[10px] tracking-wide" :title="weatherLabel(code)">
        {{ weatherLabel(code) }}
      </div>

      <!-- High / low presented as a paired register -->
      <div class="divide-ink-700/60 border-ink-700/60 mt-3 grid grid-cols-2 divide-x border-y py-1.5 font-mono tabular-nums">
        <div class="flex flex-col items-center gap-0.5">
          <span class="text-paper-400 text-[9px] tracking-wide">Hi</span>
          <span class="text-heat-300 text-sm font-medium">{{ formatTemp(high, 0) }}</span>
        </div>
        <div class="flex flex-col items-center gap-0.5">
          <span class="text-paper-400 text-[9px] tracking-wide">Lo</span>
          <span class="text-cold-300 text-sm font-medium">{{ formatTemp(low, 0) }}</span>
        </div>
      </div>

      <div class="mt-2 flex items-center justify-center gap-1.5 font-mono text-[10px] tabular-nums">
        <template v-if="precipProb != null && precipProb > 5">
          <span class="bg-rain-400 size-1 rounded-full" aria-hidden="true" />
          <span class="text-rain-300">{{ formatPercent(precipProb) }}</span>
          <template v-if="precipSum && precipSum > 0.1">
            <span class="text-paper-500">/</span>
            <span class="text-paper-200">{{ formatPrecip(precipSum, 1) }}</span>
          </template>
        </template>
        <template v-else>
          <span class="text-paper-500 text-[10px] tracking-wide">dry</span>
        </template>
      </div>

      <div
        v-if="windSpeed != null && !Number.isNaN(windSpeed)"
        class="text-paper-300 mt-1 flex items-center justify-center gap-1 font-mono text-[10px] tabular-nums"
        :title="`Wind from ${compassPoint(windDirection)} (${windDirection != null ? Math.round(windDirection) + '°' : '–'})`"
      >
        <svg
          v-if="windDirection != null"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="text-sodium-300 size-3"
          :style="{ transform: `rotate(${arrowRotation}deg)` }"
          aria-hidden="true"
        >
          <line x1="12" y1="20" x2="12" y2="4" />
          <polyline points="6 10 12 4 18 10" />
        </svg>
        <span>{{ formatWind(windSpeed, 0) }}</span>
      </div>

      <div class="mt-3 flex justify-center">
        <ConfidenceBadge :value="confidence" size="sm" />
      </div>
    </div>

    <!-- Per-model breakdown (click to toggle) -->
    <Transition
      enter-active-class="overflow-hidden transition-all duration-200 ease-out"
      leave-active-class="overflow-hidden transition-all duration-150 ease-in"
      enter-from-class="max-h-0 opacity-0"
      enter-to-class="max-h-[32rem] opacity-100"
      leave-from-class="max-h-[32rem] opacity-100"
      leave-to-class="max-h-0 opacity-0"
    >
      <div v-if="expanded && visibleModels.length" class="border-ink-700 bg-ink-950/40 border-t px-3 py-2">
        <div class="text-paper-400 mb-1.5 font-mono text-[9px] tracking-wide">Per-model</div>
        <div v-for="m in visibleModels" :key="m.id" class="flex items-baseline justify-between gap-1 py-0.5 font-mono text-[10px]">
          <span class="text-paper-400 max-w-[5rem] truncate">{{ m.label }}</span>
          <span class="whitespace-nowrap tabular-nums">
            <template v-if="m.precipProb != null && m.precipProb > 5">
              <span class="text-rain-300">{{ formatPercent(m.precipProb) }}</span>
              <span class="text-paper-500 mx-1">·</span>
            </template>
            <span class="text-heat-300">{{ formatTemp(m.high, 0) }}</span>
            <span class="text-paper-500">/</span>
            <span class="text-cold-300">{{ formatTemp(m.low, 0) }}</span>
          </span>
        </div>
      </div>
    </Transition>
  </div>
</template>
