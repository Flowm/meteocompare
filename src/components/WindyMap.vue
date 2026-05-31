<script setup lang="ts">
import { computed } from "vue";

import { useUnits } from "@/composables/useUnits";

const props = defineProps<{
  latitude: number;
  longitude: number;
  locationName: string;
}>();

const iframeTitle = computed(() => `Windy radar map for ${props.locationName}`);

const { temp, precip, wind } = useUnits();

const windySrc = computed(() => {
  const params = new URLSearchParams({
    type: "map",
    location: "coordinates",
    metricRain: precip.value === "in" ? "in" : "mm",
    metricTemp: temp.value === "f" ? "°F" : "°C",
    metricWind: wind.value === "mph" ? "mph" : "km/h",
    zoom: "9",
    overlay: "radar",
    product: "radar",
    level: "surface",
    lat: props.latitude.toFixed(3),
    lon: props.longitude.toFixed(3),
  });

  return `https://embed.windy.com/embed.html?${params.toString()}`;
});
</script>

<template>
  <div class="border-ink-700 bg-ink-900/60 overflow-hidden border">
    <iframe class="bg-ink-950 h-112 w-full border-0" :src="windySrc" :title="iframeTitle" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>
  </div>
</template>
