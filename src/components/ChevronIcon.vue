<script setup lang="ts">
// The small downward chevron used on dropdown/disclosure triggers (view
// switcher, variable picker, model rail). Rotates 180° when the control is
// open — pass `open`. Sizing/colour come from the caller via class attrs, which
// pass through to the root <svg>.
defineProps<{
  open?: boolean;
}>();
</script>

<template>
  <svg class="transition-transform" :class="{ 'rotate-180': open }" viewBox="0 0 12 12" fill="none" aria-hidden="true">
    <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
</template>
