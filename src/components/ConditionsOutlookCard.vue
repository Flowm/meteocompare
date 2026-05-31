<script setup lang="ts">
import type { ForecastResponse } from "@/api/omForecast";
import type { DailyAggregate } from "@/composables/useForecast";

import CurrentCard from "./CurrentCard.vue";
import DailyStrip from "./DailyStrip.vue";

const props = defineProps<{
  daily: DailyAggregate;
  raw: ForecastResponse;
  solar: { sunrise: string[]; sunset: string[] } | null;
  locationName: string;
}>();
</script>

<template>
  <div class="flex snap-x gap-2 overflow-x-auto pt-1 pb-3">
    <CurrentCard class="snap-start" :raw="props.raw" :daily="props.daily" :solar="props.solar" :location-name="props.locationName" />
    <DailyStrip :daily="props.daily" />
  </div>
</template>
