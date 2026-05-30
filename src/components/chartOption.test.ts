import { describe, it, expect } from "vitest";

import type { HourlySeries } from "@/composables/hourlySeries";
import type { AggregatePoint } from "@/domain/aggregate";
import { getModel } from "@/domain/models";

import type { UnitPrefs } from "./chartHelpers";
import { buildHourlyChartOption, type HourlyChartOptionArgs } from "./chartOption";

type Series = { id?: string; type?: string; data?: unknown[]; yAxisIndex?: number; stack?: string; markLine?: unknown; markArea?: unknown };
type Axis = { min?: unknown; max?: unknown; show?: boolean };

const seriesOf = (args: HourlyChartOptionArgs): Series[] => (buildHourlyChartOption(args).series as Series[]) ?? [];
const byId = (args: HourlyChartOptionArgs, id: string): Series | undefined => seriesOf(args).find((s) => s.id === id);
const yAxis = (args: HourlyChartOptionArgs): Axis[] => buildHourlyChartOption(args).yAxis as Axis[];

const C: UnitPrefs = { temp: "c", precip: "mm", wind: "kmh" };

function pt(value: number, stdDev = 0): AggregatePoint {
  return { time: "", value, stdDev, weights: {}, perModel: {} };
}
function makeTimes(n: number, baseISO: string): string[] {
  const base = new Date(baseISO).getTime();
  return Array.from({ length: n }, (_, i) => new Date(base + i * 3_600_000).toISOString().slice(0, 16));
}

const DATA: HourlySeries = {
  times: makeTimes(5, "2026-05-20T00:00:00Z"),
  aggregate: {
    temperature_2m: [pt(10, 1), pt(11, 1), pt(12, 2), pt(13, 2), pt(14, 2)],
    precipitation: [pt(0), pt(1), pt(2), pt(0), pt(0)],
    cloud_cover: [pt(50), pt(60), pt(70), pt(80), pt(90)],
  },
  perModel: {
    temperature_2m: { ecmwf_ifs025: [10, 11, 12, 13, 14], gfs_global: [9, 10, 11, 12, 13] },
  },
};

const base: HourlyChartOptionArgs = { data: DATA, view: "temperature_2m", hoursWindow: 72, units: C, models: [], showModels: false };

describe("buildHourlyChartOption — unit conversion", () => {
  it("converts the aggregate line to the user's unit (°C → °F)", () => {
    const agg = byId({ ...base, units: { ...C, temp: "f" } }, "agg");
    // 10 °C → 50 °F, 14 °C → 57.2 °F
    expect(agg?.data?.[0]).toBeCloseTo(50, 5);
    expect(agg?.data?.[4]).toBeCloseTo(57.2, 5);
  });

  it("converts precipitation mm → in", () => {
    const agg = byId({ ...base, view: "precipitation", units: { ...C, precip: "in" } }, "agg");
    expect(agg?.data?.[2]).toBeCloseTo(2 / 25.4, 6);
  });
});

describe("buildHourlyChartOption — ±1σ band", () => {
  it("stacks a base (value−σ) and a delta (2σ) on the same stack group", () => {
    const lower = byId(base, "band-base");
    const delta = byId(base, "band-delta");
    expect(lower?.stack).toBe(delta?.stack);
    // index 2: value 12, stdDev 2 → base 10, delta 4
    expect(lower?.data?.[2]).toBeCloseTo(10, 5);
    expect(delta?.data?.[2]).toBeCloseTo(4, 5);
  });
});

describe("buildHourlyChartOption — composite Temp+Precip", () => {
  it("puts the temperature line on the left axis and precip bars (distinct id) on the right", () => {
    const args = { ...base, view: "temp_precip" as const };
    expect(byId(args, "agg")?.yAxisIndex).toBe(0);
    const precip = byId(args, "agg-precip");
    expect(precip?.type).toBe("bar");
    expect(precip?.yAxisIndex).toBe(1);
  });
});

describe("buildHourlyChartOption — axis pinning", () => {
  it("pins the left axis to 0..100 for percentage views and auto-scales otherwise", () => {
    const pct = yAxis({ ...base, view: "cloud_cover" })[0]!;
    expect(pct.min).toBe(0);
    expect(pct.max).toBe(100);
    const temp = yAxis(base)[0]!;
    // AUTO is null (not undefined) so a merged setOption clears a prior pin.
    expect(temp.min).toBeNull();
    expect(temp.max).toBeNull();
  });
});

describe("buildHourlyChartOption — spaghetti", () => {
  const models = [getModel("ecmwf_ifs025")!, getModel("gfs_global")!];
  it("builds one per-model series per available model when showModels is on", () => {
    const ids = seriesOf({ ...base, models, showModels: true })
      .map((s) => s.id)
      .filter((id): id is string => !!id?.startsWith("s-"));
    expect(ids.toSorted()).toEqual(["s-ecmwf_ifs025", "s-gfs_global"]);
  });
  it("builds no per-model series when showModels is off", () => {
    const ids = seriesOf({ ...base, models, showModels: false }).filter((s) => s.id?.startsWith("s-"));
    expect(ids).toHaveLength(0);
  });
});

describe("buildHourlyChartOption — truth", () => {
  it("draws a truth series only when the view-model carries truth", () => {
    expect(byId(base, "tr")).toBeUndefined();
    const withTruth: HourlySeries = { ...DATA, truth: { temperature_2m: [9, 10, 11, 12, 13] } };
    expect(byId({ ...base, data: withTruth }, "tr")).toBeDefined();
  });
});

describe("buildHourlyChartOption — window slicing", () => {
  it("clamps every series to the visible window", () => {
    const agg = byId({ ...base, hoursWindow: 2 }, "agg");
    expect(agg?.data).toHaveLength(2);
  });
});

describe("buildHourlyChartOption — night/now marks", () => {
  it("adds a night background series given solar, and a Now markLine given currentTime in-window", () => {
    const args: HourlyChartOptionArgs = {
      ...base,
      solar: { sunrise: ["2026-05-20T06:00"], sunset: ["2026-05-20T20:00"] },
      currentTime: DATA.times[1],
    };
    expect(byId(args, "night")?.markArea).toBeDefined();
    expect(byId(args, "agg")?.markLine).toBeDefined();
  });
});
