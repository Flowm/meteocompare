<script setup lang="ts">
import { computed } from "vue";

import { usePullToRefresh } from "@/composables/usePullToRefresh";

import RadarSpinner from "./RadarSpinner.vue";

const { distance, progress, refreshing } = usePullToRefresh({
  onRefresh: () => {
    // A full document reload, not an in-app state refresh: this is the only
    // path that re-runs the service-worker update check (the browser refetches
    // the SW script on navigation) and picks up a freshly precached app shell.
    // If a new SW is found, usePWAUpdate's autoUpdate reloads once more into it.
    // Brief beat so the spinner paints and the indicator settles before the
    // document tears down.
    window.setTimeout(() => window.location.reload(), 250);
  },
});

const ready = computed(() => progress.value >= 1);

// Dial geometry: a ring whose sodium arc winds up from empty to full as the
// pull nears the trigger threshold — reads as an instrument "charging up".
const RADIUS = 9;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const arc = computed(() => `${CIRCUMFERENCE * progress.value} ${CIRCUMFERENCE}`);
</script>

<template>
  <!-- Fixed strip pinned under the top edge. It tracks the finger 1:1 while
       pulling (no transition); on release or refresh it eases back / settles.
       z-40 sits above the sticky header (z-30) but below the updating veil. -->
  <div
    class="pointer-events-none fixed inset-x-0 top-0 z-40 flex justify-center"
    :class="{ 'transition-all duration-300 ease-out': refreshing || distance === 0 }"
    :style="{ transform: `translateY(${distance}px)`, opacity: refreshing ? 1 : progress }"
    aria-hidden="true"
  >
    <!-- -translate-y-[150%] parks the dial above the edge at rest, so it slides
         into view as the parent translates down with the pull. -->
    <div class="border-ink-700 bg-ink-900/95 mt-2 flex size-10 -translate-y-[150%] items-center justify-center rounded-full border shadow-2xl shadow-black/50 backdrop-blur">
      <RadarSpinner v-if="refreshing" size="size-5" />
      <svg v-else viewBox="0 0 24 24" class="size-5 -rotate-90" fill="none">
        <circle cx="12" cy="12" :r="RADIUS" class="stroke-ink-700" stroke-width="2.5" />
        <circle
          cx="12"
          cy="12"
          :r="RADIUS"
          class="transition-colors"
          :class="ready ? 'stroke-sodium-300' : 'stroke-sodium-500'"
          stroke-width="2.5"
          stroke-linecap="round"
          :stroke-dasharray="arc"
        />
      </svg>
    </div>
  </div>
</template>
