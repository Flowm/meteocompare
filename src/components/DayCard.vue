<script setup lang="ts">
import { computed, ref } from "vue";

import type { DayPredictability } from "@/analysis/forecastEvaluation";
import { useUnits } from "@/composables/useUnits";
import { predictabilityTier } from "@/domain/predictability";
import { weatherLabel } from "@/domain/weatherCodes";

import PredictabilityBadge from "./PredictabilityBadge.vue";
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
  /** null → no contributing models; render the fallback icon and no label. */
  code: number | null;
  high: number;
  low: number;
  precipProb: number | null;
  precipSum: number | null;
  windSpeed: number | null;
  windDirection: number | null;
  predictability: DayPredictability;
  highlight?: boolean;
  models?: ModelRow[];
}>();

const { formatTemp, formatPercent, formatPrecip, formatWind, compassPoint } = useUnits();

const expanded = ref(false);
const predictabilityExpanded = ref(false);

// Percent color per tier — the badge's typographic registers, reused so the
// readout rows and the badge read as one instrument.
const TIER_TEXT = { high: "text-predictability-high", mid: "text-sodium-200", low: "text-heat-300" } as const;

/** The badge readout's two per-variable rows in instrument shorthand (ADR
 *  0008/0010): tier-colored percent, then event + provenance as a terse tag
 *  ("±2 °C · global fit") instead of prose. Full sentences live in the badge's
 *  hover title. */
const predictabilityRows = computed(() => {
  const row = (label: string, value: number | null, source: "device" | "builtin" | null, event: string) => {
    if (value == null || !Number.isFinite(value)) return null;
    const provenance = source === "device" ? "local fit" : source === "builtin" ? "global fit" : "uncalibrated";
    return {
      label,
      pct: Math.round(value * 100),
      tone: TIER_TEXT[predictabilityTier(value, source ? "calibrated" : "raw")],
      tag: `${event} · ${provenance}`,
    };
  };
  return [
    row("Temp", props.predictability.temperature, props.predictability.temperatureSource, "±2 °C"),
    row("Rain", props.predictability.precipitation, props.predictability.precipitationSource, "wet/dry"),
  ].filter((r) => r !== null);
});

/** The arrow visually points where the wind is going TO. Meteorological convention
 *  reports the direction the wind is coming FROM, so we rotate by direction + 180°. */
const arrowRotation = computed(() => (props.windDirection != null && !Number.isNaN(props.windDirection) ? (props.windDirection + 180) % 360 : 0));

const dayLabel = computed(() => {
  const d = new Date(props.date);
  if (props.highlight) return "Today";
  return d.toLocaleDateString([], { weekday: "short" });
});

const dateLabel = computed(() => new Date(props.date).toLocaleDateString([], { day: "numeric", month: "short" }));

// null code (no contributing models) → no descriptive label; the icon falls
// back to the "n/a" glyph via WeatherIcon.
const codeLabel = computed(() => (props.code == null ? "–" : weatherLabel(props.code)));

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
      <div class="text-paper-300 mt-1 truncate text-center font-mono text-[10px] tracking-wide" :title="codeLabel">
        {{ codeLabel }}
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

      <div class="relative mt-3 flex justify-center">
        <!-- Clicking the badge toggles the floating readout with the min's two
             parts (ADR 0009) — its own toggle, not the card's. -->
        <button
          type="button"
          class="cursor-pointer"
          :aria-expanded="predictabilityExpanded"
          aria-label="Predictability details"
          @click.stop="predictabilityExpanded = !predictabilityExpanded"
        >
          <PredictabilityBadge :value="predictability.overall" :calibrated="predictability.calibrated" size="sm" />
        </button>

        <!-- Floating instrument readout: overlays the card body just above the
             badge (never reflows the card, never clipped by the snap rail —
             it stays inside the card's own footprint). -->
        <Transition
          enter-active-class="transition duration-150 ease-out"
          leave-active-class="transition duration-100 ease-in"
          enter-from-class="translate-y-1 opacity-0"
          leave-to-class="translate-y-1 opacity-0"
        >
          <div
            v-if="predictabilityExpanded && predictabilityRows.length"
            class="border-ink-600 bg-ink-950/95 shadow-ink-950/60 absolute inset-x-0 bottom-full z-10 mb-1.5 border px-2 py-1.5 shadow-lg"
            @click.stop="predictabilityExpanded = false"
          >
            <div class="text-paper-500 border-ink-700/60 mb-1 border-b pb-1 font-mono text-[8px] tracking-[0.15em] uppercase">Predictability</div>
            <div v-for="r in predictabilityRows" :key="r.label" class="flex items-baseline justify-between gap-2 py-px font-mono">
              <span class="text-paper-400 text-[10px]">{{ r.label }}</span>
              <span class="text-paper-500 flex-1 truncate text-right text-[8px] tracking-wide">{{ r.tag }}</span>
              <span class="text-[10px] font-medium tabular-nums" :class="r.tone">{{ r.pct }}%</span>
            </div>
          </div>
        </Transition>
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
