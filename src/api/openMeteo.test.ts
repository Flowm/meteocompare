import { afterEach, describe, expect, it } from "vitest";

import { OPEN_METEO_API_KEY_STORAGE_KEY, buildOpenMeteoUrl, getOpenMeteoApiKey } from "./openMeteo";

const FORECAST = "https://api.open-meteo.com/v1/forecast";
const SINGLE_RUNS = "https://single-runs-api.open-meteo.com/v1/forecast";
const ARCHIVE = "https://archive-api.open-meteo.com/v1/archive";

function url(base: string): URL {
  return new URL(buildOpenMeteoUrl(base, new URLSearchParams({ latitude: "52.52", longitude: "13.41" })));
}

afterEach(() => localStorage.removeItem(OPEN_METEO_API_KEY_STORAGE_KEY));

describe("buildOpenMeteoUrl", () => {
  it("leaves the free-tier host and params untouched with no key", () => {
    const u = url(FORECAST);
    expect(u.host).toBe("api.open-meteo.com");
    expect(u.searchParams.has("apikey")).toBe(false);
    expect(u.searchParams.get("latitude")).toBe("52.52");
  });

  it("swaps each host to its customer- twin and appends the key", () => {
    localStorage.setItem(OPEN_METEO_API_KEY_STORAGE_KEY, "secret-123");
    expect(url(FORECAST).host).toBe("customer-api.open-meteo.com");
    expect(url(SINGLE_RUNS).host).toBe("customer-single-runs-api.open-meteo.com");
    expect(url(ARCHIVE).host).toBe("customer-archive-api.open-meteo.com");
    expect(url(FORECAST).searchParams.get("apikey")).toBe("secret-123");
  });

  it("preserves the request path and the original params", () => {
    localStorage.setItem(OPEN_METEO_API_KEY_STORAGE_KEY, "k");
    const u = url(ARCHIVE);
    expect(u.pathname).toBe("/v1/archive");
    expect(u.searchParams.get("longitude")).toBe("13.41");
  });

  it("treats a whitespace-only key as no key", () => {
    localStorage.setItem(OPEN_METEO_API_KEY_STORAGE_KEY, "   ");
    expect(getOpenMeteoApiKey()).toBe("");
    expect(url(FORECAST).host).toBe("api.open-meteo.com");
  });
});
