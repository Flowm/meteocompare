<script setup lang="ts">
import { computed } from "vue";

import { useUnits } from "@/composables/useUnits";
import type { DailyVerification } from "@/domain/verification";

import ConfidenceBadge from "./ConfidenceBadge.vue";
import HitMissStrip from "./HitMissStrip.vue";
import WeatherIcon from "./WeatherIcon.vue";

const props = defineProps<{
  day: DailyVerification;
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

function signed(n: number, digits = 1): string {
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}`;
}
</script>

<template>
  <article class="border-ink-700 bg-ink-900/40 min-w-[20rem] flex-shrink-0 snap-start border">
    <!-- Header -->
    <div class="border-ink-700/60 flex items-baseline justify-between gap-2 border-b px-4 py-2.5">
      <h3 class="text-paper-100 font-mono text-xs font-semibold tracking-wide">{{ dayLabel }}</h3>
      <span class="text-paper-400 font-mono text-[10px] tracking-wide tabular-nums">{{ leadLabel }}</span>
    </div>

    <div class="px-4 py-3">
      <!-- Forecast vs truth header rows -->
      <div class="space-y-1.5 font-mono text-sm tabular-nums">
        <div v-if="day.aggregate.temperature" class="flex items-center gap-2">
          <span class="text-aggregate-400 w-16 text-[10px] tracking-wide">Forecast</span>
          <WeatherIcon v-if="weatherCode != null" :code="weatherCode" size="1.25rem" />
          <span v-else class="text-paper-500 inline-flex size-5 items-center justify-center text-xs">·</span>
          <span class="text-heat-300">{{ formatTemp(day.aggregate.temperature.forecastMax, 0) }}</span>
          <span class="text-cold-300">{{ formatTemp(day.aggregate.temperature.forecastMin, 0) }}</span>
          <span class="text-rain-300 ml-auto">{{ day.aggregate.precipitation ? formatPrecip(day.aggregate.precipitation.forecastSum, 1) : "—" }}</span>
        </div>
        <div v-if="day.aggregate.temperature" class="flex items-center gap-2">
          <span class="text-truth-400 w-16 text-[10px] tracking-wide">Truth</span>
          <span class="text-paper-500 inline-flex size-5 items-center justify-center text-xs">—</span>
          <span class="text-heat-300/70">{{ formatTemp(day.aggregate.temperature.truthMax, 0) }}</span>
          <span class="text-cold-300/70">{{ formatTemp(day.aggregate.temperature.truthMin, 0) }}</span>
          <span class="text-rain-300/70 ml-auto">{{ day.aggregate.precipitation ? formatPrecip(day.aggregate.precipitation.truthSum, 1) : "—" }}</span>
        </div>
      </div>

      <!-- Score lines -->
      <div class="border-ink-700/60 mt-3 space-y-1.5 border-t pt-3 font-mono text-[11px] tabular-nums">
        <div v-if="day.aggregate.temperature" class="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <span class="text-paper-300 text-[10px] tracking-wide">Temp</span>
          <span class="text-paper-400"
            >bias <span class="text-paper-100">{{ signed(day.aggregate.temperature.bias) }}<span class="text-paper-500">°C</span></span></span
          >
          <span class="text-paper-400"
            >|MAE| <span class="text-paper-100">{{ day.aggregate.temperature.mae.toFixed(1) }}<span class="text-paper-500">°C</span></span></span
          >
          <ConfidenceBadge v-if="Number.isFinite(day.aggregate.temperature.confidence)" :value="day.aggregate.temperature.confidence" size="sm" class="ml-auto" />
        </div>
        <div v-if="day.aggregate.precipitation" class="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <span class="text-paper-300 text-[10px] tracking-wide">Precip</span>
          <span class="text-paper-400"
            >amt <span class="text-paper-100">{{ signed(day.aggregate.precipitation.amountError) }}<span class="text-paper-500">mm</span></span></span
          >
          <template v-if="Number.isFinite(day.aggregate.precipitation.timingHitRate)">
            <span class="text-paper-400">
              timing <span class="text-paper-100">{{ Math.round(day.aggregate.precipitation.timingHitRate * 100) }}<span class="text-paper-500">%</span></span>
            </span>
          </template>
          <template v-else>
            <span class="text-paper-500 text-[10px] tracking-wide">dry day</span>
          </template>
          <ConfidenceBadge v-if="Number.isFinite(day.aggregate.precipitation.confidence)" :value="day.aggregate.precipitation.confidence" size="sm" class="ml-auto" />
        </div>
      </div>

      <!-- Per-hour hit/miss strip -->
      <div v-if="day.aggregate.precipitation" class="mt-3">
        <HitMissStrip :classification="day.aggregate.precipitation.hourlyClassification" :hour-label="(i) => `${i.toString().padStart(2, '0')}:00`" />
      </div>
    </div>
  </article>
</template>
