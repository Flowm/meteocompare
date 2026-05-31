<script setup lang="ts">
import { computed } from "vue";

import { type ChartViewId } from "@/components/chartHelpers";
import CollapsibleSection from "@/components/CollapsibleSection.vue";
import ConditionsOutlookCard from "@/components/ConditionsOutlookCard.vue";
import HourlySeriesChart from "@/components/HourlySeriesChart.vue";
import LocationBar from "@/components/LocationBar.vue";
import WindyMap from "@/components/WindyMap.vue";
import { useForecast } from "@/composables/useForecast";
import { useLocation } from "@/composables/useLocation";

const { current } = useLocation();
const { loading, error, raw, hourly, daily, solar } = useForecast(current);

// Full variable set: the composite Temp+Precip overview plus the five
// single-variable views. Temp+Precip is the calm default (variables[0]).
// Temperature + precipitation are combinable (shown together by default); the
// composite "Temp + Precip" view is the default but no longer a standalone
// button — see HourlySeriesChart's variable toggle logic.
const FORECAST_VARIABLES: ChartViewId[] = ["temperature_2m", "precipitation", "precipitation_probability", "wind_speed_10m", "cloud_cover"];

const locationLabel = computed(() => {
  const loc = current.value;
  return loc.detail ? `${loc.name}, ${loc.detail}` : loc.name;
});
</script>

<template>
  <div class="flex min-h-screen flex-col">
    <LocationBar />

    <main class="mx-auto w-full max-w-5xl flex-1 space-y-8 px-4 py-8 sm:px-6">
      <div v-if="error" class="border-heat-500/40 bg-heat-500/5 text-heat-300 border p-4 font-mono text-xs tracking-wide"><span class="text-heat-400">[err]</span> {{ error }}</div>

      <div v-if="loading && !raw" class="grid place-items-center gap-4 py-32">
        <!-- Concentric ring loader that reads as a radar sweep -->
        <div class="relative size-12">
          <div class="border-ink-700 absolute inset-0 rounded-full border" />
          <div class="border-ink-600 absolute inset-1 rounded-full border" />
          <div class="border-ink-500 absolute inset-2 rounded-full border" />
          <div class="border-t-sodium-300 absolute inset-0 animate-spin rounded-full border border-transparent" style="animation-duration: 1.6s" />
        </div>
        <p class="text-paper-400 font-mono text-[11px] tracking-wide">Fetching observations…</p>
      </div>

      <template v-if="raw && hourly && daily">
        <CollapsibleSection title="Conditions &amp; outlook">
          <ConditionsOutlookCard :daily="daily" :raw="raw" :solar="solar" :location-name="locationLabel" />
        </CollapsibleSection>

        <CollapsibleSection title="Hourly forecast">
          <HourlySeriesChart
            title="Hourly forecast"
            :show-title="false"
            :data="hourly"
            :variables="FORECAST_VARIABLES"
            :solar="solar"
            :current-time="raw.current.time"
            :default-window="72"
          />
        </CollapsibleSection>

        <CollapsibleSection title="Windy weather radar" :default-open="false" lazy>
          <WindyMap :latitude="current.latitude" :longitude="current.longitude" :location-name="locationLabel" />
        </CollapsibleSection>
      </template>
    </main>

    <footer class="border-ink-700/60 border-t px-6 py-6 text-center">
      <p class="text-paper-400 font-mono text-[11px] tracking-wide">
        Data <span class="text-sodium-300">·</span>
        <a href="https://open-meteo.com" target="_blank" rel="noopener noreferrer" class="text-paper-200 hover:text-sodium-200 underline-offset-4 hover:underline"
          >open-meteo.com</a
        >
        <span class="text-paper-500"> // </span>
        Multi-model aggregate, informational only
      </p>
    </footer>
  </div>
</template>
