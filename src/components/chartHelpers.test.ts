import { describe, expect, it } from "vitest";

import { extractSolar, type HistoricalWeatherResponse } from "@/api/omHistoricalWeather";
import { shiftIsoTime } from "@/utils/date";

import { buildNightRanges, isVarActive, nextCombinableView } from "./chartHelpers";

describe("nextCombinableView", () => {
  it("adds the second variable to form the composite", () => {
    expect(nextCombinableView("temperature_2m", "precipitation")).toBe("temp_precip");
    expect(nextCombinableView("precipitation", "temperature_2m")).toBe("temp_precip");
  });

  it("toggling one half of the composite drops back to the other single view", () => {
    expect(nextCombinableView("temp_precip", "precipitation")).toBe("temperature_2m");
    expect(nextCombinableView("temp_precip", "temperature_2m")).toBe("precipitation");
  });

  it("toggling off the last remaining variable is a no-op (never empties)", () => {
    expect(nextCombinableView("temperature_2m", "temperature_2m")).toBe("temperature_2m");
    expect(nextCombinableView("precipitation", "precipitation")).toBe("precipitation");
  });

  it("focuses the click when coming from an exclusive view", () => {
    expect(nextCombinableView("wind_speed_10m", "temperature_2m")).toBe("temperature_2m");
    expect(nextCombinableView("cloud_cover", "precipitation")).toBe("precipitation");
  });
});

describe("isVarActive", () => {
  it("treats either half of the composite as active when combinable", () => {
    expect(isVarActive("temp_precip", "temperature_2m", true)).toBe(true);
    expect(isVarActive("temp_precip", "precipitation", true)).toBe(true);
    expect(isVarActive("temperature_2m", "temperature_2m", true)).toBe(true);
    expect(isVarActive("temperature_2m", "precipitation", true)).toBe(false);
  });

  it("falls back to exact-match when not combinable", () => {
    expect(isVarActive("temperature_2m", "temperature_2m", false)).toBe(true);
    expect(isVarActive("temp_precip", "temperature_2m", false)).toBe(false);
  });

  it("matches exclusive views exactly regardless of combinability", () => {
    expect(isVarActive("wind_speed_10m", "wind_speed_10m", true)).toBe(true);
    expect(isVarActive("wind_speed_10m", "cloud_cover", true)).toBe(false);
  });
});

describe("night ranges from UTC archive solar data", () => {
  // Solar events from the public archive for June 15–18, 2026. The API preserves
  // previous/next UTC dates instead of wrapping every event into daily.time.
  const cases = [
    {
      name: "New York",
      offset: -14400,
      rise: "2026-06-15T09:24",
      set: "2026-06-16T00:28",
      expected: [
        [0, 9],
        [24, 33],
        [48, 57],
      ],
    },
    {
      name: "Tokyo",
      offset: 32400,
      rise: "2026-06-14T19:24",
      set: "2026-06-15T09:58",
      expected: [
        [10, 19],
        [34, 43],
        [58, 67],
      ],
    },
    {
      name: "Sydney",
      offset: 36000,
      rise: "2026-06-14T20:58",
      set: "2026-06-15T06:52",
      expected: [
        [7, 21],
        [31, 45],
        [55, 69],
      ],
    },
  ];
  it.each(cases)("pairs sunset with the following sunrise in $name", ({ offset, rise, set, expected }) => {
    const response = {
      utc_offset_seconds: 0,
      daily: {
        sunrise: Array.from({ length: 4 }, (_, i) => shiftIsoTime(rise, i * 86400)),
        sunset: Array.from({ length: 4 }, (_, i) => shiftIsoTime(set, i * 86400)),
      },
    } as unknown as HistoricalWeatherResponse;
    const solar = extractSolar(response, offset)!;
    const times = Array.from({ length: 72 }, (_, i) => shiftIsoTime("2026-06-15T00:00", offset + i * 3600));
    expect(buildNightRanges(times, solar.sunrise, solar.sunset)).toEqual(expected);
  });
  it("clips nights at both visible window boundaries", () => {
    const times = Array.from({ length: 24 }, (_, i) => shiftIsoTime("2026-06-15T12:00", i * 3600));
    expect(buildNightRanges(times, ["2026-06-14T19:24", "2026-06-15T19:24", "2026-06-16T19:24"], ["2026-06-15T09:58", "2026-06-16T09:58", "2026-06-17T09:58"])).toEqual([
      [0, 7],
      [22, 23],
    ]);
  });
});
