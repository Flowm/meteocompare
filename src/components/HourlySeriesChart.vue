<script setup lang="ts">
import type { EChartsOption } from "echarts";
import { computed, nextTick, ref, watch } from "vue";
import VChart from "vue-echarts";

import type { DataVarId, HourlySeries } from "@/composables/hourlySeries";
import { useUnits } from "@/composables/useUnits";
import { MODELS, type ModelDef } from "@/domain/models";

import { buildNightRanges, CHART_VIEWS, convertDelta, convertVar, DATA_VAR_META, findNowIndex, unitLabel, type ChartViewId, type UnitPrefs } from "./chartHelpers";

const props = withDefaults(
  defineProps<{
    /** The unified hourly view-model (aggregate / perModel / optional truth). */
    data: HourlySeries;
    /** Heading shown above the chart, e.g. "Hourly forecast". */
    title: string;
    /** Selectable variable views, in display order. First is the initial selection. */
    variables: ChartViewId[];
    /** Sunrise/sunset for day/night shading. */
    solar?: { sunrise: string[]; sunset: string[] } | null;
    /** Current local time at the location — drives the "Now" marker, which is
     *  auto-hidden when "now" falls outside the visible window. Omit on verify. */
    currentTime?: string;
    /** Initial visible window in hours. */
    defaultWindow?: number;
  }>(),
  { solar: null, currentTime: undefined, defaultWindow: 72 },
);

/** Two-way when the parent binds it (verify, to share with the day cards);
 *  a self-contained local toggle otherwise (forecast). */
const showModels = defineModel<boolean>("showModels", { default: false });

const { temp, precip, wind, formatTemp, formatPrecip, formatWind } = useUnits();
const units = computed<UnitPrefs>(() => ({ temp: temp.value, precip: precip.value, wind: wind.value }));

// ---- Colours ----------------------------------------------------------------
// Tuned to the "Observatory" palette: coral = aggregate forecast, sodium amber
// = truth (ERA5 reference), oxidized teal for cool data, and a model palette
// drawn from the same warm-cool spectrum rather than the default Tailwind hues.
const AGG_COLOR = "#e8826b"; // coral — aggregate forecast
const TRUTH_COLOR = "#f5b942"; // sodium amber — ERA5-Seamless truth
const PRECIP_BAR_COLOR = "rgba(127, 184, 224, 0.65)"; // dusty rain blue
const BAND_FILL = "rgba(232, 130, 107, 0.16)"; // coral, low alpha — ±1σ band
const TRUTH_AREA = "rgba(245, 185, 66, 0.12)"; // sodium, low alpha — precip truth fill
const NIGHT_FILL = "rgba(10, 16, 24, 0.55)";
const MODEL_PALETTE = ["#6dc6c2", "#9bb87a", "#bfa9d6", "#f0a285", "#7fb8e0", "#d99a1e", "#e8826b", "#9ddad6", "#c7b69a", "#a8c182", "#b88c8c"];
const BAND_OPACITY = 0.16;
const TRUTH_AREA_OPACITY = 0.12;
const MODEL_OPACITY = 0.55;

const WINDOW_CHOICES = [
  { hours: 24, label: "24h" },
  { hours: 72, label: "3d" },
  { hours: 168, label: "7d" },
] as const;

// ---- UI state ---------------------------------------------------------------
const view = ref<ChartViewId>(props.variables[0] ?? "temperature_2m");
const hoursWindow = ref<number>(props.defaultWindow);

// Visibility toggles. Kept OUT of `option` so toggling them patches the chart
// directly (no full redraw) — only re-read inside the tooltip formatter at
// hover time, where they don't register as reactive dependencies.
const showAggregate = ref(true);
const showTruth = ref(true);
const enabledModels = ref<Set<string>>(new Set());

// Direct handle to the ECharts instance for no-redraw merge patches.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const chartRef = ref<any>(null);

const hasTruth = computed(() => !!props.data.truth);

/** The single variable a line/spaghetti is drawn for. Composite views resolve
 *  to their `spaghettiVar`. */
const activeVar = computed<DataVarId>(() => CHART_VIEWS[view.value].spaghettiVar);

// Q11 (option A): spaghetti needs a single variable. Turning it on while the
// composite Temp+Precip view is selected snaps to Temperature.
watch(showModels, (on) => {
  if (on && view.value === "temp_precip") view.value = "temperature_2m";
});

function selectView(v: ChartViewId): void {
  // The reverse of the snap: picking the composite while spaghetti is on turns
  // spaghetti off (two fans on two axes is unreadable).
  if (v === "temp_precip" && showModels.value) showModels.value = false;
  view.value = v;
}

// ---- Model chip helpers -----------------------------------------------------
/** Models that returned data for at least one variable (the chip universe). */
const allModels = computed<ModelDef[]>(() => {
  const ids = new Set<string>();
  for (const vId of Object.keys(props.data.perModel) as DataVarId[]) {
    const byModel = props.data.perModel[vId] ?? {};
    for (const id of Object.keys(byModel)) if (byModel[id]?.some((x) => x != null)) ids.add(id);
  }
  return MODELS.filter((m) => ids.has(m.id));
});

/** Whether a model has data for the *currently active* variable (drives the
 *  disabled/strikethrough chip state). */
const modelHasData = computed<Record<string, boolean>>(() => {
  const out: Record<string, boolean> = {};
  const byModel = props.data.perModel[activeVar.value] ?? {};
  for (const m of allModels.value) out[m.id] = !!byModel[m.id]?.some((x) => x != null);
  return out;
});

function paletteFor(id: string): string {
  const i = MODELS.findIndex((m) => m.id === id);
  return MODEL_PALETTE[(i < 0 ? 0 : i) % MODEL_PALETTE.length]!;
}

// Re-seed enabled models whenever the chip universe changes (new data / run).
watch(
  () => allModels.value.map((m) => m.id).join(","),
  () => {
    enabledModels.value = new Set(allModels.value.map((m) => m.id));
  },
  { immediate: true },
);

// ---- Chip toggles (no-redraw) ----------------------------------------------
/** Merge-patch only series whose ids are present in the current option. */
function patch(patches: Array<Record<string, unknown> & { id: string }>): void {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const chart = chartRef.value?.chart;
  if (!chart) return;
  const s = option.value.series;
  const ids = new Set((Array.isArray(s) ? s : []).map((x) => (x as { id?: string }).id));
  const valid = patches.filter((p) => ids.has(p.id));
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  if (valid.length) chart.setOption({ series: valid }, false);
}

function applyAggregateVisibility(): void {
  const op = showAggregate.value ? 1 : 0;
  patch([
    { id: "agg", lineStyle: { opacity: op }, itemStyle: { opacity: op } },
    { id: "band-delta", areaStyle: { opacity: op ? BAND_OPACITY : 0 } },
  ]);
}

function applyTruthVisibility(): void {
  const op = showTruth.value ? 1 : 0;
  const truthPatch: Record<string, unknown> & { id: string } = { id: "tr", lineStyle: { opacity: op }, itemStyle: { opacity: op } };
  // Only precipitation truth carries an area fill — don't add one to temp truth.
  if (view.value === "precipitation") truthPatch.areaStyle = { opacity: op ? TRUTH_AREA_OPACITY : 0 };
  patch([truthPatch]);
}

function applyModelVisibility(): void {
  patch(allModels.value.map((m) => ({ id: `s-${m.id}`, lineStyle: { opacity: enabledModels.value.has(m.id) ? MODEL_OPACITY : 0 } })));
}

function toggleAggregate(): void {
  showAggregate.value = !showAggregate.value;
  applyAggregateVisibility();
}
function toggleTruth(): void {
  showTruth.value = !showTruth.value;
  applyTruthVisibility();
}
function toggleModel(id: string): void {
  if (!modelHasData.value[id]) return;
  const next = new Set(enabledModels.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  enabledModels.value = next;
  patch([{ id: `s-${id}`, lineStyle: { opacity: next.has(id) ? MODEL_OPACITY : 0 } }]);
}
function selectAllModels(): void {
  enabledModels.value = new Set(allModels.value.filter((m) => modelHasData.value[m.id]).map((m) => m.id));
  applyModelVisibility();
}
function selectNoModels(): void {
  enabledModels.value = new Set();
  applyModelVisibility();
}

// ---- Tooltip formatting -----------------------------------------------------
function fmtVar(dv: DataVarId, base: number | null | undefined): string {
  if (dv === "temperature_2m") return formatTemp.value(base, 1);
  if (dv === "precipitation") return formatPrecip.value(base, 1);
  if (dv === "wind_speed_10m") return formatWind.value(base, 1);
  if (base == null || Number.isNaN(base)) return "–";
  return `${Math.round(base)}%`;
}

// ---- Chart option -----------------------------------------------------------
const option = computed<EChartsOption>(() => {
  const v = view.value;
  const n = Math.min(hoursWindow.value, props.data.times.length);
  const times = props.data.times.slice(0, n);
  const nowIdx = props.currentTime ? findNowIndex(times, props.currentTime) : -1;
  const nightRanges = buildNightRanges(times, props.solar?.sunrise, props.solar?.sunset);

  const labels = times.map((t) => {
    const d = new Date(t);
    return d.getHours() === 0 ? d.toLocaleDateString([], { weekday: "short" }) : `${d.getHours().toString().padStart(2, "0")}:00`;
  });

  const spaghetti = showModels.value;
  const series: NonNullable<EChartsOption["series"]> = [];

  // Resolve which data variables go on which axis.
  const isComposite = v === "temp_precip";
  const leftVar: DataVarId | null = isComposite ? "temperature_2m" : v === "precipitation" ? null : (v as DataVarId);
  const rightActive = isComposite || v === "precipitation";

  const markArea =
    nightRanges.length > 0
      ? { silent: true, itemStyle: { color: NIGHT_FILL, borderWidth: 0 }, data: nightRanges.map(([a, b]): [{ xAxis: number }, { xAxis: number }] => [{ xAxis: a }, { xAxis: b }]) }
      : undefined;
  const markLine =
    nowIdx >= 0
      ? {
          silent: true,
          animation: false,
          symbol: ["none", "none"] as [string, string],
          lineStyle: { color: "rgba(245, 185, 66, 0.85)", width: 1, type: "solid" as const },
          label: {
            formatter: "NOW",
            color: "#050810",
            fontSize: 9,
            fontWeight: 700 as const,
            fontFamily: "JetBrains Mono, ui-monospace, monospace",
            position: "end" as const,
            backgroundColor: "#f5b942",
            borderRadius: 0,
            padding: [2, 6, 2, 6],
            distance: 6,
          },
          data: [{ xAxis: nowIdx }],
        }
      : undefined;

  // --- helper: push an aggregate line + band for a line variable -------------
  const pushLineAggregate = (dv: DataVarId, axisIndex: number, attachMarks: boolean): void => {
    const pts = (props.data.aggregate[dv] ?? []).slice(0, n);
    const values = pts.map((p) => convertVar(p.value, dv, units.value));
    const smooth = dv === "temperature_2m";

    // Band (±1σ) — only when not in spaghetti mode (the spaghetti *is* the spread).
    if (!spaghetti) {
      const lower = pts.map((p) => convertVar(p.value - p.stdDev, dv, units.value));
      const delta = pts.map((p) => (Number.isFinite(p.stdDev) ? convertDelta(p.stdDev * 2, dv, units.value) : 0));
      series.push({
        id: "band-base",
        type: "line",
        stack: `band-${axisIndex}`,
        yAxisIndex: axisIndex,
        symbol: "none",
        lineStyle: { opacity: 0 },
        areaStyle: { opacity: 0 },
        itemStyle: { opacity: 0 },
        tooltip: { show: false },
        data: lower,
        ...(attachMarks && markArea ? { markArea } : {}),
      });
      series.push({
        id: "band-delta",
        type: "line",
        stack: `band-${axisIndex}`,
        yAxisIndex: axisIndex,
        symbol: "none",
        lineStyle: { opacity: 0 },
        areaStyle: { color: BAND_FILL },
        tooltip: { show: false },
        data: delta,
      });
    }

    series.push({
      id: "agg",
      name: "Aggregate forecast",
      type: "line",
      yAxisIndex: axisIndex,
      data: values,
      smooth,
      symbol: "none",
      lineStyle: { width: spaghetti ? 4 : 2.5, color: AGG_COLOR },
      z: 5,
      // When the band isn't drawn (spaghetti / precip), the agg line carries the
      // night shading + Now marker so they're always present.
      ...(attachMarks && spaghetti && markArea ? { markArea } : {}),
      ...(attachMarks && markLine ? { markLine } : {}),
    });
  };

  // --- helper: push precipitation (bars + optional truth) --------------------
  // `id` lets the composite Temp+Precip view give its precip bars a distinct id
  // ("agg-precip") so they don't collide with the temperature line's "agg".
  const pushPrecip = (axisIndex: number, attachMarks: boolean, id = "agg"): void => {
    const pts = (props.data.aggregate.precipitation ?? []).slice(0, n);
    const values = pts.map((p) => convertVar(p.value, "precipitation", units.value));
    series.push({
      id,
      name: "Aggregate forecast",
      type: "bar",
      yAxisIndex: axisIndex,
      data: values,
      itemStyle: { color: PRECIP_BAR_COLOR },
      barWidth: "60%",
      z: 1,
      ...(attachMarks && markArea ? { markArea } : {}),
      ...(attachMarks && markLine ? { markLine } : {}),
    });
    const truth = props.data.truth?.precipitation;
    if (truth) {
      series.push({
        id: "tr",
        name: "Truth",
        type: "line",
        yAxisIndex: axisIndex,
        data: truth.slice(0, n).map((x) => convertVar(x, "precipitation", units.value)),
        step: "middle",
        symbol: "none",
        lineStyle: { width: 2, color: TRUTH_COLOR },
        areaStyle: { color: TRUTH_AREA },
        z: 2,
      });
    }
  };

  // --- helper: push truth line for a line variable ---------------------------
  const pushLineTruth = (dv: DataVarId, axisIndex: number): void => {
    const truth = props.data.truth?.[dv];
    if (!truth) return;
    series.push({
      id: "tr",
      name: "Truth",
      type: "line",
      yAxisIndex: axisIndex,
      data: truth.slice(0, n).map((x) => convertVar(x, dv, units.value)),
      smooth: false,
      symbol: "none",
      lineStyle: { width: 3, color: TRUTH_COLOR },
      z: 6,
    });
  };

  // --- helper: push per-model spaghetti for a line variable ------------------
  const pushSpaghetti = (dv: DataVarId, axisIndex: number): void => {
    const byModel = props.data.perModel[dv] ?? {};
    for (const m of allModels.value) {
      const arr = byModel[m.id];
      if (!arr) continue;
      // Built at a constant opacity; visibility is applied via merge-patch so
      // toggling a chip never triggers a full redraw.
      series.push({
        id: `s-${m.id}`,
        name: m.label,
        type: "line",
        yAxisIndex: axisIndex,
        data: arr.slice(0, n).map((x) => convertVar(x, dv, units.value)),
        smooth: dv === "temperature_2m",
        symbol: "none",
        lineStyle: { width: 1, color: paletteFor(m.id), opacity: MODEL_OPACITY },
        z: 3,
      });
    }
  };

  // --- compose the series for the active view --------------------------------
  if (isComposite) {
    // Temp (line + band) on the left axis, precip (bars) on the right.
    // Distinct id so the precip bars don't collide with the temp line's "agg".
    pushLineAggregate("temperature_2m", 0, true);
    pushPrecip(1, false, "agg-precip");
  } else if (v === "precipitation") {
    pushPrecip(1, true);
    if (spaghetti) pushSpaghetti("precipitation", 1);
  } else {
    const dv = v as DataVarId;
    pushLineAggregate(dv, 0, true);
    pushLineTruth(dv, 0);
    if (spaghetti) pushSpaghetti(dv, 0);
  }

  // --- axes ------------------------------------------------------------------
  const leftIsPct = leftVar === "precipitation_probability" || leftVar === "cloud_cover";
  const leftUnit = leftVar ? unitLabel(leftVar, units.value) : "";
  const precipUnit = unitLabel("precipitation", units.value);
  const interval = hoursWindow.value <= 24 ? 2 : hoursWindow.value <= 72 ? 11 : 23;

  return {
    backgroundColor: "transparent",
    textStyle: { color: "#c9bea4", fontFamily: "JetBrains Mono, ui-monospace, monospace" },
    grid: { left: 52, right: 52, top: 32, bottom: 36 },
    animationDurationUpdate: 0,
    tooltip: {
      trigger: "axis",
      backgroundColor: "rgba(10, 16, 24, 0.96)",
      borderColor: "#1a2638",
      borderWidth: 1,
      textStyle: { color: "#f4ecd8", fontFamily: "JetBrains Mono, ui-monospace, monospace", fontSize: 11 },
      extraCssText: "border-radius: 0; backdrop-filter: blur(6px); box-shadow: 0 8px 32px rgba(0,0,0,0.6);",
      formatter: (params: unknown) => {
        const arr = params as Array<{ dataIndex: number }>;
        const idx = arr[0]?.dataIndex ?? -1;
        const timeStr = times[idx];
        if (idx < 0 || timeStr === undefined) return "";
        const header = new Date(timeStr).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" });
        const lines: string[] = [];
        // showAggregate/showTruth are read at hover time (not during option
        // compute) so they don't become reactive deps of `option`.
        const vars: DataVarId[] = CHART_VIEWS[v].vars;
        for (const dv of vars) {
          const aggPt = props.data.aggregate[dv]?.[idx];
          const isLine = DATA_VAR_META[dv].render === "line";
          if (showAggregate.value && aggPt && !Number.isNaN(aggPt.value)) {
            const std =
              isLine && !spaghetti && Number.isFinite(aggPt.stdDev) ? ` <span style="color:#94a3b8">± ${fmtVar(dv, aggPt.stdDev).replace(/[°a-zA-Z%/ ]+$/, "")}</span>` : "";
            const label = vars.length > 1 ? `${dv === "temperature_2m" ? "Temp" : "Precip"} ` : "Forecast ";
            const color = dv === "precipitation" ? "#7dd3fc" : AGG_COLOR;
            lines.push(`<span style="color:${color}">${label}</span>${fmtVar(dv, aggPt.value)}${std}`);
          }
          const truthVal = props.data.truth?.[dv]?.[idx];
          if (showTruth.value && truthVal != null) lines.push(`<span style="color:${TRUTH_COLOR}">Truth</span> ${fmtVar(dv, truthVal)}`);
        }
        // Per-model values when spaghetti is on (enabled models only).
        if (spaghetti) {
          const dv = activeVar.value;
          for (const m of allModels.value) {
            if (!enabledModels.value.has(m.id)) continue;
            const val = props.data.perModel[dv]?.[m.id]?.[idx];
            if (val == null) continue;
            lines.push(`<span style="color:${paletteFor(m.id)}">${m.label}</span> ${fmtVar(dv, val)}`);
          }
        }
        return `<div style="font-weight:600;margin-bottom:4px">${header}</div>${lines.join("<br/>")}`;
      },
    },
    xAxis: {
      type: "category",
      data: labels,
      axisLine: { lineStyle: { color: "#243349" } },
      axisLabel: { color: "#93896f", interval, hideOverlap: true, fontSize: 10 },
      axisTick: { show: false },
    },
    yAxis: [
      {
        // Left axis (temp / pct / wind). Always present so its splitLine draws
        // the horizontal grid even when only precipitation is shown.
        type: "value",
        name: leftVar ? leftUnit : "",
        nameTextStyle: { color: "#93896f", fontSize: 10 },
        axisLine: { show: false },
        axisLabel: { color: "#93896f", show: !!leftVar, fontSize: 10 },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: "#131d2d", type: "dashed" } },
        ...(leftIsPct ? { min: 0, max: 100 } : {}),
      },
      {
        // Right axis (precipitation).
        type: "value",
        name: precipUnit,
        nameTextStyle: { color: "#93896f", fontSize: 10 },
        position: "right",
        min: 0,
        axisLine: { show: false },
        axisLabel: { color: "#93896f", fontSize: 10 },
        splitLine: { lineStyle: { color: "#131d2d", type: "dashed" }, show: rightActive && !leftVar },
        show: rightActive,
      },
    ],
    series,
  };
});

// After a genuine recompute (view / window / data / showModels changed) ECharts
// resets series to their built state. Re-apply the no-redraw visibility so
// hidden series stay hidden.
watch(option, () => {
  void nextTick(() => {
    applyAggregateVisibility();
    applyTruthVisibility();
    applyModelVisibility();
  });
});

// ---- Chip visibility --------------------------------------------------------
const showAggregateChip = computed(() => hasTruth.value || showModels.value);
</script>

<template>
  <section class="border-ink-700 bg-ink-900/60 relative border p-4 sm:p-6">
    <!-- Header + window selector -->
    <div class="border-ink-700 mb-4 flex flex-wrap items-center justify-between gap-3 border-b pb-3">
      <h2 class="eyebrow flex items-center gap-2">
        <span class="bg-sodium-300/50 inline-block h-px w-6" />
        {{ title }}
      </h2>
      <div class="flex items-center gap-4">
        <span v-if="!showModels" class="text-paper-400 hidden font-mono text-[10px] tracking-[0.18em] uppercase sm:inline">
          <span class="text-aggregate-400">▒</span> spread ±1σ
        </span>
        <div class="border-ink-700 flex border font-mono text-[11px] tracking-[0.1em] uppercase">
          <button
            v-for="c in WINDOW_CHOICES"
            :key="c.hours"
            class="px-3 py-1 transition-colors"
            :class="hoursWindow === c.hours ? 'bg-sodium-300/15 text-sodium-200' : 'text-paper-300 hover:bg-ink-800 hover:text-paper-50'"
            @click="hoursWindow = c.hours"
          >
            {{ c.label }}
          </button>
        </div>
      </div>
    </div>

    <!-- Variable selector + show-models toggle -->
    <div class="mb-3 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
      <div class="border-ink-700 min-w-0 overflow-x-auto border font-mono text-[11px] tracking-[0.1em] uppercase">
        <div class="flex">
          <button
            v-for="vid in variables"
            :key="vid"
            class="border-ink-700 border-r px-3 py-1.5 whitespace-nowrap transition-colors last:border-r-0"
            :class="view === vid ? 'bg-sodium-300/15 text-sodium-200' : 'text-paper-300 hover:bg-ink-800 hover:text-paper-50'"
            @click="selectView(vid)"
          >
            {{ CHART_VIEWS[vid].label }}
          </button>
        </div>
      </div>

      <label class="text-paper-300 flex items-center gap-2 font-mono text-[11px] tracking-[0.14em] uppercase select-none">
        <input
          v-model="showModels"
          type="checkbox"
          class="border-ink-600 bg-ink-900 checked:border-sodium-300 checked:bg-sodium-300 size-3 appearance-none border transition-colors"
        />
        <span>Show contributing models</span>
      </label>
    </div>

    <div class="relative">
      <!-- Faint graph-paper backplate so the chart reads as an instrument
           plot, not a flat panel. -->
      <div class="graph-paper pointer-events-none absolute inset-0 opacity-40" aria-hidden="true" />
      <VChart ref="chartRef" style="height: 21rem" :option="option" autoresize class="relative" />
    </div>

    <!-- Chip strip: aggregate / truth toggles + per-model chips -->
    <div
      v-if="showAggregateChip || hasTruth || showModels"
      class="border-ink-700/60 mt-4 flex flex-wrap items-center gap-1.5 border-t pt-3 font-mono text-[10px] tracking-[0.12em] uppercase"
    >
      <button
        v-if="showAggregateChip"
        type="button"
        class="flex items-center gap-1.5 border px-2 py-1 transition-colors"
        :class="showAggregate ? 'border-ink-600 bg-ink-800 text-paper-50' : 'border-ink-700 bg-ink-950 text-paper-400 hover:text-paper-200'"
        @click="toggleAggregate"
      >
        <span class="inline-block size-2" :style="{ backgroundColor: AGG_COLOR }" />Aggregate
      </button>
      <button
        v-if="hasTruth"
        type="button"
        class="flex items-center gap-1.5 border px-2 py-1 transition-colors"
        :class="showTruth ? 'border-ink-600 bg-ink-800 text-paper-50' : 'border-ink-700 bg-ink-950 text-paper-400 hover:text-paper-200'"
        @click="toggleTruth"
      >
        <span class="inline-block size-2" :style="{ backgroundColor: TRUTH_COLOR }" />Truth
      </button>

      <template v-if="showModels">
        <span class="text-paper-400 mx-2">Models</span>
        <button
          v-for="m in allModels"
          :key="m.id"
          type="button"
          class="flex items-center gap-1.5 border px-2 py-1 transition-colors"
          :class="
            !modelHasData[m.id]
              ? 'border-ink-700/50 bg-ink-950 text-paper-500 cursor-not-allowed line-through opacity-50'
              : enabledModels.has(m.id)
                ? 'border-ink-600 bg-ink-800 text-paper-50'
                : 'border-ink-700 bg-ink-950 text-paper-400 hover:text-paper-200'
          "
          :disabled="!modelHasData[m.id]"
          :title="modelHasData[m.id] ? `${m.provider} · ${m.description}` : `${m.provider} · no data for this variable`"
          @click="toggleModel(m.id)"
        >
          <span class="inline-block size-2" :style="{ backgroundColor: paletteFor(m.id) }" />{{ m.label }}
        </button>
        <button type="button" class="text-sodium-300/80 hover:text-sodium-200 ml-2 underline-offset-4 hover:underline" @click="selectAllModels">all</button>
        <span class="text-paper-500">/</span>
        <button type="button" class="text-sodium-300/80 hover:text-sodium-200 underline-offset-4 hover:underline" @click="selectNoModels">none</button>
      </template>
    </div>
  </section>
</template>
