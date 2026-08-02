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

import { useChartControls } from "./chartControls";
import { CHART_VIEWS, type ChartViewId } from "./chartHelpers";
import { AGG_COLOR, BAND_SWATCH, buildHourlyChartOption, TRUTH_COLOR, visibilityPatches } from "./chartOption";
import { buildTooltipFormatter } from "./chartTooltip";
import ChevronIcon from "./ChevronIcon.vue";
import ModelControlRail from "./ModelControlRail.vue";
import PopoverPanel from "./PopoverPanel.vue";
import Swatch from "./Swatch.vue";

const props = withDefaults(
  defineProps<{
    data: HourlySeries;
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

/** Output-only: the per-model overlay is on iff at least one chip is enabled, so
 *  `enabledModels` is the single source of truth. This model just mirrors that
 *  derived boolean out to the parent (verify, to reveal its day-card rows); the
 *  parent never writes it, so there's no second source to hand-sync. */
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
// All control decisions — view selection, the combinable Temp+Precip pair, the
// chip enable/reset/snap rules, visibility toggles — live in the testable
// controls module; this component renders them and patches the chart.
const {
  view,
  hoursWindow,
  showAggregate,
  showBand,
  showTruth,
  enabledModels,
  overlayOn,
  hasTruth,
  activeVar,
  allModels,
  modelHasData,
  allModelsActive,
  isVarActive,
  selectVariable: selectControlVariable,
  toggleAggregate,
  toggleBand,
  toggleTruth,
  toggleModel,
  toggleAllModels,
} = useChartControls({ data: () => props.data, variables: props.variables, defaultWindow: props.defaultWindow });

// Direct handle to the ECharts instance for no-redraw merge patches.
// vue-echarts exposes the underlying instance as `.chart` on its component ref.
const chartRef = ref<{ chart?: ECharts } | null>(null);

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

function selectVariable(vid: ChartViewId): void {
  selectControlVariable(vid);
  varOpen.value = false;
}

// Mirror the derived overlay boolean out to the parent's v-model (verify
// reveals its per-model day-card rows). The composite→Temperature snap on
// overlay-enable lives in the controls module.
watch(
  overlayOn,
  (on) => {
    if (showModels.value !== on) showModels.value = on;
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

// One watch drives every visibility patch: whenever any toggle changes, re-apply
// the no-redraw opacity merge. These refs stay OUT of `option`'s reactive deps
// (only the tooltip reads them, lazily at hover), so flipping a toggle patches
// the chart directly without a full rebuild — the handlers below just flip state.
watch([showAggregate, showBand, showTruth, enabledModels], () => applyVisibility());

// ---- Cursor tracking (tooltip highlight) ------------------------------------
/** Axis the per-model lines live on — right (1) for precip, left (0) otherwise. */
const overlayAxis = computed(() => (activeVar.value === "precipitation" ? 1 : 0));
const { cursorValue } = useChartCursor(() => chartRef.value?.chart, overlayAxis);

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

  <div class="border-ink-700 bg-ink-900/60 relative border p-3 sm:p-6">
    <div ref="variableControlsRoot" class="relative mb-3 flex items-center gap-3 sm:mb-4">
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

      <div v-else ref="varRoot" class="relative">
        <button
          type="button"
          class="group border-ink-700 bg-ink-900/60 text-paper-200 hover:border-sodium-300/60 hover:text-paper-50 flex items-center gap-2 border px-3 py-1 font-mono text-xs tracking-wide transition-colors"
          :aria-expanded="varOpen"
          aria-haspopup="menu"
          @click="varOpen = !varOpen"
        >
          {{ CHART_VIEWS[view].label }}
          <ChevronIcon class="text-paper-300 size-3" :open="varOpen" />
        </button>
        <PopoverPanel v-if="varOpen" role="menu" class="top-full left-0 min-w-[12rem]">
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
        </PopoverPanel>
      </div>

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
      <div class="flex items-start gap-2">
        <span class="text-paper-400 w-14 shrink-0 pt-[5px]">Series</span>
        <div class="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            class="flex items-center gap-1.5 border px-2 py-1 transition-colors"
            :class="showAggregate ? 'border-ink-600 bg-ink-800 text-paper-50' : 'border-ink-700 bg-ink-950 text-paper-400 hover:text-paper-200'"
            @click="toggleAggregate"
          >
            <Swatch :color="AGG_COLOR" />Aggregate
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
            <Swatch :color="BAND_SWATCH" />Spread ±1σ
          </button>
          <button
            v-if="hasTruth"
            type="button"
            class="flex items-center gap-1.5 border px-2 py-1 transition-colors"
            :class="showTruth ? 'border-ink-600 bg-ink-800 text-paper-50' : 'border-ink-700 bg-ink-950 text-paper-400 hover:text-paper-200'"
            @click="toggleTruth"
          >
            <Swatch :color="TRUTH_COLOR" />Truth
          </button>
        </div>
      </div>

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
