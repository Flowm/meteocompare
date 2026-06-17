<script setup lang="ts">
import { useSlots } from "vue";

// Open-Meteo data is CC BY 4.0 (https://open-meteo.com/en/licence). Credits
// "Weather data by Open-Meteo.com" (the name links to open-meteo.com) with the
// licence named alongside. Shared here so both pages carry the identical
// credit; the default slot holds each page's own note.
const slots = useSlots();
</script>

<template>
  <footer class="border-ink-700/60 border-t px-6 py-6 text-center">
    <p class="text-paper-400 font-mono text-[11px] tracking-wide">
      Weather data by
      <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer" class="text-paper-200 hover:text-sodium-200 underline-offset-4 hover:underline">Open-Meteo.com</a>
      <span class="text-sodium-300"> · </span>
      CC BY 4.0
      <template v-if="slots.default"> <span class="text-paper-500"> // </span> <slot /> </template>
    </p>
  </footer>
</template>
