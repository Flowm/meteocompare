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
</script>

<template>
  <div class="flex w-full gap-px overflow-hidden rounded-sm ring-1 ring-slate-800">
    <div v-for="(c, i) in cells" :key="i" class="h-3 flex-1" :class="c.tone" :title="c.title" />
  </div>
</template>
