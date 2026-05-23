<script setup lang="ts">
import { computed } from "vue";

import type { ForecastResponse } from "@/api/openMeteo";
import type { DailyAggregate } from "@/composables/useForecast";
import { useLocation } from "@/composables/useLocation";
import { useUnits } from "@/composables/useUnits";
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

const { formatTemp, formatPercent } = useUnits();

const currentTemp = computed(() => props.raw.current.temperature_2m ?? null);
const currentCode = computed(() => Number(props.raw.current.weather_code ?? 0));
const currentIsDay = computed(() => (props.raw.current.is_day ?? 1) === 1);
const todayHigh = computed(() => props.daily.series.temperature_2m_max[0]?.value ?? null);
const todayLow = computed(() => props.daily.series.temperature_2m_min[0]?.value ?? null);
const todayPrecipProb = computed(() => props.daily.series.precipitation_probability_max[0]?.value ?? null);
const todayConfidence = computed(() => {
  const vals = [props.daily.confidence.temperature_2m_max[0], props.daily.confidence.precipitation_sum[0], props.daily.confidence.weather_code[0]].filter((v): v is number =>
    Number.isFinite(v),
  );
  if (vals.length === 0) return 0;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
});
const lastUpdated = computed(() => new Date(props.raw.current.time));

const sunrise = computed(() => props.solar?.sunrise[0] ?? null);
const sunset = computed(() => props.solar?.sunset[0] ?? null);

function formatClock(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

const dayLength = computed(() => {
  if (!sunrise.value || !sunset.value) return null;
  const ms = new Date(sunset.value).getTime() - new Date(sunrise.value).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const totalMin = Math.round(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}h ${m.toString().padStart(2, "0")}m`;
});
</script>

<template>
  <section class="rounded-2xl bg-slate-900/60 p-6 ring-1 ring-slate-800 sm:p-8">
    <div class="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
      <div class="flex items-center gap-5">
        <WeatherIcon :code="currentCode" :is-day="currentIsDay" size="4.5rem" />
        <div>
          <div class="flex items-center gap-1.5">
            <div class="text-sm tracking-wider text-slate-400 uppercase">{{ locationName }}</div>
            <button
              type="button"
              class="-m-1 rounded-md p-1 text-base leading-none transition-colors"
              :class="starred ? 'text-amber-300 hover:text-amber-200' : 'text-slate-500 hover:text-amber-300'"
              :title="starred ? 'Remove from favourites' : 'Save as favourite'"
              :aria-pressed="starred"
              @click="toggleFavourite(current)"
            >
              {{ starred ? "★" : "☆" }}
            </button>
          </div>
          <div class="mt-0.5 flex items-baseline gap-3">
            <div class="text-5xl font-semibold tabular-nums sm:text-6xl">{{ formatTemp(currentTemp, 0) }}</div>
            <div class="hidden text-slate-300 sm:block">{{ weatherLabel(currentCode) }}</div>
          </div>
          <div class="mt-1 text-sm text-slate-300 sm:hidden">{{ weatherLabel(currentCode) }}</div>
        </div>
      </div>

      <div class="flex flex-col items-start gap-2 sm:items-end">
        <ConfidenceBadge :value="todayConfidence" />
        <div class="text-sm text-slate-300 tabular-nums">
          <span class="text-rose-300">{{ formatTemp(todayHigh, 0) }}</span>
          <span class="mx-2 text-slate-500">·</span>
          <span class="text-sky-300">{{ formatTemp(todayLow, 0) }}</span>
          <template v-if="todayPrecipProb != null && todayPrecipProb > 0">
            <span class="mx-2 text-slate-500">·</span>
            <span>💧 {{ formatPercent(todayPrecipProb) }}</span>
          </template>
        </div>
        <div v-if="sunrise || sunset" class="flex items-center gap-3 text-xs text-slate-400 tabular-nums">
          <span title="Sunrise"><span class="text-amber-300">↑</span> {{ formatClock(sunrise) }}</span>
          <span title="Sunset"><span class="text-orange-400">↓</span> {{ formatClock(sunset) }}</span>
          <span v-if="dayLength" class="text-slate-500" title="Day length">· {{ dayLength }}</span>
        </div>
        <div class="text-xs text-slate-500" :title="lastUpdated.toString()">Updated {{ lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) }}</div>
      </div>
    </div>
  </section>
</template>
