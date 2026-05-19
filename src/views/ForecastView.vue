<script setup lang="ts">
import { computed } from 'vue'
import LocationBar from '@/components/LocationBar.vue'
import AggregateSummary from '@/components/AggregateSummary.vue'
import HourlyChart from '@/components/HourlyChart.vue'
import DailyStrip from '@/components/DailyStrip.vue'
import ModelBreakdown from '@/components/ModelBreakdown.vue'
import { useLocation } from '@/composables/useLocation'
import { useForecast } from '@/composables/useForecast'

const { current } = useLocation()
const { loading, error, raw, hourly, daily, contributingModels } = useForecast(current)

const locationLabel = computed(() => {
  const loc = current.value
  return loc.detail ? `${loc.name}, ${loc.detail}` : loc.name
})
</script>

<template>
  <div class="min-h-screen flex flex-col">
    <LocationBar />

    <main class="flex-1 max-w-4xl w-full mx-auto px-4 sm:px-6 py-6 space-y-6">
      <div v-if="error" class="rounded-xl bg-rose-950/50 border border-rose-900 text-rose-200 p-4 text-sm">
        {{ error }}
      </div>

      <div v-if="loading && !raw" class="grid place-items-center py-24 text-slate-500 gap-3">
        <div class="size-8 rounded-full border-2 border-slate-700 border-t-slate-300 animate-spin" />
        <p>Fetching forecasts from open-meteo…</p>
      </div>

      <template v-if="raw && hourly && daily">
        <AggregateSummary :raw="raw" :daily="daily" :location-name="locationLabel" />
        <HourlyChart :hourly="hourly" :current-time="raw.current.time" />
        <DailyStrip :daily="daily" />
        <ModelBreakdown
          :hourly="hourly"
          :contributing-models="contributingModels"
          :current-time="raw.current.time"
        />
      </template>
    </main>

    <footer class="text-center text-xs text-slate-500 py-6">
      Forecasts via <a href="https://open-meteo.com" target="_blank" rel="noopener noreferrer" class="underline hover:text-slate-300">open-meteo.com</a>
      · Multi-model aggregate is informational, not a forecast of record.
    </footer>
  </div>
</template>
