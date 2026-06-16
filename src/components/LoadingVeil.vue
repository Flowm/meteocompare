<script setup lang="ts">
// Wraps already-loaded content. While a re-fetch is in flight (date/location
// change) the slotted content dims and an "Updating…" indicator floats at the
// centre of the viewport — so the refetch is obvious instead of silently
// swapping the data, without reflowing the page.
import RadarSpinner from "./RadarSpinner.vue";

defineProps<{ loading: boolean }>();
</script>

<template>
  <div>
    <!-- Fixed, viewport-centred overlay so showing it never reflows the page.
         pointer-events-none lets the header stay usable; the dimmed content
         below is already inert. -->
    <div v-if="loading" class="pointer-events-none fixed inset-0 z-50 grid place-items-center">
      <span
        class="border-ink-700 bg-ink-900/95 text-paper-200 flex items-center gap-2.5 border px-3.5 py-2 font-mono text-[11px] tracking-wide shadow-2xl shadow-black/50 backdrop-blur"
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
