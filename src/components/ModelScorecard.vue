<script setup lang="ts">
import { computed, ref } from "vue";

import { convertDelta, convertVar, signed, unitLabel, useUnits } from "@/composables/useUnits";
import { getModel } from "@/domain/models";
import { AGGREGATE_ROW_ID, LEAD_BANDS, type ScorecardRow } from "@/domain/scorecard";

import { AGG_COLOR, paletteFor } from "./chartOption";

const props = defineProps<{
  /** Rows to score; the aggregate is one of them, ranked inline. */
  rows: ScorecardRow[];
}>();

const { prefs } = useUnits();

const hasRows = computed(() => props.rows.length > 0);

const tempUnit = computed(() => unitLabel("temperature_2m", prefs.value));
const precipUnit = computed(() => unitLabel("precipitation", prefs.value));
const unitOf = (kind: "temp" | "precip"): string => (kind === "temp" ? tempUnit.value : precipUnit.value);

const label = (id: string): string => (id === AGGREGATE_ROW_ID ? "Aggregate" : (getModel(id)?.label ?? id));
const accent = (row: ScorecardRow): string => (row.isAggregate ? AGG_COLOR : paletteFor(row.id));

const fmtComposite = (c: number): string => (Number.isFinite(c) ? String(Math.round(c)) : "—");

/** 0–100 composite → tone, on the same high/mid/low thresholds the predictability
 *  badge uses (≥70 / ≥40), so the colour language reads consistently. */
const scoreTone = (c: number): string => {
  if (!Number.isFinite(c)) return "text-paper-500";
  if (c >= 70) return "text-predictability-high";
  if (c >= 40) return "text-sodium-200";
  return "text-heat-300";
};

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

const HOURS_PER_DAY = 24;
/** Coverage colour by how much of the 7-day window the model scored: under
 *  4 days is red (too little to read much into the row), under the full 7 days
 *  is amber, full coverage is muted. */
const coverageTone = (hours: number): string => {
  if (hours < 4 * HOURS_PER_DAY) return "text-heat-300";
  if (hours < 7 * HOURS_PER_DAY) return "text-sodium-400";
  return "text-paper-500";
};

// ---------------------------------------------------------------------------
// Columns + grouping
// ---------------------------------------------------------------------------

type SortKey = "model" | "overall" | "band0" | "band1" | "band2" | "tempBias" | "tempMae" | "amount" | "timing" | "coverage";
type Dir = "asc" | "desc";

interface Column {
  key: SortKey;
  label: string;
  /** Muted unit suffix to append to the label. */
  unit?: "temp" | "precip";
  tip: string;
  /** Direction applied on the first click — best/most-natural ordering first. */
  defaultDir: Dir;
}

const modelCol: Column = {
  key: "model",
  label: "Model",
  tip: "Forecast model — the aggregate is ranked inline as a reference",
  defaultDir: "asc",
};

// Scoring / Temperature / Precipitation groups span the data columns; Model and
// coverage stand on their own at the table's edges.
const groups: { label: string; tip: string; cols: Column[] }[] = [
  {
    label: "Scoring",
    tip: "0–100 composite skill — overall and by forecast lead time (higher is better)",
    cols: [
      { key: "overall", label: "Overall", tip: "Overall skill across the full window — 0–100, higher is better", defaultDir: "desc" },
      ...LEAD_BANDS.map((b, i) => ({
        key: `band${i}` as SortKey,
        label: b.label,
        tip: `Skill for forecasts ${b.start / 24}–${b.end / 24} days ahead`,
        defaultDir: "desc" as Dir,
      })),
    ],
  },
  {
    label: "Temperature",
    tip: "2 m temperature error against ERA5 truth",
    cols: [
      { key: "tempBias", label: "Bias", unit: "temp", tip: "Mean temperature error (forecast − observed) — positive = too warm, 0 is best", defaultDir: "asc" },
      { key: "tempMae", label: "MAE", unit: "temp", tip: "Mean absolute temperature error — lower is better", defaultDir: "asc" },
    ],
  },
  {
    label: "Precipitation",
    tip: "Precipitation amount and event-timing skill against ERA5 truth",
    cols: [
      { key: "amount", label: "Amount", unit: "precip", tip: "Total precipitation error (forecast − observed) — positive = too wet, 0 is best", defaultDir: "asc" },
      { key: "timing", label: "Timing", tip: "Precipitation timing skill (Critical Success Index) — higher is better", defaultDir: "desc" },
    ],
  },
];

const covCol: Column = {
  key: "coverage",
  label: "Coverage",
  tip: "Hours of the window the model covered (* marks partial coverage)",
  defaultDir: "desc",
};

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

const sortKey = ref<SortKey>("overall");
const sortDir = ref<Dir>("desc");

/** Numeric value a column sorts on; non-finite (unscorable) always sinks. */
const sortValue = (row: ScorecardRow, key: SortKey): number => {
  switch (key) {
    case "overall":
      return row.overall.composite;
    case "band0":
      return row.bandComposites[0] ?? NaN;
    case "band1":
      return row.bandComposites[1] ?? NaN;
    case "band2":
      return row.bandComposites[2] ?? NaN;
    case "tempBias":
      return row.overall.tempBias;
    case "tempMae":
      return row.overall.tempMae;
    case "amount":
      return row.overall.amountError;
    case "timing":
      return row.overall.timingScore;
    case "coverage":
      return row.coveredHours;
    default:
      return NaN;
  }
};

const sorted = computed<ScorecardRow[]>(() => {
  const key = sortKey.value;
  const sign = sortDir.value === "asc" ? 1 : -1;
  if (key === "model") {
    return props.rows.toSorted((a, b) => sign * label(a.id).localeCompare(label(b.id)));
  }
  return props.rows.toSorted((a, b) => {
    const av = sortValue(a, key);
    const bv = sortValue(b, key);
    const aF = Number.isFinite(av);
    const bF = Number.isFinite(bv);
    // Unscorable rows sink to the bottom regardless of direction.
    if (!aF || !bF) return aF === bF ? 0 : aF ? -1 : 1;
    return sign * (av - bv);
  });
});

const setSort = (col: Column): void => {
  if (sortKey.value === col.key) {
    sortDir.value = sortDir.value === "asc" ? "desc" : "asc";
  } else {
    sortKey.value = col.key;
    sortDir.value = col.defaultDir;
  }
};

const ariaSort = (key: SortKey): "ascending" | "descending" | "none" => (sortKey.value === key ? (sortDir.value === "asc" ? "ascending" : "descending") : "none");

const caret = (key: SortKey): string => (sortKey.value !== key ? "↕" : sortDir.value === "asc" ? "↑" : "↓");
const caretClass = (key: SortKey): string => (sortKey.value === key ? "text-sodium-300 opacity-100" : "text-paper-500 opacity-0 group-hover:opacity-100");
</script>

<template>
  <div v-if="hasRows" class="border-ink-700 bg-ink-900/40 overflow-x-auto border">
    <table class="w-full min-w-[42rem] border-collapse font-mono text-[11px] tabular-nums">
      <thead>
        <!-- Group row. Model + coverage span both header rows at the edges. -->
        <tr class="text-paper-500 text-[10px] tracking-wide">
          <th
            scope="col"
            rowspan="2"
            :title="modelCol.tip"
            :aria-sort="ariaSort('model')"
            class="border-ink-700/60 bg-ink-900 sticky left-0 z-20 w-px border-b px-3 py-2 text-left align-bottom font-normal whitespace-nowrap"
          >
            <button
              type="button"
              class="group text-paper-400 hover:text-paper-200 flex w-full cursor-pointer items-center justify-start gap-1 transition-colors select-none"
              @click="setSort(modelCol)"
            >
              <span>{{ modelCol.label }}</span>
              <span class="inline-block w-2 text-center transition-opacity" :class="caretClass('model')">{{ caret("model") }}</span>
            </button>
          </th>
          <th
            v-for="g in groups"
            :key="g.label"
            scope="colgroup"
            :colspan="g.cols.length"
            :title="g.tip"
            class="border-ink-700/60 text-paper-400 border-l px-2 py-1.5 text-center font-normal"
          >
            {{ g.label }}
          </th>
          <th
            scope="col"
            rowspan="2"
            :title="covCol.tip"
            :aria-sort="ariaSort('coverage')"
            class="border-ink-700/60 border-b border-l px-2 py-2 text-right align-bottom font-normal"
          >
            <button
              type="button"
              class="group text-paper-400 hover:text-paper-200 flex w-full cursor-pointer items-center justify-end gap-1 transition-colors select-none"
              @click="setSort(covCol)"
            >
              <span class="inline-block w-2 text-center transition-opacity" :class="caretClass('coverage')">{{ caret("coverage") }}</span>
              <span>{{ covCol.label }}</span>
            </button>
          </th>
        </tr>
        <!-- Column row. -->
        <tr class="text-paper-400 text-[10px] tracking-wide">
          <template v-for="g in groups" :key="g.label">
            <th
              v-for="(col, i) in g.cols"
              :key="col.key"
              scope="col"
              :title="col.tip"
              :aria-sort="ariaSort(col.key)"
              class="border-ink-700/60 border-b px-2 py-1.5 text-right font-normal"
              :class="i === 0 ? 'border-l' : ''"
            >
              <button
                type="button"
                class="group hover:text-paper-200 flex w-full cursor-pointer items-center justify-end gap-1 whitespace-nowrap transition-colors select-none"
                @click="setSort(col)"
              >
                <span class="inline-block w-2 text-center text-[8px] transition-opacity" :class="caretClass(col.key)">{{ caret(col.key) }}</span>
                <span
                  >{{ col.label }}<span v-if="col.unit" class="text-paper-500">&nbsp;({{ unitOf(col.unit) }})</span></span
                >
              </button>
            </th>
          </template>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in sorted" :key="row.id" :class="row.isAggregate ? 'bg-aggregate-400/5' : ''">
          <!-- Sticky model column. Solid bg so scrolled cells slide underneath;
               w-px + nowrap shrinks it to just past the widest label. -->
          <th scope="row" class="border-ink-700/40 bg-ink-900 sticky left-0 z-10 w-px border-b px-3 py-1.5 text-left font-normal whitespace-nowrap">
            <span class="flex items-center gap-2">
              <span class="inline-block size-2 shrink-0" :style="{ backgroundColor: accent(row) }" />
              <span :class="row.isAggregate ? 'text-aggregate-400 font-semibold' : 'text-paper-200'">{{ label(row.id) }}</span>
            </span>
          </th>
          <!-- Scoring -->
          <td class="border-ink-700/40 border-b border-l px-2 py-1.5 text-right">
            <span class="text-sm font-semibold" :class="scoreTone(row.overall.composite)">{{ fmtComposite(row.overall.composite) }}</span
            ><!-- Fixed-width flag slot so the partial-coverage * never shifts the digits out of column.
            --><span class="text-sodium-300 inline-block w-2 text-left" :title="row.partial ? 'Partial coverage — scored over fewer hours' : undefined">{{
              row.partial ? "*" : ""
            }}</span>
          </td>
          <td v-for="(b, i) in row.bandComposites" :key="i" class="border-ink-700/40 border-b px-2 py-1.5 text-right">
            <span :class="b == null ? 'text-paper-500' : scoreTone(b)">{{ b == null ? "—" : Math.round(b) }}</span>
          </td>
          <!-- Temperature -->
          <td class="text-paper-300 border-ink-700/40 border-b border-l px-2 py-1.5 text-right">{{ fmtTempBias(row.overall.tempBias) }}</td>
          <td class="text-paper-300 border-ink-700/40 border-b px-2 py-1.5 text-right">{{ fmtTempMae(row.overall.tempMae) }}</td>
          <!-- Precipitation -->
          <td class="text-paper-300 border-ink-700/40 border-b border-l px-2 py-1.5 text-right">{{ fmtAmount(row.overall.amountError) }}</td>
          <td class="text-paper-300 border-ink-700/40 border-b px-2 py-1.5 text-right">{{ fmtTiming(row.overall.timingScore) }}</td>
          <!-- Coverage -->
          <td class="border-ink-700/40 border-b border-l px-2 py-1.5 text-right" :class="coverageTone(row.coveredHours)">{{ fmtCoverage(row) }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
