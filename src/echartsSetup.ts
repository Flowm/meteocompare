import { LineChart, BarChart } from "echarts/charts";
import { GridComponent, TooltipComponent, MarkAreaComponent, MarkLineComponent } from "echarts/components";
import { use } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";

/** Register the echarts modules we actually use. Called once from main.ts.
 *  Splitting this from a top-level side-effect import makes the dependency
 *  explicit and keeps oxlint's import/no-unassigned-import happy.
 *
 *  Only the components the option builder actually emits: grid + tooltip, and
 *  the markArea (night shading) / markLine (the "Now" marker) internals. The
 *  legend is hand-built HTML and the title is a plain <h2>, so no Legend/Title
 *  component is needed; there's no dataZoom either. */
export function setupECharts(): void {
  use([CanvasRenderer, LineChart, BarChart, GridComponent, TooltipComponent, MarkAreaComponent, MarkLineComponent]);
}
