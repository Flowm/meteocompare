<script setup lang="ts">
import { computed } from "vue";

import { signed, useUnits } from "@/composables/useUnits";
import { applyCalibration, isCalibrated, type CalibrationSet } from "@/domain/calibration";
import type { DailyVerification, VerifiedVariable } from "@/domain/verification";

import HitMissStrip from "./HitMissStrip.vue";
import PredictabilityBadge from "./PredictabilityBadge.vue";

const props = defineProps<{
  day: DailyVerification;
  /** Resolved calibration curves for the page's location (ADR 0008); null →
   *  the badges show the stored raw scores unchanged. */
  calibration?: CalibrationSet | null;
}>();

const { formatTemp, formatPrecip } = useUnits();

// The day's lead anchor (window midpoint) — the same anchor the curves were
// fitted with, so fit and display agree on the lead band.
const leadAnchor = computed(() => (props.day.leadHoursStart + props.day.leadHoursEnd) / 2);

/** The stored day-mean raw score mapped through the calibration ladder —
 *  identity when no curve covers this (variable, band). */
const shownPredictability = (variable: VerifiedVariable, raw: number): { value: number; calibrated: boolean } => ({
  value: applyCalibration(props.calibration ?? null, variable, leadAnchor.value, raw),
  calibrated: isCalibrated(props.calibration ?? null, variable, leadAnchor.value),
});

const tempPredictability = computed(() => (props.day.aggregate.temperature ? shownPredictability("temperature_2m", props.day.aggregate.temperature.predictability) : null));
const precipPredictability = computed(() => (props.day.aggregate.precipitation ? shownPredictability("precipitation", props.day.aggregate.precipitation.predictability) : null));

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
          <span class="text-heat-300">{{ formatTemp(day.aggregate.temperature.forecastMax, 0) }}</span>
          <span class="text-cold-300">{{ formatTemp(day.aggregate.temperature.forecastMin, 0) }}</span>
          <span class="text-rain-300 ml-auto">{{ day.aggregate.precipitation ? formatPrecip(day.aggregate.precipitation.forecastSum, 1) : "—" }}</span>
        </div>
        <div v-if="day.aggregate.temperature" class="flex items-center gap-2">
          <span class="text-truth-400 w-16 text-[10px] tracking-wide">Truth</span>
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
          <PredictabilityBadge
            v-if="tempPredictability && Number.isFinite(tempPredictability.value)"
            :value="tempPredictability.value"
            :calibrated="tempPredictability.calibrated"
            size="sm"
            class="ml-auto"
          />
        </div>
        <div v-if="day.aggregate.precipitation" class="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <span class="text-paper-300 text-[10px] tracking-wide">Precip</span>
          <span class="text-paper-400"
            >amt <span class="text-paper-100">{{ signed(day.aggregate.precipitation.amountError) }}<span class="text-paper-500">mm</span></span></span
          >
          <template v-if="Number.isFinite(day.aggregate.precipitation.timingScore)">
            <span class="text-paper-400">
              timing <span class="text-paper-100">{{ Math.round(day.aggregate.precipitation.timingScore * 100) }}<span class="text-paper-500">%</span></span>
            </span>
          </template>
          <template v-else>
            <span class="text-paper-500 text-[10px] tracking-wide">dry day</span>
          </template>
          <PredictabilityBadge
            v-if="precipPredictability && Number.isFinite(precipPredictability.value)"
            :value="precipPredictability.value"
            :calibrated="precipPredictability.calibrated"
            size="sm"
            class="ml-auto"
          />
        </div>
      </div>

      <!-- Per-hour hit/miss strip -->
      <div v-if="day.aggregate.precipitation" class="mt-3">
        <HitMissStrip :classification="day.aggregate.precipitation.hourlyClassification" :hour-label="(i) => `${i.toString().padStart(2, '0')}:00`" />
      </div>
    </div>
  </article>
</template>
