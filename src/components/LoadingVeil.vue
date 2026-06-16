<script setup lang="ts">
// Wraps already-loaded content. While a re-fetch is in flight (date/location
// change) the slotted content dims and an in-flow "Updating…" indicator shows
// just above it — so the refetch is obvious instead of silently swapping the
// data, without floating a detached overlay over the page header.
import RadarSpinner from "./RadarSpinner.vue";

defineProps<{ loading: boolean }>();
</script>

<template>
  <div>
    <div v-if="loading" class="mb-3 flex justify-center sm:mb-4">
      <span
        class="border-ink-700 bg-ink-900/95 text-paper-200 flex items-center gap-2.5 border px-3.5 py-2 font-mono text-[11px] tracking-wide shadow-lg shadow-black/40 backdrop-blur"
        role="status"
        aria-live="polite"
      >
        <RadarSpinner size="size-4" />
        Updating…
      </span>
    </div>
    <div class="transition-opacity duration-200" :class="{ 'pointer-events-none opacity-40': loading }">
      <slot />
    </div>
  </div>
</template>
