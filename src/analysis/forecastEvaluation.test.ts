import { describe, it, expect } from "vitest";

import { DAILY_VARS, HOURLY_VARS, type ForecastResponse } from "@/api/omForecast";

import { dailyOverallPredictability, evaluateForecast } from "./forecastEvaluation";

const N = 24;
const hourlyTimes = Array.from({ length: N }, (_, i) => `2026-05-20T${String(i).padStart(2, "0")}:00`);
const flat = (v: number): number[] => Array.from({ length: N }, () => v);

/** A minimal two-model response: every hourly + daily variable present for
 *  ecmwf_ifs and gfs_seamless, plus the current block the banner renders. */
function makeResponse(): ForecastResponse {
  const hourly: Record<string, number[] | string[]> = { time: hourlyTimes };
  for (const v of HOURLY_VARS) {
    hourly[`${v}_ecmwf_ifs`] = flat(10);
    hourly[`${v}_gfs_seamless`] = flat(12);
  }
  const daily: Record<string, number[] | string[]> = { time: ["2026-05-20", "2026-05-21"] };
  for (const v of DAILY_VARS) {
    daily[`${v}_ecmwf_ifs`] = [10, 10];
    daily[`${v}_gfs_seamless`] = [12, 12];
  }
  daily.sunrise_ecmwf_ifs = ["2026-05-20T05:30", "2026-05-21T05:29"];
  daily.sunset_ecmwf_ifs = ["2026-05-20T20:45", "2026-05-21T20:46"];
  return {
    hourly,
    daily,
    current: { time: "2026-05-20T09:00", interval: 3600, temperature_2m: 11.4, weather_code: 3, is_day: 1 },
  } as unknown as ForecastResponse;
}

describe("evaluateForecast", () => {
  it("aggregates every hourly and daily variable and carries perModel through", () => {
    const ev = evaluateForecast({ raw: makeResponse(), lat: 48, lon: 11 });
    expect(ev).not.toBeNull();
    if (!ev) return;

    expect(ev.hourly.times).toHaveLength(N);
    for (const v of HOURLY_VARS) {
      expect(ev.hourly.aggregate[v]).toHaveLength(N);
      expect(ev.hourly.predictability[v]).toHaveLength(N);
      expect(Object.keys(ev.hourly.perModel[v]).toSorted()).toEqual(["ecmwf_ifs", "gfs_seamless"]);
    }
    expect(ev.daily.times).toHaveLength(2);
    for (const v of DAILY_VARS) expect(ev.daily.aggregate[v]).toHaveLength(2);
  });

  it("returns null when a time axis is empty", () => {
    const noHours = makeResponse();
    noHours.hourly.time = [];
    expect(evaluateForecast({ raw: noHours, lat: 48, lon: 11 })).toBeNull();

    const noDays = makeResponse();
    noDays.daily.time = [];
    expect(evaluateForecast({ raw: noDays, lat: 48, lon: 11 })).toBeNull();
  });

  it("applies trained-weight multipliers to the aggregate (ADR 0007)", () => {
    const def = evaluateForecast({ raw: makeResponse(), lat: 48, lon: 11 });
    const tuned = evaluateForecast({ raw: makeResponse(), lat: 48, lon: 11, multipliers: { ecmwf_ifs: 5 } });
    // Up-weighting the cooler ecmwf (10 vs gfs 12) pulls the blend down.
    const defVal = def?.hourly.aggregate.temperature_2m[0]?.value ?? NaN;
    const tunedVal = tuned?.hourly.aggregate.temperature_2m[0]?.value ?? NaN;
    expect(tunedVal).toBeLessThan(defVal);
  });

  it("exposes the current-conditions view-model instead of the wire shape", () => {
    const ev = evaluateForecast({ raw: makeResponse(), lat: 48, lon: 11 });
    expect(ev?.current).toEqual({ time: "2026-05-20T09:00", temperature_2m: 11.4, weather_code: 3, isDay: true });
  });

  it("picks the per-model solar columns for the day/night shading", () => {
    const ev = evaluateForecast({ raw: makeResponse(), lat: 48, lon: 11 });
    expect(ev?.solar?.sunrise[0]).toBe("2026-05-20T05:30");
  });
});

describe("dailyOverallPredictability", () => {
  it("collapses temperature, precipitation and weather-code predictability for one day", () => {
    const ev = evaluateForecast({ raw: makeResponse(), lat: 48, lon: 11 });
    expect(ev).not.toBeNull();
    if (!ev) return;
    const collapsed = dailyOverallPredictability(ev.daily, 0);
    expect(collapsed).toBeGreaterThanOrEqual(0);
    expect(collapsed).toBeLessThanOrEqual(1);
  });
});
