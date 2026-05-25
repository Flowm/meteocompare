<script setup lang="ts">
import { computed } from "vue";

import { useUnits } from "@/composables/useUnits";
import { MODELS } from "@/domain/models";
import type { DailyVerification } from "@/domain/verification";

import ConfidenceBadge from "./ConfidenceBadge.vue";
import HitMissStrip from "./HitMissStrip.vue";
import WeatherIcon from "./WeatherIcon.vue";

const props = defineProps<{
  day: DailyVerification;
  /** When true, per-model rows are revealed (page-level toggle). */
  showModels: boolean;
  /** Aggregate weather_code for this day (icon only, no scoring — see CONTEXT.md
   *  "Weather code on truth"). Optional: omit to skip the icon entirely. */
  weatherCode?: number;
}>();

const { formatTemp, formatPrecip } = useUnits();

const dayLabel = computed(() => {
  // Day n starts on (runDate + n). UTC arithmetic on the ISO date keeps this
  // browser-TZ-independent.
  const d = new Date(`${props.day.runDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + props.day.dayIndex);
  return d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
});

// U5: 0-indexed day label so Day 0 = the run day itself (matches the lead
// hours, where Day 0 covers 0–24 h lead). Avoids the "Day 1 means tomorrow,
// or the run day?" ambiguity from the previous 1-indexed labelling.
const leadLabel = computed(() => `Day ${props.day.dayIndex} · ${props.day.leadHoursStart}-${props.day.leadHoursEnd}h`);

// Look up labels in the full MODELS registry, not the subset that contributed
// to the aggregate's temperature axis — a model can return precip-only data
// for a given run date, in which case it's absent from `availableModels` but
// still present in `day.perModel`.
const modelLabel = (id: string): string => MODELS.find((m) => m.id === id)?.label ?? id;

const perModelEntries = computed(() =>
  Object.entries(props.day.perModel)
    .filter(([, scores]) => scores.temperature !== null || scores.precipitation !== null)
    .sort(([a], [b]) => modelLabel(a).localeCompare(modelLabel(b))),
);

function signed(n: number, digits = 1): string {
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}`;
}
</script>

<template>
  <article class="min-w-[20rem] flex-shrink-0 snap-start rounded-xl bg-slate-900/40 p-4 ring-1 ring-slate-800">
    <!-- Header -->
    <div class="flex items-baseline justify-between gap-2">
      <h3 class="text-sm font-semibold text-slate-200">{{ dayLabel }}</h3>
      <span class="text-[10px] text-slate-500 tabular-nums">{{ leadLabel }}</span>
    </div>

    <!-- Forecast vs truth header rows -->
    <div class="mt-3 space-y-1.5 text-sm tabular-nums">
      <div v-if="day.aggregate.temperature" class="flex items-center gap-2">
        <span class="w-16 text-xs text-slate-500">Forecast</span>
        <WeatherIcon v-if="weatherCode != null" :code="weatherCode" size="1.5rem" />
        <span v-else class="inline-flex size-6 items-center justify-center text-xs text-slate-700">·</span>
        <span class="text-rose-300">{{ formatTemp(day.aggregate.temperature.forecastMax, 0) }}</span>
        <span class="text-sky-300">{{ formatTemp(day.aggregate.temperature.forecastMin, 0) }}</span>
        <span class="ml-auto text-slate-400">{{ day.aggregate.precipitation ? formatPrecip(day.aggregate.precipitation.forecastSum, 1) : "—" }}</span>
      </div>
      <div v-if="day.aggregate.temperature" class="flex items-center gap-2">
        <span class="w-16 text-xs text-slate-500">Truth</span>
        <span class="inline-flex size-6 items-center justify-center text-xs text-slate-700">—</span>
        <span class="text-rose-300/70">{{ formatTemp(day.aggregate.temperature.truthMax, 0) }}</span>
        <span class="text-sky-300/70">{{ formatTemp(day.aggregate.temperature.truthMin, 0) }}</span>
        <span class="ml-auto text-slate-500">{{ day.aggregate.precipitation ? formatPrecip(day.aggregate.precipitation.truthSum, 1) : "—" }}</span>
      </div>
    </div>

    <!-- Score lines -->
    <div class="mt-3 space-y-1.5 text-xs tabular-nums">
      <div v-if="day.aggregate.temperature" class="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-slate-400">
        <span class="font-medium text-slate-300">Temp</span>
        <span
          >bias <span class="text-slate-200">{{ signed(day.aggregate.temperature.bias) }} °C</span></span
        >
        <span
          >|MAE| <span class="text-slate-200">{{ day.aggregate.temperature.mae.toFixed(1) }} °C</span></span
        >
        <ConfidenceBadge v-if="Number.isFinite(day.aggregate.temperature.confidence)" :value="day.aggregate.temperature.confidence" size="sm" class="ml-auto" />
      </div>
      <div v-if="day.aggregate.precipitation" class="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-slate-400">
        <span class="font-medium text-slate-300">Precip</span>
        <span
          >amount <span class="text-slate-200">{{ signed(day.aggregate.precipitation.amountError) }} mm</span></span
        >
        <template v-if="Number.isFinite(day.aggregate.precipitation.timingHitRate)">
          <span>
            timing <span class="text-slate-200">{{ Math.round(day.aggregate.precipitation.timingHitRate * 100) }}%</span>
          </span>
        </template>
        <template v-else>
          <span class="text-slate-600">dry day</span>
        </template>
        <ConfidenceBadge v-if="Number.isFinite(day.aggregate.precipitation.confidence)" :value="day.aggregate.precipitation.confidence" size="sm" class="ml-auto" />
      </div>
    </div>

    <!-- Per-hour hit/miss strip -->
    <div v-if="day.aggregate.precipitation" class="mt-3">
      <HitMissStrip :classification="day.aggregate.precipitation.hourlyClassification" :hour-label="(i) => `${i.toString().padStart(2, '0')}:00`" />
    </div>

    <!-- Per-model rows (revealed by page-level toggle) -->
    <Transition
      enter-active-class="overflow-hidden transition-all duration-200 ease-out"
      leave-active-class="overflow-hidden transition-all duration-150 ease-in"
      enter-from-class="max-h-0 opacity-0"
      enter-to-class="max-h-[36rem] opacity-100"
      leave-from-class="max-h-[36rem] opacity-100"
      leave-to-class="max-h-0 opacity-0"
    >
      <div v-if="showModels && perModelEntries.length" class="mt-3 space-y-1 border-t border-slate-800 pt-3 text-[11px] tabular-nums">
        <div v-for="[modelId, scores] in perModelEntries" :key="modelId" class="grid grid-cols-[7rem_1fr_1fr] items-baseline gap-2">
          <span class="truncate text-slate-500">{{ modelLabel(modelId) }}</span>
          <span class="text-slate-400">
            <template v-if="scores.temperature">T {{ signed(scores.temperature.bias) }}/{{ scores.temperature.mae.toFixed(1) }} °C</template>
            <span v-else class="text-slate-600">T —</span>
          </span>
          <span class="text-slate-400">
            <template v-if="scores.precipitation">
              P {{ signed(scores.precipitation.amountError) }} mm
              <span v-if="Number.isFinite(scores.precipitation.timingHitRate)" class="text-slate-500"> · {{ Math.round(scores.precipitation.timingHitRate * 100) }}% </span>
            </template>
            <span v-else class="text-slate-600">P —</span>
          </span>
        </div>
      </div>
    </Transition>
  </article>
</template>
