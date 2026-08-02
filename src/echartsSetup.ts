import { LineChart, BarChart } from "echarts/charts";
import { GridComponent, TooltipComponent, MarkAreaComponent, MarkLineComponent } from "echarts/components";
import { use } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";

/** Register the echarts modules the option builder actually emits. Called once
 *  from main.ts — a function rather than a top-level side-effect import, which
 *  keeps the dependency explicit and oxlint's import/no-unassigned-import quiet.
 *
 *  No Legend or Title component: the legend is hand-built HTML and the title a
 *  plain <h2>. No dataZoom either. */
export function setupECharts(): void {
  use([CanvasRenderer, LineChart, BarChart, GridComponent, TooltipComponent, MarkAreaComponent, MarkLineComponent]);
}
