<script setup lang="ts">
import type { EChartsOption } from "echarts";
import { computed, ref, watch } from "vue";
import VChart from "vue-echarts";

import { useUnits } from "@/composables/useUnits";
import type { VerificationHourly } from "@/composables/useVerification";
import type { ModelDef } from "@/domain/models";

const props = defineProps<{
  hourly: VerificationHourly;
  availableModels: ModelDef[];
  /** Page-level toggle. When true the chart switches to "spaghetti mode":
   *  one variable at a time, per-model lines, model picker and explicit
   *  Forecast / Truth visibility toggles. When false the chart renders the
   *  dual-axis overlay (aggregate + truth for both temp & precip). */
  showModels: boolean;
  /** Only consulted when `showModels` is false. */
  showTemp: boolean;
  showPrecip: boolean;
}>();

const { temp, precip, formatTemp, formatPrecip } = useUnits();

// ---- Constants --------------------------------------------------------------
const FORECAST_COLOR = "#f472b6"; // pink — aggregate forecast
const TRUTH_COLOR = "#facc15"; // amber — ERA5-Seamless truth
const PRECIP_FORECAST_COLOR = "rgba(56, 189, 248, 0.55)"; // sky bars
const MODEL_PALETTE = ["#60a5fa", "#34d399", "#a78bfa", "#fb7185", "#22d3ee", "#f87171", "#facc15", "#4ade80", "#c084fc", "#fcd34d", "#86efac"];

type ChartVariable = "temperature" | "precipitation";

// ---- Spaghetti-mode state ---------------------------------------------------
// Internal to the chart, mirroring ModelBreakdown.vue's pattern. The page-level
// `showModels` prop decides whether this surface is exposed.

const variable = ref<ChartVariable>("temperature");
const showForecast = ref(true);
const showTruth = ref(true);
const enabledModels = ref<Set<string>>(new Set());

// Re-seed the model selection whenever the available set changes (e.g. user
// picks a different run date). Default to "all available enabled".
watch(
  () => props.availableModels.map((m) => m.id).join(","),
  () => {
    enabledModels.value = new Set(props.availableModels.map((m) => m.id));
  },
  { immediate: true },
);

function toggleModel(id: string): void {
  const next = new Set(enabledModels.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  enabledModels.value = next;
}
function selectAllModels(): void {
  enabledModels.value = new Set(props.availableModels.map((m) => m.id));
}
function selectNoModels(): void {
  enabledModels.value = new Set();
}

// ---- Unit helpers -----------------------------------------------------------
const tempUnit = computed(() => (temp.value === "f" ? "°F" : "°C"));
const precipUnit = computed(() => (precip.value === "in" ? "in" : "mm"));

function toTempUnit(v: number | null | undefined): number | null {
  if (v == null || Number.isNaN(v)) return null;
  return temp.value === "f" ? (v * 9) / 5 + 32 : v;
}
function toPrecipUnit(v: number | null | undefined): number | null {
  if (v == null || Number.isNaN(v)) return null;
  return precip.value === "in" ? v / 25.4 : v;
}

// ---- Chart option -----------------------------------------------------------
const option = computed<EChartsOption>(() => {
  const times = props.hourly.times;
  const labels = times.map((t) => {
    const d = new Date(t);
    const h = d.getHours();
    // P3: show ISO-8601 date (en-CA produces YYYY-MM-DD) at midnight so users
    // hopping between historical run-dates can see which date a tick refers to
    // without guessing from the weekday alone.
    return h === 0 ? d.toLocaleDateString("en-CA") : `${h.toString().padStart(2, "0")}:00`;
  });

  // Pre-computed value series (in current units, with NaN/null normalised).
  const tempForecast = props.hourly.aggregateTemp.map((p) => toTempUnit(p.value));
  const tempStd = props.hourly.aggregateTemp.map((p) => (Number.isFinite(p.stdDev) ? p.stdDev : 0));
  const tempLower = props.hourly.aggregateTemp.map((p, i) => toTempUnit(p.value - tempStd[i]!));
  const tempDelta = tempStd.map((s) => (temp.value === "f" ? (s * 2 * 9) / 5 : s * 2));
  const tempTruth = props.hourly.truthTemp.map(toTempUnit);
  const precipForecast = props.hourly.aggregatePrecip.map((p) => toPrecipUnit(p.value));
  const precipTruth = props.hourly.truthPrecip.map(toPrecipUnit);

  const series: NonNullable<EChartsOption["series"]> = [];

  if (props.showModels) {
    // -------- Spaghetti mode: single variable, per-model picker --------------
    const v = variable.value;
    const isTemp = v === "temperature";
    const yIndex = isTemp ? 0 : 1;
    const truthData = isTemp ? tempTruth : precipTruth;
    const aggData = isTemp ? tempForecast : precipForecast;
    const perModelData = isTemp ? props.hourly.perModelTemp : props.hourly.perModelPrecip;
    const aggLineWidth = 4; // U4: thicker so the aggregate stays visible inside the spaghetti.

    if (showForecast.value) {
      series.push({
        name: "Aggregate",
        type: "line",
        yAxisIndex: yIndex,
        data: aggData,
        smooth: isTemp,
        symbol: "none",
        lineStyle: { width: aggLineWidth, color: FORECAST_COLOR },
        z: 5,
      });
    }
    if (showTruth.value) {
      series.push({
        name: "Truth",
        type: "line",
        yAxisIndex: yIndex,
        data: truthData,
        smooth: false,
        step: isTemp ? false : "middle",
        symbol: "none",
        lineStyle: { width: 3, color: TRUTH_COLOR },
        z: 6,
      });
    }
    for (const [i, m] of props.availableModels.entries()) {
      if (!enabledModels.value.has(m.id)) continue;
      const arr = perModelData[m.id];
      if (!arr) continue;
      const transform = isTemp ? toTempUnit : toPrecipUnit;
      series.push({
        name: m.label,
        type: "line",
        yAxisIndex: yIndex,
        data: arr.map(transform),
        smooth: isTemp,
        symbol: "none",
        lineStyle: { width: 1, color: MODEL_PALETTE[i % MODEL_PALETTE.length], opacity: 0.6 },
        z: 4,
      });
    }
  } else {
    // -------- Overlay mode: aggregate + truth for both variables -------------
    if (props.showPrecip) {
      series.push({
        name: "Forecast precip",
        type: "bar",
        yAxisIndex: 1,
        data: precipForecast,
        itemStyle: { color: PRECIP_FORECAST_COLOR },
        barWidth: "60%",
        z: 1,
      });
      series.push({
        name: "Truth precip",
        type: "line",
        yAxisIndex: 1,
        data: precipTruth,
        step: "middle",
        symbol: "none",
        lineStyle: { width: 2, color: TRUTH_COLOR },
        areaStyle: { color: "rgba(250, 204, 21, 0.12)" },
        z: 2,
      });
    }
    if (props.showTemp) {
      series.push({
        name: "band_base",
        type: "line",
        stack: "tempband",
        symbol: "none",
        lineStyle: { opacity: 0 },
        itemStyle: { opacity: 0 },
        tooltip: { show: false },
        data: tempLower,
      });
      series.push({
        name: "band_range",
        type: "line",
        stack: "tempband",
        symbol: "none",
        lineStyle: { opacity: 0 },
        areaStyle: { color: "rgba(244, 114, 182, 0.16)" },
        tooltip: { show: false },
        data: tempDelta,
      });
      series.push({
        name: "Aggregate temp",
        type: "line",
        data: tempForecast,
        smooth: true,
        symbol: "none",
        lineStyle: { width: 2.5, color: FORECAST_COLOR },
        z: 5,
      });
      series.push({
        name: "Truth temp",
        type: "line",
        data: tempTruth,
        smooth: false,
        symbol: "none",
        lineStyle: { width: 3, color: TRUTH_COLOR },
        z: 6,
      });
    }
  }

  // Y-axis visibility depends on mode:
  //   - Spaghetti: only the axis matching `variable` is shown.
  //   - Overlay: each axis shown iff its variable is enabled.
  const showLeftAxis = props.showModels ? variable.value === "temperature" : props.showTemp;
  const showRightAxis = props.showModels ? variable.value === "precipitation" : props.showPrecip;

  return {
    backgroundColor: "transparent",
    textStyle: { color: "#cbd5e1" },
    grid: { left: 48, right: 48, top: 32, bottom: 36 },
    tooltip: {
      trigger: "axis",
      backgroundColor: "rgba(15, 23, 42, 0.95)",
      borderColor: "#334155",
      textStyle: { color: "#e2e8f0" },
      formatter: (params: unknown) => {
        const arr = params as Array<{ axisValue: string; seriesName: string; value: number; color: string }>;
        const t = arr[0]?.axisValue ?? "";
        const idx = labels.indexOf(t);
        const timeStr = times[idx];
        if (timeStr === undefined) return "";
        const header = new Date(timeStr).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" });
        const lines: string[] = [];
        const tempVisible = props.showModels ? variable.value === "temperature" : props.showTemp;
        const precipVisible = props.showModels ? variable.value === "precipitation" : props.showPrecip;
        const aggT = tempForecast[idx];
        const truT = tempTruth[idx];
        if (tempVisible && aggT != null) lines.push(`<span style="color:${FORECAST_COLOR}">forecast</span> ${formatTemp.value(aggT, 1)}`);
        if (tempVisible && truT != null) lines.push(`<span style="color:${TRUTH_COLOR}">truth</span> ${formatTemp.value(truT, 1)}`);
        const aggP = precipForecast[idx];
        const truP = precipTruth[idx];
        if (precipVisible && aggP != null) lines.push(`<span style="color:#7dd3fc">forecast precip</span> ${formatPrecip.value(aggP, 1)}`);
        if (precipVisible && truP != null) lines.push(`<span style="color:${TRUTH_COLOR}">truth precip</span> ${formatPrecip.value(truP, 1)}`);
        return `<div style="font-weight:600;margin-bottom:4px">${header}</div>${lines.join("<br/>")}`;
      },
    },
    xAxis: {
      type: "category",
      data: labels,
      axisLine: { lineStyle: { color: "#475569" } },
      axisLabel: { color: "#94a3b8", interval: 23, hideOverlap: true },
      axisTick: { show: false },
    },
    yAxis: [
      {
        type: "value",
        name: tempUnit.value,
        nameTextStyle: { color: "#94a3b8" },
        axisLine: { show: false },
        axisLabel: { color: "#94a3b8" },
        splitLine: { lineStyle: { color: "#1e293b" } },
        show: showLeftAxis,
      },
      {
        type: "value",
        name: precipUnit.value,
        nameTextStyle: { color: "#94a3b8" },
        position: "right",
        min: 0,
        axisLine: { show: false },
        axisLabel: { color: "#94a3b8" },
        splitLine: { show: false },
        show: showRightAxis,
      },
    ],
    series,
  };
});

// ---- Helpers for the spaghetti-mode chip strip ------------------------------
const modelHasData = computed<Record<string, boolean>>(() => {
  const out: Record<string, boolean> = {};
  const byModel = variable.value === "temperature" ? props.hourly.perModelTemp : props.hourly.perModelPrecip;
  for (const m of props.availableModels) {
    const arr = byModel[m.id];
    out[m.id] = !!arr && arr.some((v) => v != null);
  }
  return out;
});
</script>

<template>
  <section class="rounded-2xl bg-slate-900/60 p-4 ring-1 ring-slate-800 sm:p-6">
    <div class="mb-3 flex flex-wrap items-center gap-3 text-xs text-slate-400">
      <span class="font-medium tracking-wider text-slate-300 uppercase">Hourly verification</span>
      <span class="hidden text-slate-500 sm:inline">
        <span class="inline-block size-2 rounded-full" :style="{ backgroundColor: FORECAST_COLOR }" />
        forecast
        <span class="ml-2 inline-block size-2 rounded-full" :style="{ backgroundColor: TRUTH_COLOR }" />
        truth
      </span>
    </div>

    <!-- Spaghetti-mode controls: variable selector + Forecast/Truth toggles. -->
    <div v-if="showModels" class="mb-3 flex flex-wrap items-center gap-3 text-xs">
      <div class="flex items-center gap-2">
        <span class="text-slate-500">Variable:</span>
        <div class="flex overflow-hidden rounded-md bg-slate-950 ring-1 ring-slate-800">
          <button
            type="button"
            class="px-3 py-1.5 transition-colors"
            :class="variable === 'temperature' ? 'bg-slate-700 text-slate-100' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'"
            @click="variable = 'temperature'"
          >
            Temperature
          </button>
          <button
            type="button"
            class="px-3 py-1.5 transition-colors"
            :class="variable === 'precipitation' ? 'bg-slate-700 text-slate-100' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'"
            @click="variable = 'precipitation'"
          >
            Precipitation
          </button>
        </div>
      </div>

      <fieldset class="flex items-center gap-3 text-slate-400 sm:ml-auto">
        <label class="flex items-center gap-1">
          <input v-model="showForecast" type="checkbox" class="accent-pink-400" />
          <span>Forecast</span>
        </label>
        <label class="flex items-center gap-1">
          <input v-model="showTruth" type="checkbox" class="accent-yellow-400" />
          <span>Truth</span>
        </label>
      </fieldset>
    </div>

    <VChart style="height: 22rem" :option="option" autoresize />

    <!-- Per-model chips in spaghetti mode. -->
    <div v-if="showModels" class="mt-4 flex flex-wrap items-center gap-2 text-xs">
      <span class="mr-1 text-slate-500">Models:</span>
      <button
        v-for="(m, i) in availableModels"
        :key="m.id"
        type="button"
        class="rounded-md px-2 py-1 ring-1 transition-colors"
        :class="
          !modelHasData[m.id]
            ? 'cursor-not-allowed bg-slate-950 text-slate-600 line-through opacity-50 ring-slate-900'
            : enabledModels.has(m.id)
              ? 'bg-slate-800 text-slate-100 ring-slate-700'
              : 'bg-slate-950 text-slate-500 ring-slate-800 hover:text-slate-300'
        "
        :disabled="!modelHasData[m.id]"
        :title="modelHasData[m.id] ? `${m.provider} · ${m.description}` : `${m.provider} · no data for this variable`"
        @click="toggleModel(m.id)"
      >
        <span class="mr-1.5 inline-block size-2 rounded-full" :style="{ backgroundColor: MODEL_PALETTE[i % MODEL_PALETTE.length] }" />{{ m.label }}
      </button>
      <button type="button" class="ml-2 text-slate-500 underline hover:text-slate-300" @click="selectAllModels">all</button>
      <button type="button" class="text-slate-500 underline hover:text-slate-300" @click="selectNoModels">none</button>
    </div>
  </section>
</template>
