<script setup lang="ts">
import AppFooter from "@/components/AppFooter.vue";
import { type ChartViewId } from "@/components/chartHelpers";
import CollapsibleSection from "@/components/CollapsibleSection.vue";
import DailyStrip from "@/components/DailyStrip.vue";
import HourlySeriesChart from "@/components/HourlySeriesChart.vue";
import LoadingVeil from "@/components/LoadingVeil.vue";
import LocationBanner from "@/components/LocationBanner.vue";
import LocationBar from "@/components/LocationBar.vue";
import StateBlock from "@/components/StateBlock.vue";
import WindyMap from "@/components/WindyMap.vue";
import { useForecast } from "@/composables/useForecast";
import { useLocation } from "@/composables/useLocation";

const { current, label: locationLabel } = useLocation();
const { loading, error, current: conditions, hourly, daily, solar } = useForecast(current);

// Full variable set: the composite Temp+Precip overview plus the five
// single-variable views. Temp+Precip is the calm default (variables[0]).
// Temperature + precipitation are combinable (shown together by default); the
// composite "Temp + Precip" view is the default but no longer a standalone
// button — see HourlySeriesChart's variable toggle logic.
const FORECAST_VARIABLES: ChartViewId[] = ["temperature_2m", "precipitation", "precipitation_probability", "wind_speed_10m", "cloud_cover"];
</script>

<template>
  <div class="flex min-h-screen flex-col">
    <LocationBar />

    <main class="mx-auto w-full max-w-5xl flex-1 space-y-3 px-4 py-3 sm:space-y-8 sm:px-6 sm:py-8">
      <StateBlock v-if="error" kind="error">{{ error }}</StateBlock>

      <StateBlock v-if="loading && !conditions" kind="loading" caption="Fetching observations…" />

      <!-- LoadingVeil dims the forecast and shows an "Updating…" indicator while
           a location change re-fetches, instead of leaving stale data on screen. -->
      <LoadingVeil v-if="conditions && hourly && daily" :loading="loading">
        <div class="space-y-3 sm:space-y-8">
          <CollapsibleSection title="Location" :summary="locationLabel">
            <LocationBanner :daily="daily" :current="conditions" :solar="solar" :location-name="locationLabel" />
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
              :current-time="conditions.time"
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
