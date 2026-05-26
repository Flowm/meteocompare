<script setup lang="ts">
import { computed } from "vue";

import type { HourClassification } from "@/domain/verification";

const props = defineProps<{
  /** One entry per hour. Length is typically 24 (one day's worth). */
  classification: HourClassification[];
  /** Optional label/explanation appended to each cell's tooltip. */
  hourLabel?: (i: number) => string;
}>();

const TONE: Record<HourClassification, string> = {
  hit: "bg-emerald-500/80",
  miss: "bg-amber-500/80",
  false_alarm: "bg-rose-500/80",
  correct_dry: "bg-slate-800",
};

const LEGEND: Record<HourClassification, string> = {
  hit: "hit",
  miss: "miss",
  false_alarm: "false alarm",
  correct_dry: "correct dry",
};

const cells = computed(() => props.classification.map((c, i) => ({ cls: c, tone: TONE[c], title: `${props.hourLabel?.(i) ?? `hour ${i}`} · ${LEGEND[c]}` })));

// P7: surface a wrapper-level tooltip explaining the colour palette, and a
// visible "no precipitation events" label when the whole row is dry — keeps
// the strip from looking broken on dry days.
const isDryDay = computed(() => props.classification.every((c) => c === "correct_dry"));
const wrapperTitle = computed(() => (isDryDay.value ? "No precipitation events on this day" : "Per-hour outcomes — green: hit, amber: miss, red: false alarm, dark: correct dry"));
</script>

<template>
  <div class="relative" :title="wrapperTitle">
    <div class="flex w-full gap-px overflow-hidden rounded-sm ring-1 ring-slate-800">
      <div v-for="(c, i) in cells" :key="i" class="h-3 flex-1" :class="c.tone" :title="c.title" />
    </div>
    <div v-if="isDryDay" class="pointer-events-none absolute inset-0 flex items-center justify-center text-[9px] tracking-wider text-slate-500 uppercase">
      No precipitation events
    </div>
  </div>
</template>
