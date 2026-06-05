<script setup lang="ts">
import { onClickOutside, useResizeObserver } from "@vueuse/core";
import type { EChartsOption } from "echarts";
import type { ECharts } from "echarts/core";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import VChart from "vue-echarts";

import type { DataVarId, HourlySeries } from "@/composables/hourlySeries";
import { convertVar, useUnits } from "@/composables/useUnits";
import { MODELS, type ModelDef } from "@/domain/models";

import { CHART_VIEWS, isVarActive as isVarActiveFor, nextCombinableView, type ChartViewId } from "./chartHelpers";
import { AGG_COLOR, BAND_SWATCH, buildHourlyChartOption, paletteFor, TRUTH_COLOR, visibilityPatches } from "./chartOption";
import ModelControlRail from "./ModelControlRail.vue";

const props = withDefaults(
  defineProps<{
    /** The unified hourly view-model (aggregate / perModel / optional truth). */
    data: HourlySeries;
    /** Heading shown above the chart, e.g. "Hourly forecast". */
    title: string;
    /** Hide the built-in heading when a parent section provides the title. */
    showTitle?: boolean;
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
  { solar: null, currentTime: undefined, defaultWindow: 72, showTitle: true },
);

/** Two-way when the parent binds it (verify, to share with the day cards);
 *  derived locally from `enabledModels.size > 0` — kept as a writable ref so
 *  selectView() can also clear the overlay when switching to a composite view. */
const showModels = defineModel<boolean>("showModels", { default: false });

const { prefs, formatTemp, formatPrecip, formatWind } = useUnits();

// Colours, the model palette, and paletteFor() now live in ./chartOption
// alongside the option builder; the component imports only the few it needs
// for the legend swatches and the no-redraw opacity patches.

const WINDOW_CHOICES = [
  { hours: 24, label: "24h" },
  { hours: 72, label: "3d" },
  { hours: 168, label: "7d" },
] as const;

// ---- UI state ---------------------------------------------------------------
// Forecast (no truth) opens on the combined temperature + precipitation view;
// verify keeps per-variable views so each can show its own ERA5 truth line.
const canCombineTempPrecip = !props.data.truth && props.variables.includes("temperature_2m") && props.variables.includes("precipitation");
const view = ref<ChartViewId>(canCombineTempPrecip ? "temp_precip" : (props.variables[0] ?? "temperature_2m"));
const hoursWindow = ref<number>(props.defaultWindow);

// Visibility toggles. Kept OUT of `option` so toggling them patches the chart
// directly (no full redraw) — only re-read inside the tooltip formatter at
// hover time, where they don't register as reactive dependencies.
const showAggregate = ref(true);
const showBand = ref(true);
const showTruth = ref(true);
const enabledModels = ref<Set<string>>(new Set());

// Direct handle to the ECharts instance for no-redraw merge patches.
// vue-echarts exposes the underlying instance as `.chart` on its component ref.
const chartRef = ref<{ chart?: ECharts } | null>(null);

const hasTruth = computed(() => !!props.data.truth);

/** The single variable an overlay line is drawn for. Composite views resolve
 *  to their `overlayVar`. */
const activeVar = computed<DataVarId>(() => CHART_VIEWS[view.value].overlayVar);

// Q11 (option A): the per-model overlay needs a single variable. Enabling any model while
// the composite Temp+Precip view is selected snaps to Temperature.
watch(showModels, (on) => {
  if (on && view.value === "temp_precip") view.value = "temperature_2m";
});

function selectView(v: ChartViewId): void {
  // The reverse of the snap: picking the composite while the overlay is on
  // clears the enabled models (two fans on two axes is unreadable).
  if (v === "temp_precip" && showModels.value) enabledModels.value = new Set();
  view.value = v;
}

// Variable picker: keep the expanded rail while it fits beside the window
// selector; collapse only when the two controls would wrap.
const variableControlsRoot = ref<HTMLElement | null>(null);
const variableRailProbe = ref<HTMLElement | null>(null);
const windowSelector = ref<HTMLElement | null>(null);
const showExpandedVariableRail = ref(true);
const varOpen = ref(false);
const varRoot = ref<HTMLElement | null>(null);
onClickOutside(varRoot, () => (varOpen.value = false));

function updateVariableRailMode(): void {
  void nextTick(() => {
    const root = variableControlsRoot.value;
    const rail = variableRailProbe.value;
    const window = windowSelector.value;
    if (!root || !rail || !window) return;
    const rowGap = 12; // gap-3
    showExpandedVariableRail.value = rail.offsetWidth + window.offsetWidth + rowGap <= root.clientWidth;
    if (showExpandedVariableRail.value) varOpen.value = false;
  });
}

useResizeObserver(variableControlsRoot, updateVariableRailMode);
useResizeObserver(windowSelector, updateVariableRailMode);
onMounted(updateVariableRailMode);
watch(() => props.variables.map((v) => v).join(","), updateVariableRailMode);

/** Whether a picker entry reads as "active". Temperature and precipitation are
 *  a combinable pair on the forecast page: either is active in the composite. */
function isVarActive(vid: ChartViewId): boolean {
  return isVarActiveFor(view.value, vid, canCombineTempPrecip);
}

function selectVariable(vid: ChartViewId): void {
  // Temperature & precipitation toggle independently (dual-axis) into the
  // composite; every other variable is an exclusive single-axis view. The set
  // arithmetic for the combinable pair lives in chartHelpers.nextCombinableView.
  if (canCombineTempPrecip && (vid === "temperature_2m" || vid === "precipitation")) {
    selectView(nextCombinableView(view.value, vid));
  } else {
    selectView(vid);
  }
  varOpen.value = false;
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

// Reset enabled models whenever the chip universe changes (new data / run).
// Default: nothing is enabled, so the chart starts clean (aggregate + band +
// truth only). The user opts in to the per-model overlay via the chips below the
// chart — this is the single source of truth for "show contributing models".
watch(
  () => allModels.value.map((m) => m.id).join(","),
  () => {
    enabledModels.value = new Set();
  },
  { immediate: true },
);

// Sync the v-model:showModels out to the parent whenever the chip set changes,
// so VerificationView can reveal per-model rows in its day cards.
watch(
  enabledModels,
  () => {
    const next = enabledModels.value.size > 0;
    if (showModels.value !== next) showModels.value = next;
  },
  { immediate: true },
);

// ---- Chip toggles (no-redraw) ----------------------------------------------
// One imperative shell: merge-patch the toggleable series' opacity straight onto
// the ECharts instance, so flipping a chip never triggers a full redraw. The
// per-series rules (which style prop, the "shown" opacity, the precip-truth
// area-fill) live in the builder's `toggles`; visibilityPatches() maps those +
// the current toggle state to the patches.
function applyVisibility(): void {
  const chart = chartRef.value?.chart;
  if (!chart) return;
  const patches = visibilityPatches(toggles.value, {
    showAggregate: showAggregate.value,
    showBand: showBand.value,
    showTruth: showTruth.value,
    enabledModels: enabledModels.value,
  });
  if (patches.length) chart.setOption({ series: patches }, false);
}

function toggleAggregate(): void {
  showAggregate.value = !showAggregate.value;
  applyVisibility();
}
function toggleBand(): void {
  showBand.value = !showBand.value;
  applyVisibility();
}
function toggleTruth(): void {
  showTruth.value = !showTruth.value;
  applyVisibility();
}
function toggleModel(id: string): void {
  if (!modelHasData.value[id]) return;
  const next = new Set(enabledModels.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  enabledModels.value = next;
  applyVisibility();
}
function selectAllModels(): void {
  enabledModels.value = new Set(allModels.value.filter((m) => modelHasData.value[m.id]).map((m) => m.id));
  applyVisibility();
}
function selectNoModels(): void {
  enabledModels.value = new Set();
  applyVisibility();
}

// Single "All" toggle: active only when every available model is enabled;
// clicking flips between all-on and all-off.
const allModelsActive = computed(() => {
  const available = allModels.value.filter((m) => modelHasData.value[m.id]);
  return available.length > 0 && available.every((m) => enabledModels.value.has(m.id));
});
function toggleAllModels(): void {
  if (allModelsActive.value) selectNoModels();
  else selectAllModels();
}

// ---- Cursor tracking (tooltip highlight) ------------------------------------
// With many model lines enabled the tooltip lists them all, and it's hard to
// tell which row is which line. We track the cursor's value on the overlay
// axis (the formatter gets no pointer position) so the nearest model entry can
// be highlighted. Stored in the active unit, to match the converted line data.
const cursorValue = ref<number | null>(null);
/** Axis the per-model lines live on — right (1) for precip, left (0) otherwise. */
const overlayAxis = computed(() => (activeVar.value === "precipitation" ? 1 : 0));

let detachCursor: (() => void) | null = null;
watch(
  () => chartRef.value?.chart,
  (chart) => {
    detachCursor?.();
    detachCursor = null;
    if (!chart) return;
    const zr = chart.getZr();
    const onMove = (e: { offsetX: number; offsetY: number }): void => {
      if (!chart.containPixel("grid", [e.offsetX, e.offsetY])) {
        cursorValue.value = null;
        return;
      }
      const v = chart.convertFromPixel({ yAxisIndex: overlayAxis.value }, e.offsetY);
      cursorValue.value = typeof v === "number" ? v : null;
    };
    const onOut = (): void => {
      cursorValue.value = null;
    };
    zr.on("mousemove", onMove);
    zr.on("globalout", onOut);
    detachCursor = (): void => {
      zr.off("mousemove", onMove);
      zr.off("globalout", onOut);
    };
  },
  { immediate: true },
);
onBeforeUnmount(() => detachCursor?.());

// ---- Tooltip formatting -----------------------------------------------------
function fmtVar(dv: DataVarId, base: number | null | undefined): string {
  if (dv === "temperature_2m") return formatTemp.value(base, 1);
  if (dv === "precipitation") return formatPrecip.value(base, 1);
  if (dv === "wind_speed_10m") return formatWind.value(base, 1);
  if (base == null || Number.isNaN(base)) return "–";
  return `${Math.round(base)}%`;
}

// ---- Chart option -----------------------------------------------------------
// The pure builder produces the option plus the visibility descriptors for its
// toggleable series; both stay in sync because they come from one build.
const built = computed(() =>
  buildHourlyChartOption({
    data: props.data,
    view: view.value,
    hoursWindow: hoursWindow.value,
    units: prefs.value,
    solar: props.solar,
    currentTime: props.currentTime,
    models: allModels.value,
    showModels: showModels.value,
  }),
);
const toggles = computed(() => built.value.toggles);

const option = computed<EChartsOption>(() => {
  const v = view.value;
  const n = Math.min(hoursWindow.value, props.data.times.length);
  const times = props.data.times.slice(0, n);
  const overlay = showModels.value;

  const o = built.value.option;

  // The tooltip formatter reads live toggle state (showAggregate / showBand /
  // showTruth / enabledModels) at hover time, not during option compute, so
  // those toggles never become reactive deps of `option` — the no-redraw trick.
  // It therefore stays here in the component rather than in the pure builder.
  (o.tooltip as { formatter?: (params: unknown) => string }).formatter = (params: unknown) => {
    const arr = params as Array<{ dataIndex: number }>;
    const idx = arr[0]?.dataIndex ?? -1;
    const timeStr = times[idx];
    if (idx < 0 || timeStr === undefined) return "";
    const header = new Date(timeStr).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" });
    const lines: string[] = [];
    const vars: DataVarId[] = CHART_VIEWS[v].vars;
    for (const dv of vars) {
      const aggPt = props.data.aggregate[dv]?.[idx];
      if (showAggregate.value && aggPt && !Number.isNaN(aggPt.value)) {
        // ±1σ shown whenever the spread is on — bars carry it as error-bar
        // whiskers, line views as the shaded band, but the tooltip reads alike.
        const std = showBand.value && Number.isFinite(aggPt.stdDev) ? ` <span style="color:#94a3b8">± ${fmtVar(dv, aggPt.stdDev).replace(/[°a-zA-Z%/ ]+$/, "")}</span>` : "";
        const label = vars.length > 1 ? `${dv === "temperature_2m" ? "Temp" : "Precip"} ` : "Forecast ";
        const color = dv === "precipitation" ? "#7dd3fc" : AGG_COLOR;
        lines.push(`<span style="color:${color}">${label}</span>${fmtVar(dv, aggPt.value)}${std}`);
      }
      const truthVal = props.data.truth?.[dv]?.[idx];
      if (showTruth.value && truthVal != null) lines.push(`<span style="color:${TRUTH_COLOR}">Truth</span> ${fmtVar(dv, truthVal)}`);
    }
    // Per-model values when the overlay is on (enabled models only). The model
    // whose value sits closest to the cursor is highlighted, so a busy fan of
    // lines can be read off against the tooltip.
    if (overlay) {
      const dv = activeVar.value;
      const cv = cursorValue.value;
      const shown = allModels.value.filter((m) => enabledModels.value.has(m.id) && props.data.perModel[dv]?.[m.id]?.[idx] != null);
      let nearestId: string | null = null;
      if (cv != null) {
        let best = Infinity;
        for (const m of shown) {
          const display = convertVar(props.data.perModel[dv]![m.id]![idx], dv, prefs.value);
          if (display == null) continue;
          const d = Math.abs(display - cv);
          if (d < best) {
            best = d;
            nearestId = m.id;
          }
        }
      }
      for (const m of shown) {
        const val = props.data.perModel[dv]![m.id]![idx];
        const near = m.id === nearestId;
        const marker = near ? "▸ " : "&nbsp;&nbsp;";
        const label = `<span style="color:${paletteFor(m.id)}${near ? ";font-weight:700" : ""}">${marker}${m.label}</span>`;
        const value = near ? `<span style="color:#f4ecd8;font-weight:700">${fmtVar(dv, val)}</span>` : fmtVar(dv, val);
        lines.push(`${label} ${value}`);
      }
    }
    return `<div style="font-weight:600;margin-bottom:4px">${header}</div>${lines.join("<br/>")}`;
  };

  return o;
});

// After a genuine recompute (view / window / data / showModels changed) ECharts
// resets series to their built state. Re-apply the no-redraw visibility so
// hidden series stay hidden.
watch(option, () => {
  void nextTick(() => {
    applyVisibility();
  });
});

// ---- Chip visibility --------------------------------------------------------
// The ±1σ spread is drawn for every view — a shaded band on line views, and
// error-bar whiskers on the precipitation bars — so the chip always applies.
const hasBand = computed(() => true);
</script>

<template>
  <h2 v-if="showTitle" class="eyebrow mb-3">{{ title }}</h2>

  <div class="border-ink-700 bg-ink-900/60 relative border p-4 sm:p-6">
    <!-- Variable picker (left) + window selector (right) share a line -->
    <div ref="variableControlsRoot" class="relative mb-4 flex items-center gap-3">
      <!-- Off-layout probe used only to measure the rail's natural width. The
           zero-size, overflow-hidden wrapper keeps the w-max child from
           expanding the page (it would otherwise leak horizontal scroll on
           mobile); offsetWidth still reports the child's full intrinsic width. -->
      <div aria-hidden="true" class="pointer-events-none absolute -z-10 h-0 w-0 overflow-hidden">
        <div ref="variableRailProbe" class="border-ink-700 flex w-max border font-mono text-xs tracking-wide">
          <span v-for="vid in variables" :key="vid" class="border-ink-700 border-r px-2.5 py-1 whitespace-nowrap last:border-r-0">
            {{ CHART_VIEWS[vid].label }}
          </span>
        </div>
      </div>

      <!-- Expanded variable rail while it fits beside the window selector. -->
      <div v-if="showExpandedVariableRail" class="border-ink-700 flex border font-mono text-xs tracking-wide">
        <button
          v-for="vid in variables"
          :key="vid"
          class="border-ink-700 border-r px-2.5 py-1 whitespace-nowrap transition-colors last:border-r-0"
          :class="isVarActive(vid) ? 'bg-sodium-300/15 text-sodium-200' : 'text-paper-300 hover:bg-ink-800 hover:text-paper-50'"
          @click="selectVariable(vid)"
        >
          {{ CHART_VIEWS[vid].label }}
        </button>
      </div>

      <!-- Dropdown fallback when the expanded rail would wrap. -->
      <div v-else ref="varRoot" class="relative">
        <button
          type="button"
          class="group border-ink-700 bg-ink-900/60 text-paper-200 hover:border-sodium-300/60 hover:text-paper-50 flex items-center gap-2 border px-3 py-1 font-mono text-xs tracking-wide transition-colors"
          :aria-expanded="varOpen"
          aria-haspopup="menu"
          @click="varOpen = !varOpen"
        >
          {{ CHART_VIEWS[view].label }}
          <svg class="text-paper-300 size-3 transition-transform" :class="{ 'rotate-180': varOpen }" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>
        <div
          v-if="varOpen"
          role="menu"
          class="panel-in border-ink-700 bg-ink-900 absolute top-full left-0 z-40 mt-1 min-w-[12rem] overflow-hidden border shadow-2xl shadow-black/60"
        >
          <button
            v-for="vid in variables"
            :key="vid"
            type="button"
            role="menuitemradio"
            :aria-checked="isVarActive(vid)"
            class="block w-full px-3 py-2 text-left font-mono text-xs tracking-wide transition-colors"
            :class="isVarActive(vid) ? 'bg-ink-800 text-sodium-200' : 'text-paper-200 hover:bg-ink-800 hover:text-sodium-200'"
            @click="selectVariable(vid)"
          >
            {{ CHART_VIEWS[vid].label }}
          </button>
        </div>
      </div>

      <!-- Window selector (right-aligned) -->
      <div ref="windowSelector" class="border-ink-700 ml-auto flex shrink-0 border font-mono text-xs tracking-wide">
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

    <!-- Bleed the plot slightly past the card padding so it spans a touch
         wider; the labelled controls above/below keep their full inset. -->
    <div class="relative -mx-2">
      <!-- Faint graph-paper backplate so the chart reads as an instrument
           plot, not a flat panel. -->
      <div class="graph-paper pointer-events-none absolute inset-0 opacity-40" aria-hidden="true" />
      <VChart ref="chartRef" style="height: 21rem" :option="option" autoresize class="relative" />
    </div>

    <!-- Legend / filter strip ---------------------------------------------
         Two labelled sections — SERIES (aggregate / spread / truth toggles)
         and MODELS (an "All" toggle plus per-model overlay chips). Enabling
         any model chip turns the overlay on; "All" flips every model at once. -->
    <div class="border-ink-700/60 mt-2 space-y-2.5 border-t pt-3 font-mono text-[11px] tracking-wide">
      <!-- SERIES -->
      <div class="flex items-start gap-2">
        <span class="text-paper-400 w-14 shrink-0 pt-[5px]">Series</span>
        <div class="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            class="flex items-center gap-1.5 border px-2 py-1 transition-colors"
            :class="showAggregate ? 'border-ink-600 bg-ink-800 text-paper-50' : 'border-ink-700 bg-ink-950 text-paper-400 hover:text-paper-200'"
            @click="toggleAggregate"
          >
            <span class="inline-block size-2" :style="{ backgroundColor: AGG_COLOR }" />Aggregate
          </button>
          <button
            v-if="hasBand"
            type="button"
            class="flex items-center gap-1.5 border px-2 py-1 transition-colors"
            :class="showBand ? 'border-ink-600 bg-ink-800 text-paper-50' : 'border-ink-700 bg-ink-950 text-paper-400 hover:text-paper-200'"
            title="Model spread (±1σ)"
            @click="toggleBand"
          >
            <span class="inline-block size-2" :style="{ backgroundColor: BAND_SWATCH }" />Spread ±1σ
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
        </div>
      </div>

      <!-- MODELS -->
      <ModelControlRail
        :models="allModels"
        :model-has-data="modelHasData"
        :enabled-models="enabledModels"
        :all-models-active="allModelsActive"
        @toggle-all="toggleAllModels"
        @toggle-model="toggleModel"
      />
    </div>
  </div>
</template>
