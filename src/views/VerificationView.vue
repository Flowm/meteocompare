<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";

import { type ChartViewId } from "@/components/chartHelpers";
import HourlySeriesChart from "@/components/HourlySeriesChart.vue";
import LocationBar from "@/components/LocationBar.vue";
import VerificationDayCard from "@/components/VerificationDayCard.vue";
import { useLocation } from "@/composables/useLocation";
import { useVerification } from "@/composables/useVerification";
import { MODELS } from "@/domain/models";
import { addDaysIso } from "@/utils/date";

// ERA5-Seamless provides truth only for temperature and precipitation
// (ADR 0001). Wind/cloud truth would be a future, data-only addition.
const VERIFY_VARIABLES: ChartViewId[] = ["temperature_2m", "precipitation"];

const route = useRoute();
const router = useRouter();
const { current } = useLocation();

// Date bounds (see ADR 0001 + grilling notes):
// - max = today − 12 days: ERA5-Seamless ~5-day lag + 7-day forward window
// - min = 2025-09-01: single-runs API retention cutoff for most models
const TRUTH_LAG_DAYS = 12;
const RETENTION_FLOOR = "2025-09-01";
const DEFAULT_OFFSET_DAYS = 14;

function todayIsoUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

const maxRunDate = computed(() => addDaysIso(todayIsoUTC(), -TRUTH_LAG_DAYS));
const defaultRunDate = computed(() => addDaysIso(todayIsoUTC(), -DEFAULT_OFFSET_DAYS));

const runDate = computed<string>(() => {
  const r = route.query.runDate;
  if (typeof r === "string" && r >= RETENTION_FLOOR && r <= maxRunDate.value) return r;
  return defaultRunDate.value;
});

function setRunDate(newDate: string): void {
  void router.replace({ query: { ...route.query, runDate: newDate } });
}

const showModels = ref(false);

const { loading, error, hourly, daily, weatherCodes, availableModels, solar } = useVerification(current, runDate);

const locationLabel = computed(() => {
  const loc = current.value;
  return loc.detail ? `${loc.name}, ${loc.detail}` : loc.name;
});

const missingModelCount = computed(() => MODELS.length - availableModels.value.length);
</script>

<template>
  <div class="flex min-h-screen flex-col">
    <LocationBar />

    <main class="mx-auto w-full max-w-5xl flex-1 space-y-8 px-4 py-8 sm:px-6">
      <!-- Header / controls -->
      <section class="registration border-ink-700 bg-ink-900/60 relative border p-5 sm:p-6">
        <div class="border-ink-700 flex flex-wrap items-baseline justify-between gap-3 border-b pb-3">
          <div>
            <h1 class="eyebrow-sodium flex items-center gap-2">
              <span class="bg-sodium-300 size-1.5 rounded-full" />
              Verification
            </h1>
            <p class="text-paper-50 mt-1 font-mono text-sm tracking-[0.05em]">
              {{ locationLabel }}
            </p>
          </div>
          <p class="text-paper-400 max-w-xs text-right font-mono text-[10px] tracking-[0.14em] uppercase">
            Forecast vs ERA5-Seamless truth
            <br /><span class="text-paper-500">7-day window · 00:00 UTC</span>
          </p>
        </div>

        <div class="mt-4 flex flex-wrap items-center gap-4">
          <label class="text-paper-300 flex items-center gap-2.5 font-mono text-[10px] tracking-[0.18em] uppercase">
            <span>Run date</span>
            <input
              type="date"
              :value="runDate"
              :min="RETENTION_FLOOR"
              :max="maxRunDate"
              class="border-ink-700 bg-ink-950 text-paper-50 focus:border-sodium-300/60 border px-2 py-1 font-mono text-xs tracking-normal outline-none"
              @input="setRunDate(($event.target as HTMLInputElement).value)"
            />
          </label>
        </div>

        <p v-if="missingModelCount > 0 && !loading" class="text-paper-400 mt-3 font-mono text-[10px] tracking-[0.14em] uppercase">
          <span class="text-sodium-300">·</span> {{ availableModels.length }}/{{ MODELS.length }} models available
        </p>
      </section>

      <!-- Error state -->
      <div v-if="error" class="border-heat-500/40 bg-heat-500/5 text-heat-300 border p-4 font-mono text-xs tracking-[0.1em] uppercase">
        <span class="text-heat-400">[ERR]</span> {{ error }}
      </div>

      <!-- Loading state -->
      <div v-if="loading && !hourly" class="grid place-items-center gap-4 py-32">
        <div class="relative size-12">
          <div class="border-ink-700 absolute inset-0 rounded-full border" />
          <div class="border-ink-600 absolute inset-1 rounded-full border" />
          <div class="border-ink-500 absolute inset-2 rounded-full border" />
          <div class="border-t-sodium-300 absolute inset-0 animate-spin rounded-full border border-transparent" style="animation-duration: 1.6s" />
        </div>
        <p class="text-paper-400 font-mono text-[10px] tracking-[0.22em] uppercase">Loading historical runs + ERA5…</p>
      </div>

      <!-- Chart -->
      <HourlySeriesChart
        v-if="hourly"
        v-model:showModels="showModels"
        title="Hourly verification"
        :data="hourly"
        :variables="VERIFY_VARIABLES"
        :solar="solar"
        :default-window="168"
      />

      <!-- Daily strip -->
      <section v-if="daily && daily.length">
        <h2 class="eyebrow mb-3 flex items-center gap-2">
          <span class="bg-sodium-300/50 inline-block h-px w-6" />
          Daily breakdown
        </h2>
        <div class="-mx-2 flex snap-x gap-2 overflow-x-auto px-2 pt-1 pb-3">
          <VerificationDayCard v-for="d in daily" :key="d.dayIndex" :day="d" :show-models="showModels" :weather-code="weatherCodes[d.dayIndex]" />
        </div>
      </section>
    </main>

    <footer class="border-ink-700/60 border-t px-6 py-6 text-center">
      <p class="text-paper-400 font-mono text-[10px] tracking-[0.22em] uppercase">
        Truth <span class="text-sodium-300">·</span> ERA5-Seamless
        <span class="text-paper-500"> // </span>
        Forecasts <span class="text-sodium-300">·</span>
        <a href="https://open-meteo.com" target="_blank" rel="noopener noreferrer" class="text-paper-200 hover:text-sodium-200 underline-offset-4 hover:underline"
          >open-meteo.com</a
        >
      </p>
    </footer>
  </div>
</template>
