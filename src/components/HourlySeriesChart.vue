<script setup lang="ts">
import { onClickOutside } from "@vueuse/core";
import type { EChartsOption } from "echarts";
import type { ECharts } from "echarts/core";
import { computed, nextTick, ref, watch } from "vue";
import VChart from "vue-echarts";

import type { DataVarId, HourlySeries } from "@/composables/hourlySeries";
import { useChartCursor } from "@/composables/useChartCursor";
import { useFittingRail } from "@/composables/useFittingRail";
import { useUnits } from "@/composables/useUnits";
import { MODELS, type ModelDef } from "@/domain/models";

import { CHART_VIEWS, isVarActive as isVarActiveFor, nextCombinableView, type ChartViewId } from "./chartHelpers";
import { AGG_COLOR, BAND_SWATCH, buildHourlyChartOption, TRUTH_COLOR, visibilityPatches } from "./chartOption";
import { buildTooltipFormatter } from "./chartTooltip";
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
// selector; collapse to a dropdown only when the two controls would wrap. The
// off-layout probe measures the rail's natural width.
const variableControlsRoot = ref<HTMLElement | null>(null);
const variableRailProbe = ref<HTMLElement | null>(null);
const windowSelector = ref<HTMLElement | null>(null);
const showExpandedVariableRail = useFittingRail(variableControlsRoot, variableRailProbe, windowSelector, () => props.variables.join(","));

// Dropdown open state (collapsed mode only) — forced shut whenever the rail
// expands back to fitting on one line.
const varOpen = ref(false);
const varRoot = ref<HTMLElement | null>(null);
onClickOutside(varRoot, () => (varOpen.value = false));
watch(showExpandedVariableRail, (expanded) => {
  if (expanded) varOpen.value = false;
});

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
/** Axis the per-model lines live on — right (1) for precip, left (0) otherwise. */
const overlayAxis = computed(() => (activeVar.value === "precipitation" ? 1 : 0));
const { cursorValue } = useChartCursor(() => chartRef.value?.chart, overlayAxis);

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
  const n = Math.min(hoursWindow.value, props.data.times.length);
  const o = built.value.option;

  // The formatter reads live toggle state (showAggregate / showBand / showTruth
  // / enabledModels / cursor) at hover time via `liveState()`, never during this
  // compute — so those toggles stay out of `option`'s reactive deps (the
  // no-redraw trick). view / window / data / overlay ARE deps and are captured
  // here; see chartTooltip.buildTooltipFormatter.
  (o.tooltip as { formatter?: (params: unknown) => string }).formatter = buildTooltipFormatter({
    view: view.value,
    times: props.data.times.slice(0, n),
    data: props.data,
    units: prefs.value,
    models: allModels.value,
    overlay: showModels.value,
    fmtVar,
    liveState: () => ({
      showAggregate: showAggregate.value,
      showBand: showBand.value,
      showTruth: showTruth.value,
      enabledModels: enabledModels.value,
      cursorValue: cursorValue.value,
    }),
  });

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
          <!-- The ±1σ spread is drawn for every view — a shaded band on line
               views, error-bar whiskers on the precipitation bars — so the
               toggle always applies. -->
          <button
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
