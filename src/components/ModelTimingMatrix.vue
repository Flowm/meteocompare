<script setup lang="ts">
import { computed } from "vue";

import { getModel } from "@/domain/models";
import { AGGREGATE_ROW_ID, type ScorecardRow } from "@/domain/scorecard";

import { AGG_COLOR, paletteFor } from "./chartOption";
import HitMissStrip from "./HitMissStrip.vue";

const props = defineProps<{
  /** Same rows (and order) as the scorecard table. */
  rows: ScorecardRow[];
}>();

// One day-axis tick per 24 h lead block. The window is a whole number of days
// (168 h = 7 days), and the strip cells are uniform, so 7 equal-width segments
// line up with the strip's day boundaries.
const dayCount = computed(() => Math.max(1, Math.round((props.rows[0]?.hourlyClassification.length ?? 168) / 24)));

const label = (id: string): string => (id === AGGREGATE_ROW_ID ? "Aggregate" : (getModel(id)?.label ?? id));
const accent = (id: string, isAggregate: boolean): string => (isAggregate ? AGG_COLOR : paletteFor(id));

const hasRows = computed(() => props.rows.length > 0);
</script>

<template>
  <div v-if="hasRows" class="border-ink-700 bg-ink-900/40 border p-3">
    <!-- Scroll lives on this padding-free wrapper (not the card) so the sticky
         label column's background covers cleanly from the very left edge, and so
         the legend below stays put when the matrix is scrolled. -->
    <div class="overflow-x-auto">
      <!-- min-width keeps each of the ~168 hour cells legible; the whole matrix
           scrolls horizontally on narrow screens, model labels frozen left. -->
      <div class="min-w-[44rem]">
        <!-- Lead-day axis. The w-24 spacer matches the label column width. -->
        <div class="text-paper-500 mb-1 flex items-center font-mono text-[10px] tracking-wide">
          <div class="bg-ink-900 sticky left-0 z-10 w-24 shrink-0 pr-2">Lead time</div>
          <div class="flex flex-1">
            <div v-for="d in dayCount" :key="d" class="flex-1 text-center tabular-nums">Day {{ d }}</div>
          </div>
        </div>

        <div v-for="row in rows" :key="row.id" class="flex items-center py-0.5">
          <div class="bg-ink-900 sticky left-0 z-10 flex w-24 shrink-0 items-center gap-1.5 pr-2 font-mono text-[10px]">
            <span class="inline-block size-2 shrink-0" :style="{ backgroundColor: accent(row.id, row.isAggregate) }" />
            <span class="truncate" :class="row.isAggregate ? 'text-aggregate-400' : 'text-paper-300'">{{ label(row.id) }}</span>
          </div>
          <div class="flex-1">
            <HitMissStrip :classification="row.hourlyClassification" :show-empty-label="false" :hour-label="(i) => `+${i}h`" />
          </div>
        </div>
      </div>
    </div>

    <!-- Legend mirrors HitMissStrip's tones. Outside the scroll wrapper so it
         stays in place when the matrix is scrolled horizontally. -->
    <div class="text-paper-400 mt-3 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px] tracking-wide">
      <span class="flex items-center gap-1"><span class="bg-confidence-high/85 inline-block size-2" /> Hit</span>
      <span class="flex items-center gap-1"><span class="bg-sodium-300/80 inline-block size-2" /> Miss</span>
      <span class="flex items-center gap-1"><span class="bg-heat-400/85 inline-block size-2" /> False alarm</span>
      <span class="flex items-center gap-1"><span class="bg-ink-700 inline-block size-2" /> Correct dry</span>
    </div>
  </div>
</template>
