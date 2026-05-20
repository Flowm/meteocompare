<script setup lang="ts">
import { computed } from "vue";

import { iconFor } from "@/domain/weatherCodes";

// Vue 3 coerces an absent Boolean prop to `false`, so an unwrapped
// `isDay?: boolean` would default to night — exactly backwards from
// what we want for daily summaries. `withDefaults` keeps it day by default.
const props = withDefaults(
  defineProps<{
    code: number;
    size?: number | string;
    isDay?: boolean;
  }>(),
  { isDay: true },
);

const icon = computed(() => iconFor(props.code));
const cls = computed(() => (props.isDay ? icon.value.day : icon.value.night));

const sizeStyle = computed(() => {
  const s = props.size ?? "2rem";
  return typeof s === "number" ? `${s}px` : s;
});
</script>

<template>
  <i class="wi" :class="[cls, icon.tone]" :style="{ fontSize: sizeStyle, lineHeight: 1 }" role="img" aria-hidden="false" />
</template>
