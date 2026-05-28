<script setup lang="ts">
import { computed } from "vue";

import { confidenceTier } from "@/domain/confidence";

const props = withDefaults(
  defineProps<{
    /** 0..1 */
    value: number;
    label?: string;
    size?: "sm" | "md";
  }>(),
  { size: "md" },
);

const tier = computed(() => confidenceTier(props.value));

// Each tier gets its own typographic register: sodium for "mid" (the neutral
// instrument-default), sage for "high", coral for "low".
const TONE_BY_TIER = {
  high: {
    bar: "bg-confidence-high",
    text: "text-confidence-high",
    ring: "border-confidence-high/40",
    glow: "shadow-[0_0_12px_rgba(155,184,122,0.25)]",
  },
  mid: {
    bar: "bg-sodium-300",
    text: "text-sodium-200",
    ring: "border-sodium-300/40",
    glow: "shadow-[0_0_12px_rgba(245,185,66,0.25)]",
  },
  low: {
    bar: "bg-heat-400",
    text: "text-heat-300",
    ring: "border-heat-400/40",
    glow: "shadow-[0_0_12px_rgba(232,130,107,0.25)]",
  },
} as const;

const tone = computed(() => TONE_BY_TIER[tier.value]);

const percent = computed(() => Math.round(props.value * 100));
const sizing = computed(() => (props.size === "sm" ? "text-[10px] px-2 py-0.5 gap-1.5" : "text-[11px] px-2.5 py-1 gap-2"));

// 12-segment dial: the meter reads like a strip from a vintage signal-strength
// indicator. Each segment is either "lit" or not.
const SEGMENTS = 12;
const litSegments = computed(() => Math.max(0, Math.min(SEGMENTS, Math.round(props.value * SEGMENTS))));
</script>

<template>
  <span
    class="bg-ink-950/60 inline-flex items-center border font-mono tracking-[0.14em] uppercase tabular-nums"
    :class="[tone.ring, sizing]"
    :title="`Model agreement: ${percent}%`"
  >
    <!-- Segmented meter -->
    <span class="flex items-center gap-px" aria-hidden="true">
      <span
        v-for="i in SEGMENTS"
        :key="i"
        class="block w-[3px]"
        :class="[size === 'sm' ? 'h-2' : 'h-2.5', i <= litSegments ? `${tone.bar} ${i === litSegments ? tone.glow : ''}` : 'bg-ink-700']"
      />
    </span>
    <span :class="tone.text">{{ label ?? `${percent}%` }}</span>
  </span>
</template>
