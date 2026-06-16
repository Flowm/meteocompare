<script setup lang="ts">
// The app's single loading spinner — concentric rings with a sodium sweep, so
// every loading state (cold load, refetch) reads as the same instrument. Size
// is a Tailwind size-* class so callers scale it without restyling the rings.
withDefaults(defineProps<{ size?: string }>(), { size: "size-12" });
</script>

<template>
  <div class="relative shrink-0" :class="size" aria-hidden="true">
    <div class="border-ink-700 absolute inset-0 rounded-full border" />
    <div class="border-ink-600 absolute inset-1 rounded-full border" />
    <div class="border-ink-500 absolute inset-2 rounded-full border" />
    <div class="border-t-sodium-300 absolute inset-0 animate-spin rounded-full border border-transparent" style="animation-duration: 1.6s" />
  </div>
</template>
