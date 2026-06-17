<script setup lang="ts">
import { computed } from "vue";

import AppFooter from "@/components/AppFooter.vue";
import { type ChartViewId } from "@/components/chartHelpers";
import CollapsibleSection from "@/components/CollapsibleSection.vue";
import DailyStrip from "@/components/DailyStrip.vue";
import HourlySeriesChart from "@/components/HourlySeriesChart.vue";
import LoadingVeil from "@/components/LoadingVeil.vue";
import LocationBanner from "@/components/LocationBanner.vue";
import LocationBar from "@/components/LocationBar.vue";
import RadarSpinner from "@/components/RadarSpinner.vue";
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

    <main class="mx-auto w-full max-w-5xl flex-1 space-y-3 px-4 py-3 sm:space-y-8 sm:px-6 sm:py-8">
      <div v-if="error" class="border-heat-500/40 bg-heat-500/5 text-heat-300 border p-4 font-mono text-xs tracking-wide"><span class="text-heat-400">[err]</span> {{ error }}</div>

      <div v-if="loading && !raw" class="grid place-items-center gap-4 py-32">
        <RadarSpinner />
        <p class="text-paper-400 font-mono text-[11px] tracking-wide">Fetching observations…</p>
      </div>

      <!-- LoadingVeil dims the forecast and shows an "Updating…" indicator while
           a location change re-fetches, instead of leaving stale data on screen. -->
      <LoadingVeil v-if="raw && hourly && daily" :loading="loading">
        <div class="space-y-3 sm:space-y-8">
          <CollapsibleSection title="Location" :summary="locationLabel">
            <LocationBanner :daily="daily" :raw="raw" :solar="solar" :location-name="locationLabel" />
          </CollapsibleSection>

          <CollapsibleSection title="Daily outlook">
            <DailyStrip :daily="daily" />
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
        </div>
      </LoadingVeil>
    </main>

    <AppFooter>Multi-model aggregate, informational only</AppFooter>
  </div>
</template>
