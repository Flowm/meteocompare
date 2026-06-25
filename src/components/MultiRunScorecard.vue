<script setup lang="ts">
import { computed } from "vue";

import type { ModelSampleStats } from "@/analysis/sample";
import { convertDelta, convertVar, signed, unitLabel, useUnits } from "@/composables/useUnits";
import { getModel } from "@/domain/models";
import { AGGREGATE_ROW_ID, AGGREGATE_TUNED_ROW_ID, LEAD_BANDS } from "@/domain/scorecard";

import { AGG_COLOR, paletteFor } from "./chartOption";

const props = defineProps<{
  /** Per-model performance across the sample, pre-sorted best-first. */
  stats: ModelSampleStats[];
}>();

const { prefs } = useUnits();

const hasRows = computed(() => props.stats.length > 0);
const tempUnit = computed(() => unitLabel("temperature_2m", prefs.value));
const precipUnit = computed(() => unitLabel("precipitation", prefs.value));
const bandLabels = LEAD_BANDS.map((b) => b.label);

const label = (id: string): string => (id === AGGREGATE_ROW_ID ? "Aggregate" : id === AGGREGATE_TUNED_ROW_ID ? "Aggregate (tuned)" : (getModel(id)?.label ?? id));
const accent = (s: ModelSampleStats): string => (s.isAggregate ? AGG_COLOR : paletteFor(s.id));

const fmtScore = (c: number): string => (Number.isFinite(c) ? String(Math.round(c)) : "—");

/** Same high/mid/low thresholds (≥70 / ≥40) as the single-run scorecard + the
 *  predictability badge, so the colour language reads consistently. */
const scoreTone = (c: number): string => {
  if (!Number.isFinite(c)) return "text-paper-500";
  if (c >= 70) return "text-predictability-high";
  if (c >= 40) return "text-sodium-200";
  return "text-heat-300";
};

const fmtRange = (s: ModelSampleStats): string =>
  Number.isFinite(s.compositeMin) && Number.isFinite(s.compositeMax) ? `${Math.round(s.compositeMin)}–${Math.round(s.compositeMax)}` : "—";
const fmtTempMae = (v: number): string => (Number.isFinite(v) ? convertDelta(v, "temperature_2m", prefs.value).toFixed(1) : "—");
const fmtAmount = (v: number): string => {
  if (!Number.isFinite(v)) return "—";
  const x = convertVar(v, "precipitation", prefs.value);
  return x == null ? "—" : signed(x);
};
const fmtTiming = (v: number): string => (Number.isFinite(v) ? `${Math.round(v * 100)}%` : "—");
</script>

<template>
  <div v-if="hasRows" class="border-ink-700 bg-ink-900/40 overflow-x-auto border">
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
              <span class="inline-block size-2 shrink-0" :style="{ backgroundColor: accent(s) }" />
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
