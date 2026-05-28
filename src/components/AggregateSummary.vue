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
  <section class="registration border-ink-700 bg-ink-900/60 relative border px-5 py-6 sm:px-8 sm:py-8">
    <!-- Top eyebrow: classification strip ---------------------------- -->
    <div
      class="border-ink-700 text-paper-400 absolute top-0 right-5 left-5 flex items-center justify-between border-b pb-2 font-mono text-[10px] tracking-[0.22em] uppercase sm:right-8 sm:left-8"
      style="transform: translateY(-50%)"
    >
      <span class="bg-ink-900 pr-3"><span class="text-sodium-300">●</span> Live observation</span>
      <span class="bg-ink-900 pl-3 tabular-nums">
        {{ lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) }}
        <span class="text-paper-500">·</span>
        {{ lastUpdated.toLocaleDateString([], { day: "2-digit", month: "short" }) }}
      </span>
    </div>

    <div class="mt-2 grid gap-6 sm:mt-3 sm:grid-cols-[1fr_auto] sm:gap-10">
      <!-- LEFT: location + reading ---------------------------------- -->
      <div class="min-w-0">
        <div class="flex items-center gap-2">
          <span class="eyebrow">{{ locationName }}</span>
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

        <div class="mt-3 flex items-start gap-5 sm:gap-7">
          <div class="relative shrink-0">
            <!-- A halo behind the weather icon so it reads as a "lit" panel
                 element. -->
            <div class="bg-sodium-300/10 absolute inset-0 -m-3 rounded-full blur-2xl" aria-hidden="true" />
            <WeatherIcon :code="currentCode" :is-day="currentIsDay" size="3.75rem" class="text-sodium-200 relative" />
          </div>

          <div class="min-w-0">
            <div class="flex items-start gap-1">
              <span
                class="display-serif sodium-glow text-paper-50 text-7xl leading-[0.85] font-light tabular-nums sm:text-8xl"
                style="
                  font-variation-settings:
                    &quot;opsz&quot; 144,
                    &quot;wght&quot; 350,
                    &quot;SOFT&quot; 50;
                "
              >
                {{ tempWhole }}
              </span>
              <div class="flex flex-col gap-1 pt-2">
                <span
                  class="display-serif text-sodium-300 text-3xl leading-none font-extralight sm:text-4xl"
                  style="
                    font-variation-settings:
                      &quot;opsz&quot; 144,
                      &quot;wght&quot; 250;
                  "
                  >°</span
                >
                <span class="text-paper-300 font-mono text-[10px] tracking-[0.2em] uppercase">{{ tempUnitLetter }}</span>
              </div>
            </div>
            <div class="text-paper-200 mt-3 font-mono text-xs tracking-[0.18em] uppercase">
              {{ weatherLabel(currentCode) }}
            </div>
          </div>
        </div>
      </div>

      <!-- RIGHT: instrument-style readouts -------------------------- -->
      <div class="flex flex-col gap-4 sm:items-end">
        <ConfidenceBadge :value="todayConfidence" />

        <div class="border-ink-700 bg-ink-950/60 grid grid-cols-3 gap-x-5 gap-y-2 border p-4 font-mono tabular-nums sm:grid-cols-[auto_auto_auto]">
          <div class="flex flex-col gap-1">
            <span class="text-paper-400 text-[9px] tracking-[0.22em] uppercase">High</span>
            <span class="text-heat-300 text-base">{{ formatTemp(todayHigh, 0) }}</span>
          </div>
          <div class="flex flex-col gap-1">
            <span class="text-paper-400 text-[9px] tracking-[0.22em] uppercase">Low</span>
            <span class="text-cold-300 text-base">{{ formatTemp(todayLow, 0) }}</span>
          </div>
          <div class="flex flex-col gap-1">
            <span class="text-paper-400 text-[9px] tracking-[0.22em] uppercase">Precip</span>
            <span class="text-base" :class="todayPrecipProb != null && todayPrecipProb > 0 ? 'text-rain-300' : 'text-paper-400'">
              {{ todayPrecipProb != null && todayPrecipProb > 0 ? formatPercent(todayPrecipProb) : "—" }}
            </span>
          </div>
        </div>

        <div v-if="sunrise || sunset" class="text-paper-300 flex items-center gap-4 font-mono text-[11px] tabular-nums">
          <span class="flex items-center gap-1.5" title="Sunrise"> <span class="text-sodium-300">↑</span>{{ formatClock(sunrise) }} </span>
          <span class="text-ink-600">│</span>
          <span class="flex items-center gap-1.5" title="Sunset"> <span class="text-heat-400">↓</span>{{ formatClock(sunset) }} </span>
          <span v-if="dayLength" class="text-ink-600">│</span>
          <span v-if="dayLength" class="text-paper-400" title="Day length">{{ dayLength }}</span>
        </div>
      </div>
    </div>
  </section>
</template>
