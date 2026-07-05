<script setup lang="ts">
import { computed } from "vue";

import type { ModelSampleStats } from "@/analysis/sample";
import { unitLabel, useUnits } from "@/composables/useUnits";
import { AGGREGATE_TUNED_ROW_ID, LEAD_BANDS } from "@/domain/scorecard";

import { accent, fmtScore, fmtTiming, label as labelOf, scoreTone, useScorecardFormat } from "./scorecardFormat";
import Swatch from "./Swatch.vue";

const props = defineProps<{
  /** Per-model performance across the sample, pre-sorted best-first. */
  stats: ModelSampleStats[];
}>();

const { prefs } = useUnits();
const { fmtTempMae, fmtAmount } = useScorecardFormat();

const hasRows = computed(() => props.stats.length > 0);
const hasTuned = computed(() => props.stats.some((s) => s.id === AGGREGATE_TUNED_ROW_ID));
const tempUnit = computed(() => unitLabel("temperature_2m", prefs.value));
const precipUnit = computed(() => unitLabel("precipitation", prefs.value));
const bandLabels = LEAD_BANDS.map((b) => b.label);

const label = (id: string): string => labelOf(id, hasTuned.value);

const fmtRange = (s: ModelSampleStats): string =>
  Number.isFinite(s.compositeMin) && Number.isFinite(s.compositeMax) ? `${Math.round(s.compositeMin)}–${Math.round(s.compositeMax)}` : "—";
</script>

<template>
  <div v-if="hasRows" class="no-scrollbar border-ink-700 bg-ink-900/40 overflow-x-auto border">
    <table class="w-full min-w-[40rem] border-collapse font-mono text-[11px] tabular-nums">
      <thead>
        <tr class="text-paper-400 text-[10px] tracking-wide">
          <th scope="col" class="border-ink-700/60 bg-ink-900 sticky left-0 z-10 border-b px-3 py-2 text-left font-normal whitespace-nowrap">Model</th>
          <th scope="col" title="Runs the model was scorable in" class="border-ink-700/60 border-b border-l px-2 py-2 text-right font-normal">Runs</th>
          <th scope="col" title="Mean 0–100 composite across the sample" class="border-ink-700/60 border-b border-l px-2 py-2 text-right font-normal">Overall</th>
          <th scope="col" title="Min–max composite across the sample" class="border-ink-700/60 border-b px-2 py-2 text-right font-normal">Range</th>
          <th
            v-for="bl in bandLabels"
            :key="bl"
            scope="col"
            title="Mean composite for this lead-time band"
            class="border-ink-700/60 border-b border-l px-2 py-2 text-right font-normal"
          >
            {{ bl }}
          </th>
          <th scope="col" class="border-ink-700/60 border-b border-l px-2 py-2 text-right font-normal">
            MAE&nbsp;<span class="text-paper-500">({{ tempUnit }})</span>
          </th>
          <th scope="col" class="border-ink-700/60 border-b px-2 py-2 text-right font-normal">
            Amount&nbsp;<span class="text-paper-500">({{ precipUnit }})</span>
          </th>
          <th scope="col" class="border-ink-700/60 border-b border-l px-2 py-2 text-right font-normal">Timing</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="s in props.stats" :key="s.id" :class="s.isAggregate ? 'bg-aggregate-400/5' : ''">
          <th scope="row" class="border-ink-700/40 bg-ink-900 sticky left-0 z-10 border-b px-3 py-1.5 text-left font-normal whitespace-nowrap">
            <span class="flex items-center gap-2">
              <Swatch :color="accent(s.id, s.isAggregate)" class="shrink-0" />
              <span :class="s.isAggregate ? 'text-aggregate-400 font-semibold' : 'text-paper-200'">{{ label(s.id) }}</span>
            </span>
          </th>
          <td class="text-paper-400 border-ink-700/40 border-b border-l px-2 py-1.5 text-right">{{ s.n }}</td>
          <td class="border-ink-700/40 border-b border-l px-2 py-1.5 text-right">
            <span class="text-sm font-semibold" :class="scoreTone(s.compositeMean)">{{ fmtScore(s.compositeMean) }}</span>
          </td>
          <td class="text-paper-500 border-ink-700/40 border-b px-2 py-1.5 text-right">{{ fmtRange(s) }}</td>
          <td v-for="(b, i) in s.bandCompositeMeans" :key="i" class="border-ink-700/40 border-b px-2 py-1.5 text-right" :class="i === 0 ? 'border-l' : ''">
            <span :class="b == null ? 'text-paper-500' : scoreTone(b)">{{ b == null ? "—" : Math.round(b) }}</span>
          </td>
          <td class="text-paper-300 border-ink-700/40 border-b border-l px-2 py-1.5 text-right">{{ fmtTempMae(s.tempMaeMean) }}</td>
          <td class="text-paper-300 border-ink-700/40 border-b px-2 py-1.5 text-right">{{ fmtAmount(s.amountErrorMean) }}</td>
          <td class="text-paper-300 border-ink-700/40 border-b border-l px-2 py-1.5 text-right">{{ fmtTiming(s.timingMean) }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
