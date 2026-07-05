import { afterEach, describe, expect, it, vi } from "vitest";

import { fakeResponse } from "@/test/fixtures";

import { formatLocation, searchLocations, type GeocodingResult } from "./geocoding";

afterEach(() => vi.unstubAllGlobals());

const loc = (over: Partial<GeocodingResult>): GeocodingResult => ({ id: 1, name: "Paris", latitude: 48.85, longitude: 2.35, ...over });

describe("searchLocations", () => {
  it("short-circuits to [] without fetching for a query under 2 chars", async () => {
    const mock = vi.fn();
    vi.stubGlobal("fetch", mock);
    expect(await searchLocations("")).toEqual([]);
    expect(await searchLocations(" a ")).toEqual([]); // trims first, so "a" is too short
    expect(mock).not.toHaveBeenCalled();
  });

  it("assembles the query, count and language params", async () => {
    const mock = vi.fn().mockResolvedValue(fakeResponse({ status: 200, body: JSON.stringify({ results: [loc({})] }) }));
    vi.stubGlobal("fetch", mock);
    await searchLocations("  Vienna  ", undefined, "de", 5);
    const url = new URL(mock.mock.calls[0]?.[0] as string);
    expect(url.searchParams.get("name")).toBe("Vienna"); // trimmed
    expect(url.searchParams.get("count")).toBe("5");
    expect(url.searchParams.get("language")).toBe("de");
    expect(url.searchParams.get("format")).toBe("json");
  });

  it("returns the results array", async () => {
    const results = [loc({ id: 1 }), loc({ id: 2, name: "Vienna" })];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fakeResponse({ status: 200, body: JSON.stringify({ results }) })));
    expect(await searchLocations("Vienna")).toHaveLength(2);
  });

  it("returns [] when the body carries no results field", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fakeResponse({ status: 200, body: "{}" })));
    expect(await searchLocations("Nowhere")).toEqual([]);
  });

  it("throws a labelled error on a non-ok response", async () => {
    // A non-429 status so fetchOpenMeteo returns it straight through (the 429
    // backoff-retry is covered under fake timers in openMeteo.test.ts).
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fakeResponse({ status: 400, body: "bad request" })));
    await expect(searchLocations("Vienna")).rejects.toThrow(/open-meteo geocoding 400: bad request/);
  });
});

describe("formatLocation", () => {
  it("joins name, admin1 and country code", () => {
    expect(formatLocation(loc({ name: "Nice", admin1: "Provence", country_code: "FR" }))).toBe("Nice, Provence, FR");
  });

  it("drops admin1 when it duplicates the name", () => {
    // City-states / regions whose admin1 equals the city name shouldn't repeat it.
    expect(formatLocation(loc({ name: "Berlin", admin1: "Berlin", country_code: "DE" }))).toBe("Berlin, DE");
  });

  it("omits the country code when absent", () => {
    expect(formatLocation(loc({ name: "Atlantis", admin1: "Deep" }))).toBe("Atlantis, Deep");
    expect(formatLocation(loc({ name: "Solo" }))).toBe("Solo");
  });
});
