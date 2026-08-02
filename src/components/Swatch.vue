<script setup lang="ts">
// A small square legend/colour swatch. The `inline-block size-2` chip that
// marks a series, model or aggregate colour beside a label — used across the
// scorecards, the chart legend, the timing matrix and the training table. Extra
// layout classes (e.g. `shrink-0`) pass straight through to the root.
defineProps<{
  color: string;
}>();
</script>

<template>
  <span class="inline-block size-2" :style="{ backgroundColor: color }" />
</template>
