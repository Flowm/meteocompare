import { onBeforeUnmount, ref, watch, type Ref } from "vue";

/** The slice of the ECharts instance the cursor reads. Kept structural rather
 *  than importing `ECharts` so the composable doesn't couple to echarts' type
 *  identity (its instance type carries private members that don't survive a
 *  cross-module boundary cleanly). */
export interface CursorChart {
  getZr(): {
    on(eventName: string, handler: (e: { offsetX: number; offsetY: number }) => void): void;
    off(eventName: string, handler: (e: { offsetX: number; offsetY: number }) => void): void;
  };
  containPixel(finder: string, value: number[]): boolean;
  convertFromPixel(finder: { yAxisIndex: number }, value: number): unknown;
}

/** Tracks the cursor's value on one y-axis of an ECharts instance.
 *
 *  The axis-tooltip formatter gets no pointer position, so with many model lines
 *  enabled it can't tell which tooltip row maps to which line. Reading the
 *  cursor value off the overlay axis (in the active unit, matching the converted
 *  line data) lets it highlight the nearest entry. `null` off the plot grid. */
export function useChartCursor(getChart: () => CursorChart | undefined, axisIndex: Ref<number>): { cursorValue: Ref<number | null> } {
  const cursorValue = ref<number | null>(null);
  let detach: (() => void) | null = null;

  watch(
    getChart,
    (chart) => {
      detach?.();
      detach = null;
      if (!chart) return;
      const zr = chart.getZr();
      const onMove = (e: { offsetX: number; offsetY: number }): void => {
        if (!chart.containPixel("grid", [e.offsetX, e.offsetY])) {
          cursorValue.value = null;
          return;
        }
        const v = chart.convertFromPixel({ yAxisIndex: axisIndex.value }, e.offsetY);
        cursorValue.value = typeof v === "number" ? v : null;
      };
      const onOut = (): void => {
        cursorValue.value = null;
      };
      zr.on("mousemove", onMove);
      zr.on("globalout", onOut);
      detach = (): void => {
        zr.off("mousemove", onMove);
        zr.off("globalout", onOut);
      };
    },
    { immediate: true },
  );

  onBeforeUnmount(() => detach?.());

  return { cursorValue };
}
