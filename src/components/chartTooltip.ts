// Axis-tooltip formatter for the unified hourly chart. Split out of
// HourlySeriesChart so the component is left holding state + wiring rather than
// 50 lines of HTML-string assembly. Pure given its context — the returned
// closure reads `liveState()` on each hover, so flipping a series toggle never
// becomes a reactive dep of the option compute (the chart's no-redraw trick).

import type { DataVarId, HourlySeries } from "@/composables/hourlySeries";
import { convertVar, type UnitPrefs } from "@/composables/useUnits";
import type { ModelDef } from "@/domain/models";

import { CHART_VIEWS, type ChartViewId } from "./chartHelpers";
import { paletteFor } from "./chartOption";
import { AGG_COLOR, PAPER_50, RAIN_300, STD_LABEL, TRUTH_COLOR } from "./chartTheme";

/** Toggle + cursor state read at hover time (never at option-compute time). */
export interface TooltipState {
  showAggregate: boolean;
  showBand: boolean;
  showTruth: boolean;
  enabledModels: ReadonlySet<string>;
  /** Cursor value on the overlay axis (active unit), or null off-grid. */
  cursorValue: number | null;
}

export interface TooltipContext {
  view: ChartViewId;
  /** Visible time axis, already sliced to the window. */
  times: string[];
  data: HourlySeries;
  units: UnitPrefs;
  /** Per-model overlay universe, in render order. */
  models: ModelDef[];
  /** Whether the per-model overlay is on (its rows are listed when so). */
  overlay: boolean;
  /** Variable→display-string formatter, owned by the component (unit prefs). */
  fmtVar: (dv: DataVarId, base: number | null | undefined) => string;
  liveState: () => TooltipState;
}

/** Build the axis-tooltip formatter. The returned closure is what ECharts
 *  calls per hover; everything it needs that doesn't change between hovers is
 *  captured here, and the live toggles come through `liveState()`. */
export function buildTooltipFormatter(ctx: TooltipContext): (params: unknown) => string {
  const { view: v, times, data, units, models, overlay, fmtVar, liveState } = ctx;
  const activeVar = CHART_VIEWS[v].overlayVar;
  const vars: DataVarId[] = CHART_VIEWS[v].vars;

  return (params: unknown): string => {
    const arr = params as Array<{ dataIndex: number }>;
    const idx = arr[0]?.dataIndex ?? -1;
    const timeStr = times[idx];
    if (idx < 0 || timeStr === undefined) return "";

    const { showAggregate, showBand, showTruth, enabledModels, cursorValue } = liveState();
    const header = new Date(timeStr).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" });
    const lines: string[] = [];

    for (const dv of vars) {
      const aggPt = data.aggregate[dv]?.[idx];
      if (showAggregate && aggPt && aggPt.value !== null) {
        // ±1σ shown whenever the spread is on — bars carry it as error-bar
        // whiskers, line views as the shaded band, but the tooltip reads alike.
        const std = showBand && Number.isFinite(aggPt.stdDev) ? ` <span style="color:${STD_LABEL}">± ${fmtVar(dv, aggPt.stdDev).replace(/[°a-zA-Z%/ ]+$/, "")}</span>` : "";
        const label = vars.length > 1 ? `${dv === "temperature_2m" ? "Temp" : "Precip"} ` : "Forecast ";
        // Rain-blue precip label — the rain-300 token, matching the precip bars.
        const color = dv === "precipitation" ? RAIN_300 : AGG_COLOR;
        lines.push(`<span style="color:${color}">${label}</span>${fmtVar(dv, aggPt.value)}${std}`);
      }
      const truthVal = data.truth?.[dv]?.[idx];
      if (showTruth && truthVal != null) lines.push(`<span style="color:${TRUTH_COLOR}">Truth</span> ${fmtVar(dv, truthVal)}`);
    }

    // Per-model values when the overlay is on (enabled models only). The model
    // whose value sits closest to the cursor is highlighted, so a busy fan of
    // lines can be read off against the tooltip.
    if (overlay) {
      const shown = models.filter((m) => enabledModels.has(m.id) && data.perModel[activeVar]?.[m.id]?.[idx] != null);
      let nearestId: string | null = null;
      if (cursorValue != null) {
        let best = Infinity;
        for (const m of shown) {
          const display = convertVar(data.perModel[activeVar]![m.id]![idx], activeVar, units);
          if (display == null) continue;
          const d = Math.abs(display - cursorValue);
          if (d < best) {
            best = d;
            nearestId = m.id;
          }
        }
      }
      for (const m of shown) {
        const val = data.perModel[activeVar]![m.id]![idx];
        const near = m.id === nearestId;
        const marker = near ? "▸ " : "&nbsp;&nbsp;";
        const label = `<span style="color:${paletteFor(m.id)}${near ? ";font-weight:700" : ""}">${marker}${m.label}</span>`;
        const value = near ? `<span style="color:${PAPER_50};font-weight:700">${fmtVar(activeVar, val)}</span>` : fmtVar(activeVar, val);
        lines.push(`${label} ${value}`);
      }
    }
    return `<div style="font-weight:600;margin-bottom:4px">${header}</div>${lines.join("<br/>")}`;
  };
}
