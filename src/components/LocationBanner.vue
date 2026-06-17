<script setup lang="ts">
import { computed } from "vue";

import type { ForecastResponse } from "@/api/omForecast";
import type { DailyAggregate } from "@/composables/useForecast";
import { convertVar, useUnits } from "@/composables/useUnits";
import { weatherLabel } from "@/domain/weatherCodes";

import LocationLabel from "./LocationLabel.vue";
import WeatherIcon from "./WeatherIcon.vue";

const props = defineProps<{
  raw: ForecastResponse;
  daily: DailyAggregate;
  solar: { sunrise: string[]; sunset: string[] } | null;
  locationName: string;
}>();

const { temp, prefs, formatPercent } = useUnits();

const tempUnitLetter = computed(() => (temp.value === "f" ? "F" : "C"));

const currentTemp = computed(() => convertVar(props.raw.current.temperature_2m, "temperature_2m", prefs.value));
const currentCode = computed(() => Number(props.raw.current.weather_code ?? 0));
const currentIsDay = computed(() => (props.raw.current.is_day ?? 1) === 1);
const todayPrecipProb = computed(() => props.daily.series.precipitation_probability_max[0]?.value ?? null);

const sunrise = computed(() => props.solar?.sunrise[0] ?? null);
const sunset = computed(() => props.solar?.sunset[0] ?? null);

function formatClock(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

const lastUpdatedClock = computed(() => formatClock(props.raw.current.time));

// Decimal portion of the current temperature is dropped; the banner shows a
// rounded reading so the serif number reads as a compact hero value.
const tempWhole = computed(() => {
  const t = currentTemp.value;
  if (t == null || !Number.isFinite(t)) return "—";
  return `${Math.round(t)}`;
});
</script>

<template>
  <!-- Current-conditions banner. Mirrors the verification page's location
       header (registration marks, ink panel): the location anchors the left,
       the live reading the right. The section heading carries the eyebrow, and
       the per-day confidence lives on the outlook cards — so neither is
       repeated here. -->
  <div class="registration border-ink-700 bg-ink-900/60 relative flex flex-wrap items-center justify-between gap-x-6 gap-y-4 border p-4 sm:p-6">
    <!-- Location + favourite toggle -->
    <LocationLabel :name="locationName" />

    <!-- Live reading: temperature + matching-size icon, then condition + precip,
         with a quieter solar / last-updated line beneath. -->
    <div class="flex items-center gap-3 sm:gap-4">
      <div class="flex items-baseline">
        <span class="sodium-glow text-paper-50 font-mono text-4xl leading-none font-light tabular-nums">{{ tempWhole }}</span>
        <span class="text-sodium-300 font-mono text-base leading-none font-light tabular-nums">°{{ tempUnitLetter }}</span>
      </div>

      <WeatherIcon :code="currentCode" :is-day="currentIsDay" size="2.5rem" />

      <div class="flex flex-col gap-1.5">
        <div class="flex items-center gap-2.5">
          <span class="text-paper-300 font-mono text-[11px] tracking-wide" :title="weatherLabel(currentCode)">{{ weatherLabel(currentCode) }}</span>
          <span
            v-if="todayPrecipProb != null && todayPrecipProb > 5"
            class="text-rain-300 flex items-center gap-1 font-mono text-xs font-medium tabular-nums"
            :title="`Chance of precipitation: ${formatPercent(todayPrecipProb)}`"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="size-3.5" aria-hidden="true">
              <path d="M12 3s-6 7.5-6 12a6 6 0 0 0 12 0c0-4.5-6-12-6-12Z" />
            </svg>
            {{ formatPercent(todayPrecipProb) }}
          </span>
          <span v-else class="text-paper-500 font-mono text-[11px] tracking-wide">dry</span>
        </div>

        <div class="text-paper-400 flex items-center gap-3.5 font-mono text-[10px] tabular-nums">
          <span v-if="sunrise" class="flex items-center gap-1.5" :title="`Sunrise ${formatClock(sunrise)}`">
            <span class="text-sodium-300" aria-hidden="true">↑</span>{{ formatClock(sunrise) }}
          </span>
          <span v-if="sunset" class="flex items-center gap-1.5" :title="`Sunset ${formatClock(sunset)}`">
            <span class="text-heat-300" aria-hidden="true">↓</span>{{ formatClock(sunset) }}
          </span>
          <span class="flex items-center gap-1.5" :title="`Last updated ${lastUpdatedClock}`">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="size-3" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <polyline points="12 7.5 12 12 15 13.5" />
            </svg>
            {{ lastUpdatedClock }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>
