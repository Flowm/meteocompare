// Decision logic for the hourly-series chart's controls — view selection, the
// combinable Temp+Precip pair, the per-model overlay chips and their reset /
// snap rules, and the series visibility toggles. Separate from
// HourlySeriesChart.vue so the transition rules are testable without a DOM; the
// component keeps rendering, DOM refs, and the no-redraw ECharts patches.

import { computed, ref, watch, type ComputedRef, type Ref } from "vue";

import type { DataVarId, HourlySeries } from "@/composables/hourlySeries";
import { MODELS, type ModelDef } from "@/domain/models";

import { CHART_VIEWS, isVarActive as isVarActiveFor, nextCombinableView, type ChartViewId } from "./chartHelpers";

export interface ChartControlsOptions {
  /** Getter so the controls track the live view-model (props are reactive). */
  data: () => HourlySeries;
  /** Selectable variable views, in display order. First is the initial selection. */
  variables: readonly ChartViewId[];
  /** Initial visible window in hours. */
  defaultWindow: number;
}

export interface ChartControls {
  view: Ref<ChartViewId>;
  hoursWindow: Ref<number>;
  showAggregate: Ref<boolean>;
  showBand: Ref<boolean>;
  showTruth: Ref<boolean>;
  enabledModels: Ref<Set<string>>;
  /** The per-model overlay is on iff at least one chip is enabled. */
  overlayOn: ComputedRef<boolean>;
  hasTruth: ComputedRef<boolean>;
  /** The single variable an overlay line is drawn for. Composite views resolve
   *  to their `overlayVar`. */
  activeVar: ComputedRef<DataVarId>;
  /** Models that returned data for at least one variable (the chip universe). */
  allModels: ComputedRef<ModelDef[]>;
  /** Whether a model has data for the *currently active* variable (drives the
   *  disabled/strikethrough chip state). */
  modelHasData: ComputedRef<Record<string, boolean>>;
  allModelsActive: ComputedRef<boolean>;
  isVarActive: (vid: ChartViewId) => boolean;
  selectView: (v: ChartViewId) => void;
  selectVariable: (vid: ChartViewId) => void;
  toggleAggregate: () => void;
  toggleBand: () => void;
  toggleTruth: () => void;
  toggleModel: (id: string) => void;
  toggleAllModels: () => void;
}

export function useChartControls(opts: ChartControlsOptions): ChartControls {
  // Forecast (no truth) opens on the combined temperature + precipitation view;
  // verify keeps per-variable views so each can show its own ERA5 truth line.
  const canCombineTempPrecip = !opts.data().truth && opts.variables.includes("temperature_2m") && opts.variables.includes("precipitation");
  const view = ref<ChartViewId>(canCombineTempPrecip ? "temp_precip" : (opts.variables[0] ?? "temperature_2m"));
  const hoursWindow = ref<number>(opts.defaultWindow);

  // Visibility toggles. Kept OUT of the chart option's reactive deps by the
  // component (no-redraw patches) — here they are plain state.
  const showAggregate = ref(true);
  const showBand = ref(true);
  const showTruth = ref(true);
  const enabledModels = ref<Set<string>>(new Set());

  /** The per-model overlay is on iff a chip is enabled — the single truth the
   *  showModels model and the snaps all read, so nothing can fall out of sync. */
  const overlayOn = computed(() => enabledModels.value.size > 0);

  const hasTruth = computed(() => !!opts.data().truth);

  const activeVar = computed<DataVarId>(() => CHART_VIEWS[view.value].overlayVar);

  function selectView(v: ChartViewId): void {
    // The reverse of the snap: picking the composite while the overlay is on
    // clears the enabled models (two fans on two axes is unreadable).
    if (v === "temp_precip" && overlayOn.value) enabledModels.value = new Set();
    view.value = v;
  }

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
  }

  const allModels = computed<ModelDef[]>(() => {
    const ids = new Set<string>();
    const perModel = opts.data().perModel;
    for (const vId of Object.keys(perModel) as DataVarId[]) {
      const byModel = perModel[vId] ?? {};
      for (const id of Object.keys(byModel)) if (byModel[id]?.some((x) => x != null)) ids.add(id);
    }
    return MODELS.filter((m) => ids.has(m.id));
  });

  const modelHasData = computed<Record<string, boolean>>(() => {
    const out: Record<string, boolean> = {};
    const byModel = opts.data().perModel[activeVar.value] ?? {};
    for (const m of allModels.value) out[m.id] = !!byModel[m.id]?.some((x) => x != null);
    return out;
  });

  // Reset enabled models whenever the chip universe changes (new data / run).
  // Default: nothing is enabled, so the chart starts clean (aggregate + band +
  // truth only). The user opts in to the per-model overlay via the chips.
  watch(
    () => allModels.value.map((m) => m.id).join(","),
    () => {
      enabledModels.value = new Set();
    },
    { immediate: true },
  );

  // The snap: enabling a model while the composite Temp+Precip view is selected
  // switches to Temperature, since the overlay needs a single variable (two
  // fans on two axes is unreadable).
  watch(
    overlayOn,
    (on) => {
      if (on && view.value === "temp_precip") view.value = "temperature_2m";
    },
    { immediate: true },
  );

  function toggleAggregate(): void {
    showAggregate.value = !showAggregate.value;
  }
  function toggleBand(): void {
    showBand.value = !showBand.value;
  }
  function toggleTruth(): void {
    showTruth.value = !showTruth.value;
  }
  function toggleModel(id: string): void {
    if (!modelHasData.value[id]) return;
    const next = new Set(enabledModels.value);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    enabledModels.value = next;
  }
  function selectAllModels(): void {
    enabledModels.value = new Set(allModels.value.filter((m) => modelHasData.value[m.id]).map((m) => m.id));
  }
  function selectNoModels(): void {
    enabledModels.value = new Set();
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

  return {
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
    selectView,
    selectVariable,
    toggleAggregate,
    toggleBand,
    toggleTruth,
    toggleModel,
    toggleAllModels,
  };
}
