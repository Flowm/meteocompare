import { afterEach, describe, it, expect, vi } from "vitest";

import { MODEL_IDS } from "@/domain/models";
import { fakeResponse } from "@/test/fixtures";

import { extractHourlyByModel, extractDailyByModel, fetchForecast, FETCH_MODEL_IDS, type ForecastResponse } from "./omForecast";

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

afterEach(() => vi.unstubAllGlobals());

/** Stub fetch to capture the requested URL, returning a trivial 200 body. */
function captureUrl(): { urlOf: () => URL } {
  const mock = vi.fn().mockResolvedValue(fakeResponse({ status: 200, body: "{}" }));
  vi.stubGlobal("fetch", mock);
  return { urlOf: () => new URL(mock.mock.calls[0]?.[0] as string) };
}

describe("fetchForecast URL assembly", () => {
  it("defaults models to the full fetch set — the registry plus the icon_seamless graft source", async () => {
    const { urlOf } = captureUrl();
    await fetchForecast({ lat: 48.2, lon: 16.4 });
    const models = (urlOf().searchParams.get("models") ?? "").split(",");
    expect(models.toSorted()).toEqual([...FETCH_MODEL_IDS].toSorted());
    expect(models).toContain("icon_seamless"); // the graft source is fetched…
    expect(MODEL_IDS).not.toContain("icon_seamless"); // …but is not a registered model
  });

  it("defaults forecast_days to 10 and honours an override", async () => {
    const a = captureUrl();
    await fetchForecast({ lat: 0, lon: 0 });
    expect(a.urlOf().searchParams.get("forecast_days")).toBe("10");

    vi.unstubAllGlobals();
    const b = captureUrl();
    await fetchForecast({ lat: 0, lon: 0, forecastDays: 3 });
    expect(b.urlOf().searchParams.get("forecast_days")).toBe("3");
  });

  it("passes an explicit model subset straight through", async () => {
    const { urlOf } = captureUrl();
    await fetchForecast({ lat: 0, lon: 0, models: ["ecmwf_ifs", "gfs_seamless"] });
    expect(urlOf().searchParams.get("models")).toBe("ecmwf_ifs,gfs_seamless");
  });

  it("carries the shared baseParams (coords, timezone, metric units)", async () => {
    const { urlOf } = captureUrl();
    await fetchForecast({ lat: 48.2, lon: 16.4 });
    const p = urlOf().searchParams;
    expect(p.get("latitude")).toBe("48.2");
    expect(p.get("longitude")).toBe("16.4");
    expect(p.get("timezone")).toBe("auto");
    expect(p.get("temperature_unit")).toBe("celsius");
    expect(p.get("wind_speed_unit")).toBe("kmh");
    expect(p.get("hourly")).toContain("temperature_2m");
    expect(p.get("daily")).toContain("sunrise");
  });
});

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
