<script setup lang="ts">
import { computed } from "vue";

import type { ForecastResponse } from "@/api/omForecast";
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

// Decimal portion of the current temperature is rendered smaller so the
// huge serif number reads as a typographic display rather than a flat number.
const tempWhole = computed(() => {
  const t = currentTemp.value;
  if (t == null || !Number.isFinite(t)) return "—";
  return `${Math.round(t)}`;
});
</script>

<template>
  <section class="border-ink-700 bg-ink-900/60 border p-4 sm:p-5">
    <!-- Header bar: same eyebrow + hairline-divider pattern as the chart
         card below, so the two stack as a single typographic system. -->
    <div class="border-ink-700 mb-3 flex items-center justify-between gap-3 border-b pb-3">
      <h2 class="eyebrow">Current conditions</h2>
      <span class="text-paper-400 font-mono text-[10px] tracking-[0.12em] whitespace-nowrap tabular-nums">
        <span class="text-sodium-300">●</span>
        {{ lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) }}
        <span class="hidden sm:inline">
          <span class="text-paper-500">·</span>
          {{ lastUpdated.toLocaleDateString([], { day: "2-digit", month: "short" }) }}
        </span>
      </span>
    </div>

    <!-- Location ----------------------------------------------------- -->
    <div class="flex items-center gap-1.5">
      <span class="text-paper-100 text-sm font-medium tracking-wide">{{ locationName }}</span>
      <button
        type="button"
        class="-m-1 p-1 text-sm leading-none transition-colors"
        :class="starred ? 'text-sodium-300 hover:text-sodium-200' : 'text-paper-400 hover:text-sodium-300'"
        :title="starred ? 'Remove from favourites' : 'Save as favourite'"
        :aria-pressed="starred"
        @click="toggleFavourite(current)"
      >
        {{ starred ? "★" : "☆" }}
      </button>
    </div>

    <!-- Reading + readouts ------------------------------------------ -->
    <div class="mt-2 grid gap-4 sm:mt-3 sm:grid-cols-[1fr_auto] sm:items-center sm:gap-8">
      <div class="flex items-center gap-4 sm:gap-5">
        <div class="relative shrink-0">
          <!-- A halo behind the weather icon so it reads as a "lit" panel
               element. -->
          <div class="bg-sodium-300/10 absolute inset-0 -m-2 rounded-full blur-2xl" aria-hidden="true" />
          <WeatherIcon :code="currentCode" :is-day="currentIsDay" size="2.75rem" class="text-sodium-200 relative" />
        </div>

        <div class="min-w-0">
          <div class="flex items-baseline gap-1">
            <span class="sodium-glow text-paper-50 font-mono text-5xl leading-none font-light tabular-nums sm:text-6xl">
              {{ tempWhole }}
            </span>
            <span class="text-sodium-300 font-mono text-xl leading-none font-light tabular-nums sm:text-2xl"> °{{ tempUnitLetter }} </span>
          </div>
          <div class="text-paper-200 mt-1.5 font-mono text-xs tracking-wide">
            {{ weatherLabel(currentCode) }}
          </div>
        </div>
      </div>

      <!-- Two instrument modules: temperature/precip and the solar block.
           They sit side by side when the card is wide enough and stack
           otherwise. -->
      <div class="flex flex-col gap-2.5 sm:items-end">
        <ConfidenceBadge :value="todayConfidence" />

        <div class="flex flex-col gap-2.5 sm:flex-row sm:gap-3">
          <!-- High / Low / Precip -->
          <div class="border-ink-700 bg-ink-950/60 grid grid-cols-3 gap-x-4 gap-y-1 border px-3 py-2 font-mono tabular-nums">
            <div class="flex flex-col gap-0.5">
              <span class="text-paper-400 text-[10px] tracking-wide">High</span>
              <span class="text-heat-300 text-sm">{{ formatTemp(todayHigh, 0) }}</span>
            </div>
            <div class="flex flex-col gap-0.5">
              <span class="text-paper-400 text-[10px] tracking-wide">Low</span>
              <span class="text-cold-300 text-sm">{{ formatTemp(todayLow, 0) }}</span>
            </div>
            <div class="flex flex-col gap-0.5">
              <span class="text-paper-400 text-[10px] tracking-wide">Precip</span>
              <span class="text-sm" :class="todayPrecipProb != null && todayPrecipProb > 0 ? 'text-rain-300' : 'text-paper-400'">
                {{ todayPrecipProb != null && todayPrecipProb > 0 ? formatPercent(todayPrecipProb) : "—" }}
              </span>
            </div>
          </div>

          <!-- Sunrise / Sunset / Total sun -->
          <div v-if="sunrise || sunset" class="border-ink-700 bg-ink-950/60 grid grid-cols-3 gap-x-4 gap-y-1 border px-3 py-2 font-mono tabular-nums">
            <div class="flex flex-col gap-0.5">
              <span class="text-paper-400 text-[10px] tracking-wide">Sunrise</span>
              <span class="text-sodium-300 text-sm">{{ formatClock(sunrise) }}</span>
            </div>
            <div class="flex flex-col gap-0.5">
              <span class="text-paper-400 text-[10px] tracking-wide">Sunset</span>
              <span class="text-heat-300 text-sm">{{ formatClock(sunset) }}</span>
            </div>
            <div class="flex flex-col gap-0.5">
              <span class="text-paper-400 text-[10px] tracking-wide">Total sun</span>
              <span class="text-paper-200 text-sm">{{ dayLength ?? "—" }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
