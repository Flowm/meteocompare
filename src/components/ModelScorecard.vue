<script setup lang="ts">
import { computed } from "vue";

import { convertDelta, convertVar, unitLabel, useUnits } from "@/composables/useUnits";
import { getModel } from "@/domain/models";
import { AGGREGATE_ROW_ID, LEAD_BANDS, type ScorecardRow } from "@/domain/scorecard";

import { AGG_COLOR, paletteFor } from "./chartOption";

const props = defineProps<{
  /** Pre-sorted rows (best Overall first); the aggregate is one of them. */
  rows: ScorecardRow[];
}>();

const { prefs } = useUnits();

const hasRows = computed(() => props.rows.length > 0);

const tempUnit = computed(() => unitLabel("temperature_2m", prefs.value));
const precipUnit = computed(() => unitLabel("precipitation", prefs.value));

const label = (id: string): string => (id === AGGREGATE_ROW_ID ? "Aggregate" : (getModel(id)?.label ?? id));
const accent = (row: ScorecardRow): string => (row.isAggregate ? AGG_COLOR : paletteFor(row.id));

const fmtComposite = (c: number): string => (Number.isFinite(c) ? String(Math.round(c)) : "—");

/** 0–100 composite → tone, on the same high/mid/low thresholds the confidence
 *  badge uses (≥70 / ≥40), so the colour language reads consistently. */
const scoreTone = (c: number): string => {
  if (!Number.isFinite(c)) return "text-paper-500";
  if (c >= 70) return "text-confidence-high";
  if (c >= 40) return "text-sodium-200";
  return "text-heat-300";
};

const signed = (n: number, digits = 1): string => `${n >= 0 ? "+" : ""}${n.toFixed(digits)}`;

// Temperature MAE/bias are *deltas* (magnitudes/differences), so convert with
// convertDelta — never convertVar, which would add the °F offset.
const fmtTempMae = (v: number): string => (Number.isFinite(v) ? convertDelta(v, "temperature_2m", prefs.value).toFixed(1) : "—");
const fmtTempBias = (v: number): string => (Number.isFinite(v) ? signed(convertDelta(v, "temperature_2m", prefs.value)) : "—");
const fmtAmount = (v: number): string => {
  if (!Number.isFinite(v)) return "—";
  const x = convertVar(v, "precipitation", prefs.value);
  return x == null ? "—" : signed(x);
};
const fmtTiming = (v: number): string => (Number.isFinite(v) ? `${Math.round(v * 100)}%` : "—");
const fmtCoverage = (row: ScorecardRow): string => `${row.coveredHours}h`;
</script>

<template>
  <div v-if="hasRows" class="border-ink-700 bg-ink-900/40 overflow-x-auto border">
    <table class="w-full min-w-[42rem] border-collapse font-mono text-[11px] tabular-nums">
      <thead>
        <tr class="text-paper-400 text-[10px] tracking-wide">
          <th scope="col" class="border-ink-700/60 bg-ink-900 sticky left-0 z-10 border-b px-3 py-2 text-left font-normal">Model</th>
          <th scope="col" class="border-ink-700/60 border-b px-2 py-2 text-right font-normal">Overall</th>
          <th v-for="b in LEAD_BANDS" :key="b.label" scope="col" class="border-ink-700/60 border-b px-2 py-2 text-right font-normal">{{ b.label }}</th>
          <th scope="col" class="border-ink-700/60 border-b px-2 py-2 text-right font-normal">
            bias<span class="text-paper-500">{{ tempUnit }}</span>
          </th>
          <th scope="col" class="border-ink-700/60 border-b px-2 py-2 text-right font-normal">
            MAE<span class="text-paper-500">{{ tempUnit }}</span>
          </th>
          <th scope="col" class="border-ink-700/60 border-b px-2 py-2 text-right font-normal">
            amt<span class="text-paper-500">{{ precipUnit }}</span>
          </th>
          <th scope="col" class="border-ink-700/60 border-b px-2 py-2 text-right font-normal">timing</th>
          <th scope="col" class="border-ink-700/60 border-b px-2 py-2 text-right font-normal">cov</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.id" :class="row.isAggregate ? 'bg-aggregate-400/5' : ''">
          <!-- Sticky model column. Solid bg so scrolled cells slide underneath. -->
          <th scope="row" class="border-ink-700/40 bg-ink-900 sticky left-0 z-10 border-b px-3 py-1.5 text-left font-normal">
            <span class="flex items-center gap-2">
              <span class="inline-block size-2 shrink-0" :style="{ backgroundColor: accent(row) }" />
              <span class="truncate" :class="row.isAggregate ? 'text-aggregate-400 font-semibold' : 'text-paper-200'">{{ label(row.id) }}</span>
            </span>
          </th>
          <td class="border-ink-700/40 border-b px-2 py-1.5 text-right">
            <span class="text-sm font-semibold" :class="scoreTone(row.overall.composite)">{{ fmtComposite(row.overall.composite) }}</span
            ><span v-if="row.partial" class="text-sodium-300" title="Partial coverage — scored over fewer hours">*</span>
          </td>
          <td v-for="(b, i) in row.bandComposites" :key="i" class="border-ink-700/40 border-b px-2 py-1.5 text-right">
            <span :class="b == null ? 'text-paper-500' : scoreTone(b)">{{ b == null ? "—" : Math.round(b) }}</span>
          </td>
          <td class="text-paper-300 border-ink-700/40 border-b px-2 py-1.5 text-right">{{ fmtTempBias(row.overall.tempBias) }}</td>
          <td class="text-paper-300 border-ink-700/40 border-b px-2 py-1.5 text-right">{{ fmtTempMae(row.overall.tempMae) }}</td>
          <td class="text-paper-300 border-ink-700/40 border-b px-2 py-1.5 text-right">{{ fmtAmount(row.overall.amountError) }}</td>
          <td class="text-paper-300 border-ink-700/40 border-b px-2 py-1.5 text-right">{{ fmtTiming(row.overall.timingHitRate) }}</td>
          <td class="border-ink-700/40 border-b px-2 py-1.5 text-right" :class="row.partial ? 'text-sodium-300' : 'text-paper-500'">{{ fmtCoverage(row) }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
