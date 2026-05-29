<script setup lang="ts">
import { computed } from "vue";

import type { HourClassification } from "@/domain/verification";

const props = defineProps<{
  /** One entry per hour. Length is typically 24 (one day's worth). */
  classification: HourClassification[];
  /** Optional label/explanation appended to each cell's tooltip. */
  hourLabel?: (i: number) => string;
}>();

// Tones tuned to the "Observatory" palette: sage / sodium / coral / faint ink.
const TONE: Record<HourClassification, string> = {
  hit: "bg-confidence-high/85",
  miss: "bg-sodium-300/80",
  false_alarm: "bg-heat-400/85",
  correct_dry: "bg-ink-700",
};

const LEGEND: Record<HourClassification, string> = {
  hit: "hit",
  miss: "miss",
  false_alarm: "false alarm",
  correct_dry: "correct dry",
};

const cells = computed(() => props.classification.map((c, i) => ({ cls: c, tone: TONE[c], title: `${props.hourLabel?.(i) ?? `hour ${i}`} · ${LEGEND[c]}` })));

const isDryDay = computed(() => props.classification.every((c) => c === "correct_dry"));
const wrapperTitle = computed(() =>
  isDryDay.value ? "No precipitation events on this day" : "Per-hour outcomes — sage: hit, sodium: miss, coral: false alarm, dark: correct dry",
);
</script>

<template>
  <div class="relative" :title="wrapperTitle">
    <div class="border-ink-700 flex w-full gap-px overflow-hidden border">
      <div v-for="(c, i) in cells" :key="i" class="h-3 flex-1" :class="c.tone" :title="c.title" />
    </div>
    <div v-if="isDryDay" class="text-paper-400 pointer-events-none absolute inset-0 flex items-center justify-center font-mono text-[10px] tracking-wide">
      No precipitation events
    </div>
  </div>
</template>
