import { afterEach, describe, expect, it, vi } from "vitest";

import { OPEN_METEO_API_KEY_STORAGE_KEY, buildOpenMeteoUrl, fetchOpenMeteo, getOpenMeteoApiKey } from "./openMeteo";

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

describe("fetchOpenMeteo 429 backoff", () => {
  /** Minimal Response stand-in: only status + a Retry-After lookup are read. */
  const res = (status: number, retryAfter?: string): Response =>
    ({
      status,
      ok: status >= 200 && status < 300,
      headers: { get: (k: string) => (k.toLowerCase() === "retry-after" ? (retryAfter ?? null) : null) },
    }) as unknown as Response;

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("returns a non-429 response without retrying", async () => {
    const fetchMock = vi.fn().mockResolvedValue(res(200));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchOpenMeteo("https://api.open-meteo.com/x")).resolves.toMatchObject({ status: 200 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry a non-429 error status", async () => {
    const fetchMock = vi.fn().mockResolvedValue(res(400));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchOpenMeteo("https://api.open-meteo.com/x")).resolves.toMatchObject({ status: 400 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("backs off and retries on 429, then returns the success", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValueOnce(res(429)).mockResolvedValueOnce(res(429)).mockResolvedValueOnce(res(200));
    vi.stubGlobal("fetch", fetchMock);

    const p = fetchOpenMeteo("https://api.open-meteo.com/x");
    await vi.runAllTimersAsync();

    await expect(p).resolves.toMatchObject({ status: 200 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("gives up after the retry budget and returns the last 429", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(res(429));
    vi.stubGlobal("fetch", fetchMock);

    const p = fetchOpenMeteo("https://api.open-meteo.com/x");
    await vi.runAllTimersAsync();

    await expect(p).resolves.toMatchObject({ status: 429 });
    expect(fetchMock).toHaveBeenCalledTimes(4); // initial attempt + 3 retries
  });

  it("waits out the Retry-After header before retrying", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValueOnce(res(429, "5")).mockResolvedValueOnce(res(200));
    vi.stubGlobal("fetch", fetchMock);

    const p = fetchOpenMeteo("https://api.open-meteo.com/x");
    await vi.advanceTimersByTimeAsync(4000);
    expect(fetchMock).toHaveBeenCalledTimes(1); // still honoring the 5s wait
    await vi.advanceTimersByTimeAsync(1500);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await expect(p).resolves.toMatchObject({ status: 200 });
  });

  it("stops retrying when the signal aborts mid-backoff", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const fetchMock = vi.fn().mockResolvedValue(res(429));
    vi.stubGlobal("fetch", fetchMock);

    const p = fetchOpenMeteo("https://api.open-meteo.com/x", controller.signal);
    await vi.advanceTimersByTimeAsync(1); // let the first fetch settle + schedule the backoff
    controller.abort();

    await expect(p).rejects.toThrow(/abort/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
