import { afterEach, describe, expect, it, vi } from "vitest";

import { fakeResponse } from "@/test/fixtures";

import { extractHourly, extractSolar, fetchHistoricalWeather, TRUTH_MODEL_ID, type HistoricalWeatherResponse } from "./omHistoricalWeather";

afterEach(() => vi.unstubAllGlobals());

/** Stub fetch to capture the requested URL and return `body` as a 200 JSON. */
function stubFetch(body: unknown): { urlOf: () => URL } {
  const mock = vi.fn().mockResolvedValue(fakeResponse({ status: 200, body: JSON.stringify(body) }));
  vi.stubGlobal("fetch", mock);
  return { urlOf: () => new URL(mock.mock.calls[0]?.[0] as string) };
}

const REQ = { lat: 48.2, lon: 16.4, startDate: "2026-05-01", endDate: "2026-05-07" };

describe("fetchHistoricalWeather URL assembly", () => {
  it("requests ERA5-Seamless as the truth model over the given date range", async () => {
    const { urlOf } = stubFetch({ hourly: { time: [] } });
    await fetchHistoricalWeather(REQ);
    const url = urlOf();
    expect(url.searchParams.get("models")).toBe(TRUTH_MODEL_ID);
    expect(TRUTH_MODEL_ID).toBe("era5_seamless");
    expect(url.searchParams.get("start_date")).toBe("2026-05-01");
    expect(url.searchParams.get("end_date")).toBe("2026-05-07");
    expect(url.pathname).toBe("/v1/archive");
  });

  it("carries the shared baseParams (coords, timezone, metric units)", async () => {
    const { urlOf } = stubFetch({ hourly: { time: [] } });
    await fetchHistoricalWeather(REQ);
    const p = urlOf().searchParams;
    expect(p.get("latitude")).toBe("48.2");
    expect(p.get("longitude")).toBe("16.4");
    expect(p.get("timezone")).toBe("auto");
    expect(p.get("temperature_unit")).toBe("celsius");
    expect(p.get("precipitation_unit")).toBe("mm");
    expect(p.get("wind_speed_unit")).toBe("kmh");
  });

  it("requests the truth hourly variables and the daily solar block", async () => {
    const { urlOf } = stubFetch({ hourly: { time: [] } });
    await fetchHistoricalWeather(REQ);
    const p = urlOf().searchParams;
    expect(p.get("hourly")).toBe("temperature_2m,precipitation");
    expect(p.get("daily")).toBe("sunrise,sunset");
  });

  it("throws a labelled error carrying status and body on a non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fakeResponse({ status: 400, body: "bad date range" })));
    await expect(fetchHistoricalWeather(REQ)).rejects.toThrow(/open-meteo historical-weather 400: bad date range/);
  });
});

describe("extractHourly", () => {
  const resp = { hourly: { time: ["t0", "t1"], temperature_2m: [10, 11], precipitation: [0, 2] } } as unknown as HistoricalWeatherResponse;

  it("pulls the requested truth series", () => {
    expect(extractHourly(resp, "temperature_2m")).toEqual([10, 11]);
    expect(extractHourly(resp, "precipitation")).toEqual([0, 2]);
  });

  it("returns an empty array for a variable the response omits", () => {
    const bare = { hourly: { time: ["t0"] } } as unknown as HistoricalWeatherResponse;
    expect(extractHourly(bare, "precipitation")).toEqual([]);
  });
});

describe("extractSolar", () => {
  it("reads the bare sunrise/sunset the archive returns", () => {
    const resp = { hourly: { time: [] }, daily: { time: ["d0"], sunrise: ["06:00"], sunset: ["21:00"] } } as unknown as HistoricalWeatherResponse;
    expect(extractSolar(resp)).toEqual({ sunrise: ["06:00"], sunset: ["21:00"] });
  });

  it("falls back to the model-suffixed keys when the bare ones are absent", () => {
    const resp = {
      hourly: { time: [] },
      daily: { time: ["d0"], [`sunrise_${TRUTH_MODEL_ID}`]: ["06:30"], [`sunset_${TRUTH_MODEL_ID}`]: ["20:30"] },
    } as unknown as HistoricalWeatherResponse;
    expect(extractSolar(resp)).toEqual({ sunrise: ["06:30"], sunset: ["20:30"] });
  });

  it("returns null when the daily block is absent", () => {
    const resp = { hourly: { time: [] } } as unknown as HistoricalWeatherResponse;
    expect(extractSolar(resp)).toBeNull();
  });

  it("returns null when only one of sunrise/sunset is present", () => {
    const resp = { hourly: { time: [] }, daily: { time: ["d0"], sunrise: ["06:00"] } } as unknown as HistoricalWeatherResponse;
    expect(extractSolar(resp)).toBeNull();
  });
});
