<script setup lang="ts">
import { computed } from "vue";

import type { HourClassification } from "@/domain/verification";

const props = withDefaults(
  defineProps<{
    /** One entry per hour. Length is typically 24 (one day's worth). Omitted in
     *  legend-only mode (`legend`), where no strip is drawn. */
    classification?: HourClassification[];
    /** Optional label/explanation appended to each cell's tooltip. */
    hourLabel?: (i: number) => string;
    /** Centered "No precipitation events" overlay on an all-dry strip. Off in
     *  the multi-row timing matrix, where thin (h-3) rows can't fit the text. */
    showEmptyLabel?: boolean;
    /** Render only the tone legend (no strip). The single source of the five
     *  tone/label pairs, so callers like ModelTimingMatrix consume it rather
     *  than restating the tones. */
    legend?: boolean;
  }>(),
  { classification: () => [], showEmptyLabel: true, legend: false },
);

// Tones tuned to the "Observatory" palette: sage / sodium / coral / faint ink.
// no_data sits near the page floor so unscored hours read as an absence (a gap)
// rather than a real outcome. The order here is the legend's reading order.
const TONE: Record<HourClassification, string> = {
  hit: "bg-predictability-high/85",
  miss: "bg-sodium-300/80",
  false_alarm: "bg-heat-400/85",
  correct_dry: "bg-ink-700",
  no_data: "bg-ink-950/60",
};

const LEGEND: Record<HourClassification, string> = {
  hit: "hit",
  miss: "miss",
  false_alarm: "false alarm",
  correct_dry: "correct dry",
  no_data: "no data",
};

// The legend rows, in reading order — no_data carries the outlined-empty swatch,
// and its label is capitalised for the standalone legend (the cell tooltips use
// the lowercase LEGEND text mid-sentence).
const LEGEND_LABEL: Record<HourClassification, string> = {
  hit: "Hit",
  miss: "Miss",
  false_alarm: "False alarm",
  correct_dry: "Correct dry",
  no_data: "No data",
};

const legendItems = (Object.keys(TONE) as HourClassification[]).map((c) => ({
  cls: c,
  tone: c === "no_data" ? "bg-ink-950/60 border-ink-700 border" : TONE[c],
  text: LEGEND_LABEL[c],
}));

const cells = computed(() => props.classification.map((c, i) => ({ cls: c, tone: TONE[c], title: `${props.hourLabel?.(i) ?? `hour ${i}`} · ${LEGEND[c]}` })));

// "Dry day" overlay only when every hour is a genuine correct-dry — a strip of
// unscored (no_data) hours is an absence, not a dry day.
const isDryDay = computed(() => props.classification.length > 0 && props.classification.every((c) => c === "correct_dry"));
const wrapperTitle = computed(() =>
  isDryDay.value ? "No precipitation events on this day" : "Per-hour outcomes — sage: hit, sodium: miss, coral: false alarm, dark: correct dry, empty: no data",
);
</script>

<template>
  <!-- Legend-only mode: the five tone/label pairs, no strip. Callers supply the
       surrounding layout (the timing matrix's spacing + colour wrapper). -->
  <template v-if="legend">
    <span v-for="item in legendItems" :key="item.cls" class="flex items-center gap-1"><span class="inline-block size-2" :class="item.tone" /> {{ item.text }}</span>
  </template>
  <div v-else class="relative" :title="wrapperTitle">
    <div class="border-ink-700 flex w-full gap-px overflow-hidden border">
      <div v-for="(c, i) in cells" :key="i" class="h-3 flex-1" :class="c.tone" :title="c.title" />
    </div>
    <div v-if="isDryDay && showEmptyLabel" class="text-paper-400 pointer-events-none absolute inset-0 flex items-center justify-center font-mono text-[10px] tracking-wide">
      No precipitation events
    </div>
  </div>
</template>
