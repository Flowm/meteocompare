import { describe, it, expect } from "vitest";

import { MODEL_IDS } from "@/domain/models";

import { extractHourlyByModel, extractDailyByModel, FETCH_MODEL_IDS, type ForecastResponse } from "./omForecast";

function makeResponse(hourly: Record<string, (number | null)[]>, daily: Record<string, (number | null)[]> = {}): ForecastResponse {
  return {
    latitude: 48.2,
    longitude: 16.4,
    elevation: 0,
    generationtime_ms: 0,
    utc_offset_seconds: 0,
    timezone: "auto",
    timezone_abbreviation: "UTC",
    hourly: { time: ["2026-01-01T00:00", "2026-01-01T01:00"], ...hourly } as ForecastResponse["hourly"],
    hourly_units: {},
    daily: { time: ["2026-01-01"], ...daily } as ForecastResponse["daily"],
    daily_units: {},
    current: { time: "2026-01-01T00:00", interval: 3600 } as ForecastResponse["current"],
    current_units: {},
  };
}

describe("FETCH_MODEL_IDS", () => {
  it("adds icon_seamless as a fetch-only source, not an aggregation vote", () => {
    expect(MODEL_IDS).not.toContain("icon_seamless");
    expect(FETCH_MODEL_IDS).toContain("icon_seamless");
    for (const id of MODEL_IDS) expect(FETCH_MODEL_IDS).toContain(id);
  });
});

describe("extractHourlyByModel probability source override", () => {
  it("reads icon_global precipitation_probability from the icon_seamless series", () => {
    const resp = makeResponse({
      precipitation_probability_icon_global: [null, null], // deterministic → all-null
      precipitation_probability_icon_seamless: [40, 60], // ensemble-backed
    });
    const out = extractHourlyByModel(resp, "precipitation_probability", MODEL_IDS);
    expect(out.icon_global).toEqual([40, 60]);
    expect(out).not.toHaveProperty("icon_seamless");
  });

  it("does not redirect non-probability variables", () => {
    const resp = makeResponse({
      temperature_2m_icon_global: [5, 6],
      temperature_2m_icon_seamless: [99, 99],
    });
    const out = extractHourlyByModel(resp, "temperature_2m", MODEL_IDS);
    expect(out.icon_global).toEqual([5, 6]);
  });
});

describe("extractDailyByModel probability source override", () => {
  it("maps precipitation_probability_max from icon_seamless onto icon_global", () => {
    const resp = makeResponse(
      {},
      {
        precipitation_probability_max_icon_global: [null],
        precipitation_probability_max_icon_seamless: [70],
      },
    );
    const out = extractDailyByModel(resp, "precipitation_probability_max", MODEL_IDS);
    expect(out.icon_global).toEqual([70]);
  });
});
