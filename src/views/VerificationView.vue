<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";

import LocationBar from "@/components/LocationBar.vue";
import VerificationChart from "@/components/VerificationChart.vue";
import VerificationDayCard from "@/components/VerificationDayCard.vue";
import { useLocation } from "@/composables/useLocation";
import { useVerification } from "@/composables/useVerification";
import { MODELS } from "@/domain/models";
import { addDaysIso } from "@/utils/date";

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

const { loading, error, hourly, daily, weatherCodes, availableModels } = useVerification(current, runDate);

const locationLabel = computed(() => {
  const loc = current.value;
  return loc.detail ? `${loc.name}, ${loc.detail}` : loc.name;
});

const missingModelCount = computed(() => MODELS.length - availableModels.value.length);
</script>

<template>
  <div class="flex min-h-screen flex-col">
    <LocationBar />

    <main class="mx-auto w-full max-w-4xl flex-1 space-y-6 px-4 py-6 sm:px-6">
      <!-- Header / controls -->
      <section class="rounded-2xl bg-slate-900/60 p-4 ring-1 ring-slate-800 sm:p-6">
        <div class="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h1 class="text-sm font-medium tracking-wider text-slate-300 uppercase">Verification</h1>
            <p class="mt-0.5 text-xs text-slate-500">for {{ locationLabel }}</p>
          </div>
          <p class="text-xs text-slate-500">Forecast vs ERA5-Seamless truth · 7-day window from 00:00 UTC</p>
        </div>

        <div class="mt-4 flex flex-wrap items-center gap-4 text-xs">
          <label class="flex items-center gap-2 text-slate-400">
            <span>Run date</span>
            <input
              type="date"
              :value="runDate"
              :min="RETENTION_FLOOR"
              :max="maxRunDate"
              class="rounded-md border border-slate-800 bg-slate-950 px-2 py-1 text-slate-200 outline-none focus:border-slate-600"
              @input="setRunDate(($event.target as HTMLInputElement).value)"
            />
          </label>

          <label class="flex items-center gap-1 text-slate-400 sm:ml-auto">
            <input v-model="showModels" type="checkbox" class="accent-slate-400" />
            <span>Show contributing models</span>
          </label>
        </div>

        <p v-if="missingModelCount > 0 && !loading" class="mt-3 text-xs text-slate-500">{{ availableModels.length }} / {{ MODELS.length }} models available for this run date.</p>
      </section>

      <!-- Error state -->
      <div v-if="error" class="rounded-xl border border-rose-900 bg-rose-950/50 p-4 text-sm text-rose-200">
        {{ error }}
      </div>

      <!-- Loading state -->
      <div v-if="loading && !hourly" class="grid place-items-center gap-3 py-24 text-slate-500">
        <div class="size-8 animate-spin rounded-full border-2 border-slate-700 border-t-slate-300" />
        <p>Fetching historical runs + ERA5-Seamless…</p>
      </div>

      <!-- Chart -->
      <VerificationChart v-if="hourly" :hourly="hourly" :available-models="availableModels" :show-models="showModels" />

      <!-- Daily strip -->
      <section v-if="daily && daily.length">
        <h2 class="mb-3 text-sm font-medium tracking-wider text-slate-300 uppercase">Daily breakdown</h2>
        <div class="-mx-2 flex snap-x gap-3 overflow-x-auto px-2 py-1">
          <VerificationDayCard v-for="d in daily" :key="d.dayIndex" :day="d" :show-models="showModels" :weather-code="weatherCodes[d.dayIndex]" />
        </div>
      </section>
    </main>

    <footer class="py-6 text-center text-xs text-slate-500">
      Truth via ERA5-Seamless · forecasts via
      <a href="https://open-meteo.com" target="_blank" rel="noopener noreferrer" class="underline hover:text-slate-300">open-meteo.com</a>
      · informational, not a research-grade verification.
    </footer>
  </div>
</template>
