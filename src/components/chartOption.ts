// Pure ECharts option builder for the unified hourly series chart. Everything
// here is a deterministic function of its inputs — no Vue reactivity, no DOM —
// so it can be unit-tested against the returned option object without mounting
// the component. The component (HourlySeriesChart.vue) owns interaction state
// and attaches the tooltip.formatter, which reads live toggle state at hover
// time (the no-redraw trick) and therefore cannot be pure.

import type { EChartsOption } from "echarts";

import type { DataVarId, HourlySeries } from "@/composables/hourlySeries";
import { MODELS } from "@/domain/models";
import type { ModelDef } from "@/domain/models";

import { buildNightRanges, convertDelta, convertVar, findNowIndex, unitLabel, type ChartViewId, type UnitPrefs } from "./chartHelpers";

// ---- Colours ----------------------------------------------------------------
// "Observatory" palette: coral = aggregate forecast, sodium amber = truth
// (ERA5 reference), oxidized teal for cool data, and a model palette drawn from
// the same warm-cool spectrum rather than the default Tailwind hues.
export const AGG_COLOR = "#e8826b"; // coral — aggregate forecast
export const TRUTH_COLOR = "#f5b942"; // sodium amber — ERA5-Seamless truth
export const BAND_SWATCH = "rgba(232, 130, 107, 0.45)"; // more visible coral for the legend chip
const PRECIP_BAR_COLOR = "rgba(127, 184, 224, 0.65)"; // dusty rain blue
const PRECIP_ERR_COLOR = "rgba(200, 226, 247, 0.9)"; // brighter rain blue — ±1σ whiskers
const BAND_FILL = "rgba(232, 130, 107, 0.16)"; // coral, low alpha — ±1σ band
const TRUTH_AREA = "rgba(245, 185, 66, 0.12)"; // sodium, low alpha — precip truth fill
const NIGHT_FILL = "rgba(120, 140, 200, 0.12)"; // cool marine wash — reads as night against the warm theme
const MODEL_PALETTE = ["#6dc6c2", "#9bb87a", "#bfa9d6", "#f0a285", "#7fb8e0", "#d99a1e", "#e8826b", "#9ddad6", "#c7b69a", "#a8c182", "#b88c8c"];
export const MODEL_OPACITY = 0.55;

// ECharts reads `null` as "auto-scale this axis", but its TS types only allow
// number | string | undefined. We need the literal null (not undefined) so a
// merged setOption actually clears a previously-pinned min/max — hence the cast.
const AUTO = null as unknown as undefined;

/** Stable colour for a model, keyed by its index in the registry so the same
 *  model always reads the same hue across renders. */
export function paletteFor(id: string): string {
  const i = MODELS.findIndex((m) => m.id === id);
  return MODEL_PALETTE[(i < 0 ? 0 : i) % MODEL_PALETTE.length]!;
}

// ---- Series visibility ------------------------------------------------------
// Visibility is applied as a no-redraw merge-patch (opacity only) rather than by
// rebuilding the option, so toggling a chip never triggers a full redraw. The
// builder emits one VisibilityToggle per toggleable series *as it creates it*,
// so the fact that (e.g.) precipitation truth carries an areaStyle fill is
// declared exactly once, next to where that series is built — the component
// never re-derives per-series style structure.

/** ECharts style props that carry a series' opacity. Fills (areaStyle) keep
 *  their alpha in the fill *colour*, so "shown" is opacity 1, not the alpha. */
export type TogglePropKey = "lineStyle" | "itemStyle" | "areaStyle";

export interface VisibilityToggle {
  /** Logical group, keys the show/hide decision against VisibilityState. */
  group: "aggregate" | "band" | "truth" | "model";
  /** Series id in the built option. */
  id: string;
  /** Style props whose opacity this toggle drives. */
  props: TogglePropKey[];
  /** Opacity when shown (1 for lines/fills, MODEL_OPACITY for spaghetti). */
  shown: number;
  /** For `group: "model"` — the model id, checked against enabledModels. */
  modelId?: string;
}

export interface VisibilityState {
  showAggregate: boolean;
  showBand: boolean;
  showTruth: boolean;
  enabledModels: Set<string>;
}

export interface SeriesPatch {
  id: string;
  lineStyle?: { opacity: number };
  itemStyle?: { opacity: number };
  areaStyle?: { opacity: number };
}

function isShown(t: VisibilityToggle, s: VisibilityState): boolean {
  switch (t.group) {
    case "aggregate":
      return s.showAggregate;
    case "band":
      return s.showBand;
    case "truth":
      return s.showTruth;
    case "model":
      return t.modelId != null && s.enabledModels.has(t.modelId);
  }
}

/** Pure map from (toggles, state) → the merge-patches to feed setOption. Every
 *  toggle id is a series the builder actually created, so the patches are always
 *  in sync with the current option. */
export function visibilityPatches(toggles: VisibilityToggle[], state: VisibilityState): SeriesPatch[] {
  return toggles.map((t) => {
    const opacity = isShown(t, state) ? t.shown : 0;
    const patch: SeriesPatch = { id: t.id };
    for (const prop of t.props) patch[prop] = { opacity };
    return patch;
  });
}

export interface HourlyChartBuild {
  option: EChartsOption;
  /** Visibility descriptors for the toggleable series in `option`. */
  toggles: VisibilityToggle[];
}

export interface HourlyChartOptionArgs {
  /** The unified hourly view-model (aggregate / perModel / optional truth). */
  data: HourlySeries;
  /** Selected variable view. */
  view: ChartViewId;
  /** Visible window in hours (clamped to the available time axis). */
  hoursWindow: number;
  /** User unit preferences (drives value conversion + axis labels). */
  units: UnitPrefs;
  /** Sunrise/sunset for day/night shading. */
  solar?: { sunrise: string[]; sunset: string[] } | null;
  /** Current local time — drives the "Now" marker (hidden outside the window). */
  currentTime?: string;
  /** Models with data (the spaghetti universe), in render order. */
  models: ModelDef[];
  /** Whether per-model spaghetti series are built (visibility is patched
   *  separately by the component, so the series exist at constant opacity). */
  showModels: boolean;
}

/** Build the chart's option plus its visibility descriptors. Everything except
 *  `tooltip.formatter` is produced here; the component attaches the formatter so
 *  it can read live toggle state at hover. */
export function buildHourlyChartOption(args: HourlyChartOptionArgs): HourlyChartBuild {
  const { data, view: v, units, solar, currentTime, models, showModels: spaghetti } = args;
  const n = Math.min(args.hoursWindow, data.times.length);
  const times = data.times.slice(0, n);
  const nowIdx = currentTime ? findNowIndex(times, currentTime) : -1;
  const nightRanges = buildNightRanges(times, solar?.sunrise, solar?.sunset);
  const toggles: VisibilityToggle[] = [];

  const labels = times.map((t) => {
    const d = new Date(t);
    return d.getHours() === 0 ? d.toLocaleDateString([], { weekday: "short" }) : `${d.getHours().toString().padStart(2, "0")}:00`;
  });

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

  // Night shading lives on its own zero-z background series so it always sits
  // *behind* the spread band and lines (it used to ride the band-base series,
  // which drew it on top of the spread).
  if (markArea) {
    series.push({
      id: "night",
      type: "line",
      yAxisIndex: 0,
      data: Array.from({ length: n }, () => null),
      symbol: "none",
      lineStyle: { opacity: 0 },
      silent: true,
      z: 0,
      tooltip: { show: false },
      markArea,
    });
  }

  // --- helper: push an aggregate line + band for a line variable -------------
  const pushLineAggregate = (dv: DataVarId, axisIndex: number, attachMarks: boolean): void => {
    const pts = (data.aggregate[dv] ?? []).slice(0, n);
    const values = pts.map((p) => convertVar(p.value, dv, units));
    const smooth = dv === "temperature_2m";

    // Band (±1σ). Always built — even in spaghetti mode — so the spread can be
    // toggled independently and stays visible behind the per-model lines.
    const lower = pts.map((p) => convertVar(p.value - p.stdDev, dv, units));
    const delta = pts.map((p) => (Number.isFinite(p.stdDev) ? convertDelta(p.stdDev * 2, dv, units) : 0));
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
      z: 1,
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
      z: 1,
    });

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
      ...(attachMarks && markLine ? { markLine } : {}),
    });

    // ±1σ band toggles via its fill; the line via line+marker opacity.
    toggles.push({ group: "band", id: "band-delta", props: ["areaStyle"], shown: 1 });
    toggles.push({ group: "aggregate", id: "agg", props: ["lineStyle", "itemStyle"], shown: 1 });
  };

  // --- helper: push precipitation (bars + optional truth) --------------------
  // `id` lets the composite Temp+Precip view give its precip bars a distinct id
  // ("agg-precip") so they don't collide with the temperature line's "agg".
  const pushPrecip = (axisIndex: number, attachMarks: boolean, id = "agg"): void => {
    const pts = (data.aggregate.precipitation ?? []).slice(0, n);
    const values = pts.map((p) => convertVar(p.value, "precipitation", units));
    series.push({
      id,
      name: "Aggregate forecast",
      type: "bar",
      yAxisIndex: axisIndex,
      data: values,
      itemStyle: { color: PRECIP_BAR_COLOR },
      barWidth: "60%",
      z: 2,
      ...(attachMarks && markLine ? { markLine } : {}),
    });
    // Only the primary "agg" bars answer to the Aggregate chip; the composite
    // view's "agg-precip" bars are intentionally not toggleable.
    if (id === "agg") toggles.push({ group: "aggregate", id, props: ["lineStyle", "itemStyle"], shown: 1 });

    // ±1σ spread. The line views draw a shaded band, but a band over discrete
    // bars reads poorly — so precipitation gets error-bar whiskers instead,
    // governed by the same "Spread ±1σ" chip (the `band` group). Lower whisker
    // is clamped at 0 (precip can't be negative); zero-spread bars draw nothing.
    const errData = pts.map((p, i) => {
      const value = convertVar(p.value, "precipitation", units) ?? 0;
      const sigma = Number.isFinite(p.stdDev) ? convertDelta(p.stdDev, "precipitation", units) : 0;
      return [i, Math.max(0, value - sigma), value + sigma, sigma];
    });
    series.push({
      id: `${id}-err`,
      name: "Spread ±1σ",
      type: "custom",
      yAxisIndex: axisIndex,
      data: errData,
      itemStyle: { opacity: 1 },
      silent: true,
      tooltip: { show: false },
      z: 6,
      renderItem: (_params, api) => {
        const sigma = api.value(3) as number;
        if (!(sigma > 0)) return { type: "group", children: [] };
        const xi = api.value(0);
        const low = api.coord([xi, api.value(1)]) as number[];
        const high = api.coord([xi, api.value(2)]) as number[];
        const cap = Math.max(2, (api.size!([1, 0]) as number[])[0]! * 0.18);
        const opacity = (api.style().opacity as number | undefined) ?? 1;
        const seg = (x1: number, y1: number, x2: number, y2: number) => ({
          type: "line" as const,
          shape: { x1, y1, x2, y2 },
          style: { stroke: PRECIP_ERR_COLOR, lineWidth: 1.3, opacity },
          silent: true,
        });
        return {
          type: "group",
          children: [
            seg(high[0]!, high[1]!, low[0]!, low[1]!), // whisker
            seg(high[0]! - cap, high[1]!, high[0]! + cap, high[1]!), // top cap
            seg(low[0]! - cap, low[1]!, low[0]! + cap, low[1]!), // bottom cap
          ],
        };
      },
    });
    toggles.push({ group: "band", id: `${id}-err`, props: ["itemStyle"], shown: 1 });
    const truth = data.truth?.precipitation;
    if (truth) {
      series.push({
        id: "tr",
        name: "Truth",
        type: "line",
        yAxisIndex: axisIndex,
        data: truth.slice(0, n).map((x) => convertVar(x, "precipitation", units)),
        step: "middle",
        symbol: "none",
        lineStyle: { width: 2, color: TRUTH_COLOR },
        areaStyle: { color: TRUTH_AREA },
        z: 2,
      });
      // Precip truth carries an area fill — declared here, once.
      toggles.push({ group: "truth", id: "tr", props: ["lineStyle", "itemStyle", "areaStyle"], shown: 1 });
    }
  };

  // --- helper: push truth line for a line variable ---------------------------
  const pushLineTruth = (dv: DataVarId, axisIndex: number): void => {
    const truth = data.truth?.[dv];
    if (!truth) return;
    series.push({
      id: "tr",
      name: "Truth",
      type: "line",
      yAxisIndex: axisIndex,
      data: truth.slice(0, n).map((x) => convertVar(x, dv, units)),
      smooth: false,
      symbol: "none",
      lineStyle: { width: 3, color: TRUTH_COLOR },
      z: 6,
    });
    // Line truth has no area fill (unlike precip truth).
    toggles.push({ group: "truth", id: "tr", props: ["lineStyle", "itemStyle"], shown: 1 });
  };

  // --- helper: push per-model spaghetti for a line variable ------------------
  const pushSpaghetti = (dv: DataVarId, axisIndex: number): void => {
    const byModel = data.perModel[dv] ?? {};
    for (const m of models) {
      const arr = byModel[m.id];
      if (!arr) continue;
      // Built at a constant opacity; visibility is applied via merge-patch so
      // toggling a chip never triggers a full redraw.
      series.push({
        id: `s-${m.id}`,
        name: m.label,
        type: "line",
        yAxisIndex: axisIndex,
        data: arr.slice(0, n).map((x) => convertVar(x, dv, units)),
        smooth: dv === "temperature_2m",
        symbol: "none",
        lineStyle: { width: 1, color: paletteFor(m.id), opacity: MODEL_OPACITY },
        z: 3,
      });
      toggles.push({ group: "model", id: `s-${m.id}`, modelId: m.id, props: ["lineStyle"], shown: MODEL_OPACITY });
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
  const leftUnit = leftVar ? unitLabel(leftVar, units) : "";
  // Hourly precip is the sum over the preceding hour — a rate — so the chart
  // axis reads "mm/h" (vs. the bare "mm" used for daily totals elsewhere).
  const precipUnit = `${unitLabel("precipitation", units)}/h`;
  const interval = args.hoursWindow <= 24 ? 2 : args.hoursWindow <= 72 ? 11 : 23;

  // Floor the precipitation axis at 8 mm/h (converted to the active unit) so a
  // few tenths of a millimetre don't fill the panel and read as heavy rain.
  // The axis still grows past the floor when the data genuinely exceeds it.
  const precipFloor = convertVar(8, "precipitation", units) ?? 8;
  const precipMax = ((value: { max: number }) => Math.max(precipFloor, value.max)) as unknown as number;

  const option: EChartsOption = {
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
      // formatter is attached by the component (reads live toggle state at hover).
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
        // Percentage views (precip prob / cloud cover) lock to 0..100; every
        // other view auto-scales. These MUST be set explicitly (AUTO = null =
        // auto) rather than omitted — vue-echarts merges options, so an omitted
        // min/max would leave the 0..100 from a prior pct view stuck in place.
        min: leftIsPct ? 0 : AUTO,
        max: leftIsPct ? 100 : AUTO,
      },
      {
        // Right axis (precipitation).
        type: "value",
        name: precipUnit,
        nameTextStyle: { color: "#93896f", fontSize: 10 },
        position: "right",
        min: 0,
        max: precipMax,
        axisLine: { show: false },
        axisLabel: { color: "#93896f", fontSize: 10 },
        splitLine: { lineStyle: { color: "#131d2d", type: "dashed" }, show: rightActive && !leftVar },
        show: rightActive,
      },
    ],
    series,
  };

  return { option, toggles };
}
