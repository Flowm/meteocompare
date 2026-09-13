// @vitest-environment node
import { init, type SeriesModel } from "echarts";
import { describe, expect, it } from "vitest";

import { convertVar } from "@/composables/useUnits";
import { aggPoint } from "@/test/fixtures";

import { buildHourlyChartOption } from "./chartOption";
import { buildTooltipFormatter } from "./chartTooltip";

const units = { temp: "c", precip: "mm", wind: "kmh" } as const;
const times = ["2026-06-01T00:00", "2026-06-01T01:00", "2026-06-01T02:00"];
const data = { times, aggregate: { temperature_2m: [-5, 0, 5].map((v) => aggPoint(v, { stdDev: 2 })) }, perModel: {} };

describe("temperature spread", () => {
  it("renders the upper edge at mean plus sigma below and across zero", () => {
    const { option } = buildHourlyChartOption({ data, units, view: "temperature_2m", hoursWindow: 24, models: [], showModels: false });
    const chart = init(null, undefined, { renderer: "svg", ssr: true, width: 600, height: 300 });
    try {
      chart.setOption({ ...option, animation: false });
      const model = (chart as unknown as { getModel(): { getSeries(): SeriesModel[] } }).getModel();
      const spread = model
        .getSeries()
        .find((s) => s.id === "band-delta")!
        .getData();
      const dimension = spread.getCalculationInfo("stackResultDimension") as string;
      expect(times.map((_, i) => spread.get(dimension, i))).toEqual([-3, 2, 7]);
    } finally {
      chart.dispose();
    }
  });

  it("converts Fahrenheit uncertainty as a difference without adding 32", () => {
    const fahrenheit = { ...units, temp: "f" } as const;
    const formatter = buildTooltipFormatter({
      data,
      times,
      units: fahrenheit,
      view: "temperature_2m",
      models: [],
      overlay: false,
      fmtVar: (v, n) => `${convertVar(n, v, fahrenheit)?.toFixed(1)}°F`,
      liveState: () => ({ showAggregate: true, showBand: true, showTruth: false, enabledModels: new Set(), cursorValue: null }),
    });
    const html = formatter([{ dataIndex: 1 }]);
    expect(html).toContain("32.0°F");
    expect(html).toContain("± 3.6");
    expect(html).not.toContain("± 35.6");
  });
});
