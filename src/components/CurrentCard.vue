<script setup lang="ts">
import { computed } from "vue";

import type { ForecastResponse } from "@/api/omForecast";
import type { DailyAggregate } from "@/composables/useForecast";
import { useLocation } from "@/composables/useLocation";
import { useUnits } from "@/composables/useUnits";
import { overallConfidence } from "@/domain/confidence";
import { weatherLabel } from "@/domain/weatherCodes";

import ConfidenceBadge from "./ConfidenceBadge.vue";
import WeatherIcon from "./WeatherIcon.vue";

const props = defineProps<{
  raw: ForecastResponse;
  daily: DailyAggregate;
  solar: { sunrise: string[]; sunset: string[] } | null;
  locationName: string;
}>();

const { current, isFavourite, toggleFavourite } = useLocation();
const starred = computed(() => isFavourite(current.value));

const { temp, formatTemp, formatPercent } = useUnits();

const tempUnitLetter = computed(() => (temp.value === "f" ? "F" : "C"));

const currentTemp = computed(() => {
  const t = props.raw.current.temperature_2m;
  if (t == null) return null;
  return temp.value === "f" ? (t * 9) / 5 + 32 : t;
});
const currentCode = computed(() => Number(props.raw.current.weather_code ?? 0));
const currentIsDay = computed(() => (props.raw.current.is_day ?? 1) === 1);
const todayHigh = computed(() => props.daily.series.temperature_2m_max[0]?.value ?? null);
const todayLow = computed(() => props.daily.series.temperature_2m_min[0]?.value ?? null);
const todayPrecipProb = computed(() => props.daily.series.precipitation_probability_max[0]?.value ?? null);
const todayConfidence = computed(() =>
  overallConfidence([props.daily.confidence.temperature_2m_max[0], props.daily.confidence.precipitation_sum[0], props.daily.confidence.weather_code[0]]),
);
const lastUpdated = computed(() => new Date(props.raw.current.time));

const sunrise = computed(() => props.solar?.sunrise[0] ?? null);
const sunset = computed(() => props.solar?.sunset[0] ?? null);

function formatClock(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// Decimal portion of the current temperature is dropped; the card shows a
// rounded reading so the serif number reads as a compact display.
const tempWhole = computed(() => {
  const t = currentTemp.value;
  if (t == null || !Number.isFinite(t)) return "—";
  return `${Math.round(t)}`;
});
</script>

<template>
  <!-- The live-conditions card. Shares the DayCard chrome so it reads as the
       leading entry in the same strip, but carries the live reading, the
       location, and the solar block the day cards omit. -->
  <div class="group border-sodium-300/60 bg-ink-850/80 relative flex min-w-[14rem] flex-shrink-0 flex-col border sm:min-w-[15rem]">
    <!-- Header row: "Now" + the observation time, mirroring DayCard's header -->
    <div class="border-ink-700/60 flex items-baseline justify-between border-b px-3 py-2">
      <span class="text-sodium-300 font-mono text-xs font-semibold tracking-wide">Now</span>
      <span class="text-paper-400 font-mono text-[10px] tracking-wide tabular-nums">
        <span class="text-sodium-300">●</span>
        {{ lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) }}
      </span>
    </div>

    <div class="flex flex-1 flex-col px-3 pt-3 pb-3">
      <!-- Location + favourite toggle -->
      <div class="flex items-center justify-center gap-1">
        <span class="text-paper-100 truncate text-center font-mono text-[11px] tracking-wide" :title="locationName">{{ locationName }}</span>
        <button
          type="button"
          class="-m-1 shrink-0 p-1 text-xs leading-none transition-colors"
          :class="starred ? 'text-sodium-300 hover:text-sodium-200' : 'text-paper-400 hover:text-sodium-300'"
          :title="starred ? 'Remove from favourites' : 'Save as favourite'"
          :aria-pressed="starred"
          @click="toggleFavourite(current)"
        >
          {{ starred ? "★" : "☆" }}
        </button>
      </div>

      <!-- Live reading: icon + big temperature -->
      <div class="mt-2 flex items-center justify-center gap-2">
        <WeatherIcon :code="currentCode" :is-day="currentIsDay" size="2.25rem" />
        <div class="flex items-baseline">
          <span class="sodium-glow text-paper-50 font-mono text-4xl leading-none font-light tabular-nums">{{ tempWhole }}</span>
          <span class="text-sodium-300 font-mono text-base leading-none font-light tabular-nums">°{{ tempUnitLetter }}</span>
        </div>
      </div>
      <div class="text-paper-300 mt-1 truncate text-center font-mono text-[10px] tracking-wide" :title="weatherLabel(currentCode)">
        {{ weatherLabel(currentCode) }}
      </div>

      <!-- High / low presented as a paired register (matches DayCard) -->
      <div class="divide-ink-700/60 border-ink-700/60 mt-3 grid grid-cols-2 divide-x border-y py-1.5 font-mono tabular-nums">
        <div class="flex flex-col items-center gap-0.5">
          <span class="text-paper-400 text-[9px] tracking-wide">Hi</span>
          <span class="text-heat-300 text-sm font-medium">{{ formatTemp(todayHigh, 0) }}</span>
        </div>
        <div class="flex flex-col items-center gap-0.5">
          <span class="text-paper-400 text-[9px] tracking-wide">Lo</span>
          <span class="text-cold-300 text-sm font-medium">{{ formatTemp(todayLow, 0) }}</span>
        </div>
      </div>

      <div class="mt-2 flex items-center justify-center gap-1.5 font-mono text-[10px] tabular-nums">
        <template v-if="todayPrecipProb != null && todayPrecipProb > 5">
          <span class="bg-rain-400 size-1 rounded-full" aria-hidden="true" />
          <span class="text-rain-300">{{ formatPercent(todayPrecipProb) }}</span>
        </template>
        <template v-else>
          <span class="text-paper-500 tracking-wide">dry</span>
        </template>
      </div>

      <!-- Solar block: sunrise / sunset, the live card's extra detail -->
      <div v-if="sunrise || sunset" class="text-paper-300 mt-2 flex items-center justify-center gap-3 font-mono text-[10px] tabular-nums">
        <span class="flex items-center gap-1" :title="`Sunrise ${formatClock(sunrise)}`">
          <span class="text-sodium-300" aria-hidden="true">↑</span>{{ formatClock(sunrise) }}
        </span>
        <span class="flex items-center gap-1" :title="`Sunset ${formatClock(sunset)}`"> <span class="text-heat-300" aria-hidden="true">↓</span>{{ formatClock(sunset) }} </span>
      </div>

      <div class="mt-auto flex justify-center pt-3">
        <ConfidenceBadge :value="todayConfidence" size="sm" />
      </div>
    </div>
  </div>
</template>
