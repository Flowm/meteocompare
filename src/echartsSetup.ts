import { LineChart, BarChart, CustomChart } from "echarts/charts";
import { GridComponent, TooltipComponent, LegendComponent, MarkAreaComponent, MarkLineComponent, TitleComponent, DataZoomComponent } from "echarts/components";
import { use } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";

/** Register the echarts modules we actually use. Called once from main.ts.
 *  Splitting this from a top-level side-effect import makes the dependency
 *  explicit and keeps oxlint's import/no-unassigned-import happy. */
export function setupECharts(): void {
  use([
    CanvasRenderer,
    LineChart,
    BarChart,
    CustomChart,
    GridComponent,
    TooltipComponent,
    LegendComponent,
    MarkAreaComponent,
    MarkLineComponent,
    TitleComponent,
    DataZoomComponent,
  ]);
}
