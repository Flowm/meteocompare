<script setup lang="ts">
import { computed } from "vue";

import AggregateSummary from "@/components/AggregateSummary.vue";
import DailyStrip from "@/components/DailyStrip.vue";
import HourlyChart from "@/components/HourlyChart.vue";
import LocationBar from "@/components/LocationBar.vue";
import ModelBreakdown from "@/components/ModelBreakdown.vue";
import { useForecast } from "@/composables/useForecast";
import { useLocation } from "@/composables/useLocation";

const { current } = useLocation();
const { loading, error, raw, hourly, daily, solar, contributingModels } = useForecast(current);

const locationLabel = computed(() => {
  const loc = current.value;
  return loc.detail ? `${loc.name}, ${loc.detail}` : loc.name;
});
</script>

<template>
  <div class="flex min-h-screen flex-col">
    <LocationBar />

    <main class="mx-auto w-full max-w-4xl flex-1 space-y-6 px-4 py-6 sm:px-6">
      <div v-if="error" class="rounded-xl border border-rose-900 bg-rose-950/50 p-4 text-sm text-rose-200">
        {{ error }}
      </div>

      <div v-if="loading && !raw" class="grid place-items-center gap-3 py-24 text-slate-500">
        <div class="size-8 animate-spin rounded-full border-2 border-slate-700 border-t-slate-300" />
        <p>Fetching forecasts from open-meteo…</p>
      </div>

      <template v-if="raw && hourly && daily">
        <AggregateSummary :raw="raw" :daily="daily" :solar="solar" :location-name="locationLabel" />
        <HourlyChart :hourly="hourly" :current-time="raw.current.time" :sunrise="solar?.sunrise" :sunset="solar?.sunset" />
        <DailyStrip :daily="daily" />
        <ModelBreakdown :hourly="hourly" :contributing-models="contributingModels" :current-time="raw.current.time" :sunrise="solar?.sunrise" :sunset="solar?.sunset" />
      </template>
    </main>

    <footer class="py-6 text-center text-xs text-slate-500">
      Forecasts via <a href="https://open-meteo.com" target="_blank" rel="noopener noreferrer" class="underline hover:text-slate-300">open-meteo.com</a>
      · Multi-model aggregate is informational, not a forecast of record.
    </footer>
  </div>
</template>
