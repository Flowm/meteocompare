import { describe, it, expect } from "vitest";

import type { HistoricalWeatherResponse } from "@/api/omHistoricalWeather";
import type { SingleRunsResponse } from "@/api/omSingleRuns";
import { AGGREGATE_TUNED_ROW_ID } from "@/domain/scorecard";

import { evaluateRun } from "./runEvaluation";

const N = 24;
const times = Array.from({ length: N }, (_, i) => `2026-05-20T${String(i).padStart(2, "0")}:00`);
const flat = (v: number): number[] => Array.from({ length: N }, () => v);

const runs = {
  hourly: {
    time: times,
    temperature_2m_ecmwf_ifs: flat(10),
    precipitation_ecmwf_ifs: flat(0),
    temperature_2m_gfs_seamless: flat(12),
    precipitation_gfs_seamless: flat(0),
  },
  daily: {
    time: ["2026-05-20"],
    weather_code_ecmwf_ifs: [3],
    weather_code_gfs_seamless: [3],
  },
} as unknown as SingleRunsResponse;

const truth = {
  hourly: {
    time: times,
    temperature_2m: flat(11),
    precipitation: flat(0),
  },
} as unknown as HistoricalWeatherResponse;

describe("evaluateRun", () => {
  it("wires runs + truth into hourly, daily, scorecard, weather codes and availability", () => {
    const ev = evaluateRun({ runs, truth, lat: 48, lon: 11, runDate: "2026-05-20" });
    expect(ev).not.toBeNull();
    if (!ev) return;

    expect(ev.runDate).toBe("2026-05-20");
    expect(ev.runHour).toBe(0);
    expect(ev.hourly.times).toHaveLength(N);
    expect(ev.hourly.truth?.temperature_2m).toHaveLength(N);
    expect(ev.daily.length).toBeGreaterThanOrEqual(1);
    // Two per-model rows plus the aggregate ranked inline.
    expect(ev.scorecard.length).toBeGreaterThanOrEqual(2);
    expect(ev.availableModels.map((m) => m.id).toSorted()).toEqual(["ecmwf_ifs", "gfs_seamless"]);
    expect(ev.weatherCodes).toHaveLength(1);
  });

  it("returns null when the run carried no hours", () => {
    const empty = { hourly: { time: [] }, daily: { time: [] } } as unknown as SingleRunsResponse;
    expect(evaluateRun({ runs: empty, truth, lat: 48, lon: 11, runDate: "2026-05-20" })).toBeNull();
  });

  it("adds an Aggregate (tuned) scorecard row when tuned multipliers are supplied", () => {
    const ev = evaluateRun({ runs, truth, lat: 48, lon: 11, runDate: "2026-05-20", tunedMultipliers: { ecmwf_ifs: 2 } });
    expect(ev?.scorecard.some((r) => r.id === AGGREGATE_TUNED_ROW_ID)).toBe(true);
  });
});
