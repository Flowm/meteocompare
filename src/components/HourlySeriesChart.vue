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
const AGG_COLOR = "#f472b6"; // pink — aggregate forecast
const TRUTH_COLOR = "#facc15"; // amber — ERA5-Seamless truth
const PRECIP_BAR_COLOR = "rgba(56, 189, 248, 0.7)"; // sky — precipitation bars
const BAND_FILL = "rgba(244, 114, 182, 0.18)"; // pink, low alpha — ±1σ band
const TRUTH_AREA = "rgba(250, 204, 21, 0.12)"; // amber, low alpha — precip truth fill
const NIGHT_FILL = "rgba(56, 78, 130, 0.18)";
const MODEL_PALETTE = ["#60a5fa", "#34d399", "#a78bfa", "#fb7185", "#22d3ee", "#f87171", "#facc15", "#4ade80", "#c084fc", "#fcd34d", "#86efac"];
const BAND_OPACITY = 0.18;
const TRUTH_AREA_OPACITY = 0.12;
const MODEL_OPACITY = 0.6;

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
          lineStyle: { color: "rgba(248, 250, 252, 0.85)", width: 1.5, type: "solid" as const },
          label: { formatter: "Now", color: "#f8fafc", fontSize: 11, position: "end" as const, backgroundColor: "rgba(15, 23, 42, 0.85)", borderRadius: 4, padding: [2, 6, 2, 6] },
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
    textStyle: { color: "#cbd5e1" },
    grid: { left: 48, right: 48, top: 32, bottom: 36 },
    animationDurationUpdate: 0,
    tooltip: {
      trigger: "axis",
      backgroundColor: "rgba(15, 23, 42, 0.95)",
      borderColor: "#334155",
      textStyle: { color: "#e2e8f0" },
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
      axisLine: { lineStyle: { color: "#475569" } },
      axisLabel: { color: "#94a3b8", interval, hideOverlap: true },
      axisTick: { show: false },
    },
    yAxis: [
      {
        // Left axis (temp / pct / wind). Always present so its splitLine draws
        // the horizontal grid even when only precipitation is shown.
        type: "value",
        name: leftVar ? leftUnit : "",
        nameTextStyle: { color: "#94a3b8" },
        axisLine: { show: false },
        axisLabel: { color: "#94a3b8", show: !!leftVar },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: "#1e293b" } },
        ...(leftIsPct ? { min: 0, max: 100 } : {}),
      },
      {
        // Right axis (precipitation).
        type: "value",
        name: precipUnit,
        nameTextStyle: { color: "#94a3b8" },
        position: "right",
        min: 0,
        axisLine: { show: false },
        axisLabel: { color: "#94a3b8" },
        splitLine: { lineStyle: { color: "#1e293b" }, show: rightActive && !leftVar },
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
  <section class="rounded-2xl bg-slate-900/60 p-4 ring-1 ring-slate-800 sm:p-6">
    <!-- Header + window selector -->
    <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
      <h2 class="text-sm font-medium tracking-wider text-slate-300 uppercase">{{ title }}</h2>
      <div class="flex items-center gap-3">
        <span v-if="!showModels" class="hidden text-xs text-slate-500 sm:inline">Shaded: model spread (±1σ)</span>
        <div class="flex overflow-hidden rounded-md bg-slate-950 text-xs ring-1 ring-slate-800">
          <button
            v-for="c in WINDOW_CHOICES"
            :key="c.hours"
            class="px-3 py-1.5 transition-colors"
            :class="hoursWindow === c.hours ? 'bg-slate-700 text-slate-100' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'"
            @click="hoursWindow = c.hours"
          >
            {{ c.label }}
          </button>
        </div>
      </div>
    </div>

    <!-- Variable selector + show-models toggle -->
    <div class="mb-3 flex flex-col gap-3 text-xs sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
      <div class="min-w-0 overflow-x-auto rounded-md bg-slate-950 ring-1 ring-slate-800">
        <div class="flex">
          <button
            v-for="vid in variables"
            :key="vid"
            class="px-3 py-1.5 whitespace-nowrap transition-colors"
            :class="view === vid ? 'bg-slate-700 text-slate-100' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'"
            @click="selectView(vid)"
          >
            {{ CHART_VIEWS[vid].label }}
          </button>
        </div>
      </div>

      <label class="flex items-center gap-1.5 text-slate-400">
        <input v-model="showModels" type="checkbox" class="accent-slate-400" />
        <span>Show contributing models</span>
      </label>
    </div>

    <VChart ref="chartRef" style="height: 20rem" :option="option" autoresize />

    <!-- Chip strip: aggregate / truth toggles + per-model chips -->
    <div v-if="showAggregateChip || hasTruth || showModels" class="mt-4 flex flex-wrap items-center gap-2 text-xs">
      <button
        v-if="showAggregateChip"
        type="button"
        class="rounded-md px-2 py-1 ring-1 transition-colors"
        :class="showAggregate ? 'bg-slate-800 text-slate-100 ring-slate-700' : 'bg-slate-950 text-slate-500 ring-slate-800 hover:text-slate-300'"
        @click="toggleAggregate"
      >
        <span class="mr-1.5 inline-block size-2 rounded-full" :style="{ backgroundColor: AGG_COLOR }" />Aggregate forecast
      </button>
      <button
        v-if="hasTruth"
        type="button"
        class="rounded-md px-2 py-1 ring-1 transition-colors"
        :class="showTruth ? 'bg-slate-800 text-slate-100 ring-slate-700' : 'bg-slate-950 text-slate-500 ring-slate-800 hover:text-slate-300'"
        @click="toggleTruth"
      >
        <span class="mr-1.5 inline-block size-2 rounded-full" :style="{ backgroundColor: TRUTH_COLOR }" />Truth
      </button>

      <template v-if="showModels">
        <span class="mr-1 ml-2 text-slate-500">Models:</span>
        <button
          v-for="m in allModels"
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
          <span class="mr-1.5 inline-block size-2 rounded-full" :style="{ backgroundColor: paletteFor(m.id) }" />{{ m.label }}
        </button>
        <button type="button" class="ml-2 text-slate-500 underline hover:text-slate-300" @click="selectAllModels">all</button>
        <button type="button" class="text-slate-500 underline hover:text-slate-300" @click="selectNoModels">none</button>
      </template>
    </div>
  </section>
</template>
