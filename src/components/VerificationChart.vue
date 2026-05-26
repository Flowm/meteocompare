<script setup lang="ts">
import type { EChartsOption } from "echarts";
import { computed, nextTick, ref, watch } from "vue";
import VChart from "vue-echarts";

import { useUnits } from "@/composables/useUnits";
import type { VerificationHourly } from "@/composables/useVerification";
import type { ModelDef } from "@/domain/models";

const props = defineProps<{
  hourly: VerificationHourly;
  availableModels: ModelDef[];
  /** When true the chart switches to "spaghetti mode": one variable at a
   *  time, per-model lines, model picker below. When false both variables
   *  are rendered on a dual-axis overlay. */
  showModels: boolean;
}>();

const { temp, precip, formatTemp, formatPrecip } = useUnits();

// ---- Constants --------------------------------------------------------------
const FORECAST_COLOR = "#f472b6"; // pink — aggregate forecast
const TRUTH_COLOR = "#facc15"; // amber — ERA5-Seamless truth
const PRECIP_FORECAST_COLOR = "rgba(56, 189, 248, 0.55)"; // sky bars
const MODEL_PALETTE = ["#60a5fa", "#34d399", "#a78bfa", "#fb7185", "#22d3ee", "#f87171", "#facc15", "#4ade80", "#c084fc", "#fcd34d", "#86efac"];

type ChartVariable = "temperature" | "precipitation";

// ---- Variable / Forecast / Truth / model state ------------------------------
const variable = ref<ChartVariable>("temperature");
const showForecast = ref(true);
const showTruth = ref(true);
const enabledModels = ref<Set<string>>(new Set());

// Direct reference to the ECharts instance for no-redraw chip toggling.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const chartRef = ref<any>(null);

function selectVariable(v: ChartVariable): void {
  variable.value = v;
}

// Re-seed model selection whenever the available set changes (e.g. new run date).
watch(
  () => props.availableModels.map((m) => m.id).join(","),
  () => {
    enabledModels.value = new Set(props.availableModels.map((m) => m.id));
  },
  { immediate: true },
);

// Patch a single series' opacity directly on the ECharts instance (merge mode).
// This avoids a full chart redraw — only the matched series is updated.
function applyModelVisibility(): void {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const chart = chartRef.value?.chart;
  if (!chart) return;
  const isTemp = variable.value === "temperature";
  const perModelData = isTemp ? props.hourly.perModelTemp : props.hourly.perModelPrecip;
  const patches = props.availableModels
    .filter((m) => {
      const arr = perModelData[m.id];
      return !!arr && arr.some((v) => v != null);
    })
    .map((m) => ({
      id: `s-${m.id}`,
      lineStyle: { opacity: enabledModels.value.has(m.id) ? 0.6 : 0 },
    }));
  if (patches.length > 0) {
    // false = merge mode: only the matched series are touched, no full rebuild.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    chart.setOption({ series: patches }, false);
  }
}

function toggleModel(id: string): void {
  const next = new Set(enabledModels.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  enabledModels.value = next;

  // Directly patch the single series by id — no reactive option recompute.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const chart = chartRef.value?.chart;
  if (!chart) return;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  chart.setOption({ series: [{ id: `s-${id}`, lineStyle: { opacity: next.has(id) ? 0.6 : 0 } }] }, false);
}

function selectAllModels(): void {
  enabledModels.value = new Set(props.availableModels.map((m) => m.id));
  applyModelVisibility();
}
function selectNoModels(): void {
  enabledModels.value = new Set();
  applyModelVisibility();
}

// Patch F/T series opacity directly on the ECharts instance (merge mode).
// Handles both spaghetti (named "Aggregate"/"Truth") and overlay layouts.
function applyFTVisibility(): void {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const chart = chartRef.value?.chart;
  if (!chart) return;
  const fOp = showForecast.value ? 1 : 0;
  const tOp = showTruth.value ? 1 : 0;
  const patches: object[] = [];
  if (props.showModels) {
    patches.push({ id: "s-agg", lineStyle: { opacity: fOp } });
    patches.push({ id: "s-tr", lineStyle: { opacity: tOp } });
  } else if (variable.value === "precipitation") {
    patches.push({ id: "o-fp", itemStyle: { opacity: fOp } });
    patches.push({ id: "o-tp", lineStyle: { opacity: tOp }, areaStyle: { opacity: tOp } });
  } else {
    // band_range: toggle fill via areaStyle (lineStyle.opacity is always 0)
    patches.push({ id: "o-br", areaStyle: { opacity: fOp } });
    patches.push({ id: "o-at", lineStyle: { opacity: fOp } });
    patches.push({ id: "o-tt", lineStyle: { opacity: tOp } });
  }
  if (patches.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    chart.setOption({ series: patches }, false);
  }
}

function toggleForecast(): void {
  showForecast.value = !showForecast.value;
  applyFTVisibility();
}
function toggleTruth(): void {
  showTruth.value = !showTruth.value;
  applyFTVisibility();
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
    // P3: show ISO-8601 date (en-CA produces YYYY-MM-DD) at midnight.
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
    // -------- Spaghetti mode: single variable, per-model lines ---------------
    const v = variable.value;
    const isTemp = v === "temperature";
    const yIndex = isTemp ? 0 : 1;
    const truthData = isTemp ? tempTruth : precipTruth;
    const aggData = isTemp ? tempForecast : precipForecast;
    const perModelData = isTemp ? props.hourly.perModelTemp : props.hourly.perModelPrecip;
    const aggLineWidth = 4; // U4: thicker so the aggregate stays visible inside the spaghetti.

    // IDs are required so vue-echarts' hasMissingIds check triggers
    // replaceMerge:"series" when switching modes, preventing old overlay
    // series from bleeding into spaghetti series by index position.
    // F/T visibility is controlled via applyFTVisibility() opacity patches.
    series.push({
      id: "s-agg",
      name: "Aggregate",
      type: "line",
      yAxisIndex: yIndex,
      data: aggData,
      smooth: isTemp,
      symbol: "none",
      lineStyle: { width: aggLineWidth, color: FORECAST_COLOR },
      z: 5,
    });
    series.push({
      id: "s-tr",
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
    for (const [i, m] of props.availableModels.entries()) {
      const arr = perModelData[m.id];
      if (!arr) continue;
      const transform = isTemp ? toTempUnit : toPrecipUnit;
      series.push({
        id: `s-${m.id}`,
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
    // -------- Overlay mode: aggregate + truth for the active variable --------
    // F/T visibility is controlled via applyFTVisibility() opacity patches.
    // IDs change between variables/modes, triggering replaceMerge:"series".
    if (variable.value === "precipitation") {
      series.push({
        id: "o-fp",
        name: "Forecast precip",
        type: "bar",
        yAxisIndex: 1,
        data: precipForecast,
        itemStyle: { color: PRECIP_FORECAST_COLOR },
        barWidth: "60%",
        z: 1,
      });
      series.push({
        id: "o-tp",
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
    } else {
      series.push({
        id: "o-bb",
        name: "band_base",
        type: "line",
        stack: "tempband",
        symbol: "none",
        lineStyle: { opacity: 0 },
        // ECharts stacked line series get a default area fill (first palette
        // colour, blue) unless areaStyle.opacity is explicitly suppressed.
        areaStyle: { opacity: 0 },
        itemStyle: { opacity: 0 },
        tooltip: { show: false },
        data: tempLower,
      });
      series.push({
        id: "o-br",
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
        id: "o-at",
        name: "Aggregate temp",
        type: "line",
        data: tempForecast,
        smooth: true,
        symbol: "none",
        lineStyle: { width: 2.5, color: FORECAST_COLOR },
        z: 5,
      });
      series.push({
        id: "o-tt",
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

  const showLeftAxis = variable.value === "temperature";
  const showRightAxis = variable.value === "precipitation";

  return {
    backgroundColor: "transparent",
    textStyle: { color: "#cbd5e1" },
    grid: { left: 48, right: 48, top: 32, bottom: 36 },
    // animationDurationUpdate: 0 makes toggle updates instant, avoiding
    // re-animation flicker when series are added / removed.
    animationDurationUpdate: 0,
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
        const tempVisible = variable.value === "temperature";
        const precipVisible = variable.value === "precipitation";
        const aggT = tempForecast[idx];
        const truT = tempTruth[idx];
        // showForecast/showTruth are read here at call time (not during option
        // computation), so they don't register as reactive dependencies of option.
        if (tempVisible && showForecast.value && aggT != null) lines.push(`<span style="color:${FORECAST_COLOR}">Forecast</span> ${formatTemp.value(aggT, 1)}`);
        if (tempVisible && showTruth.value && truT != null) lines.push(`<span style="color:${TRUTH_COLOR}">Truth</span> ${formatTemp.value(truT, 1)}`);
        const aggP = precipForecast[idx];
        const truP = precipTruth[idx];
        // Always show Forecast precip when variable is visible — use 0 when the
        // aggregate is null (no contributing models reported precip that hour).
        if (precipVisible && showForecast.value) lines.push(`<span style="color:#7dd3fc">Forecast precip</span> ${formatPrecip.value(aggP ?? 0, 1)}`);
        if (precipVisible && showTruth.value && truP != null) lines.push(`<span style="color:${TRUTH_COLOR}">Truth precip</span> ${formatPrecip.value(truP, 1)}`);
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
        // Left axis (temperature). Always kept "present" so its splitLine
        // provides horizontal grid lines even when precipitation is the only
        // displayed variable. Labels + name are hidden when not needed.
        type: "value",
        name: showLeftAxis ? tempUnit.value : "",
        nameTextStyle: { color: "#94a3b8" },
        axisLine: { show: false },
        axisLabel: { color: "#94a3b8", show: showLeftAxis },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: "#1e293b" } },
      },
      {
        // Right axis (precipitation). Only shown when it is the active axis;
        // shows its own grid lines only when the left axis is absent.
        type: "value",
        name: precipUnit.value,
        nameTextStyle: { color: "#94a3b8" },
        position: "right",
        min: 0,
        axisLine: { show: false },
        axisLabel: { color: "#94a3b8" },
        splitLine: { lineStyle: { color: "#1e293b" }, show: showRightAxis && !showLeftAxis },
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

// After a genuine full re-render triggered by variable/mode/data changes,
// ECharts resets series to their initial state. Re-apply F/T and model
// visibility so hidden series stay hidden after the rebuild.
watch(option, () => {
  void nextTick(() => {
    applyModelVisibility();
    applyFTVisibility();
  });
});
</script>

<template>
  <section class="rounded-2xl bg-slate-900/60 p-4 ring-1 ring-slate-800 sm:p-6">
    <div class="mb-3 flex flex-wrap items-center gap-3 text-xs text-slate-400">
      <span class="font-medium tracking-wider text-slate-300 uppercase">Hourly verification</span>
    </div>

    <!-- Variable selector: exclusive single-select in both modes. -->
    <div class="mb-3 flex flex-wrap items-center gap-3 text-xs">
      <div class="flex overflow-hidden rounded-md bg-slate-950 ring-1 ring-slate-800">
        <button
          type="button"
          class="px-3 py-1.5 transition-colors"
          :class="variable === 'temperature' ? 'bg-slate-700 text-slate-100' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'"
          @click="selectVariable('temperature')"
        >
          Temperature
        </button>
        <button
          type="button"
          class="px-3 py-1.5 transition-colors"
          :class="variable === 'precipitation' ? 'bg-slate-700 text-slate-100' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'"
          @click="selectVariable('precipitation')"
        >
          Precipitation
        </button>
      </div>
    </div>

    <!-- Series ids ensure vue-echarts uses replaceMerge on mode switches
         (not index-merge). Chip toggles bypass Vue via direct setOption. -->
    <VChart ref="chartRef" style="height: 22rem" :option="option" autoresize />

    <!-- Forecast / Truth toggles (always visible) + per-model chips (spaghetti mode only). -->
    <div class="mt-4 flex flex-wrap items-center gap-2 text-xs">
      <!-- Forecast toggle chip -->
      <button
        type="button"
        class="rounded-md px-2 py-1 ring-1 transition-colors"
        :class="showForecast ? 'bg-slate-800 text-slate-100 ring-slate-700' : 'bg-slate-950 text-slate-500 ring-slate-800 hover:text-slate-300'"
        @click="toggleForecast"
      >
        <span class="mr-1.5 inline-block size-2 rounded-full" :style="{ backgroundColor: FORECAST_COLOR }" />Forecast
      </button>
      <!-- Truth toggle chip -->
      <button
        type="button"
        class="rounded-md px-2 py-1 ring-1 transition-colors"
        :class="showTruth ? 'bg-slate-800 text-slate-100 ring-slate-700' : 'bg-slate-950 text-slate-500 ring-slate-800 hover:text-slate-300'"
        @click="toggleTruth"
      >
        <span class="mr-1.5 inline-block size-2 rounded-full" :style="{ backgroundColor: TRUTH_COLOR }" />Truth
      </button>

      <!-- Per-model chips: only in spaghetti mode. -->
      <template v-if="showModels">
        <span class="mr-1 ml-2 text-slate-500">Models:</span>
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
      </template>
    </div>
  </section>
</template>
