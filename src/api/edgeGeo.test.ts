import { afterEach, describe, expect, it, vi } from "vitest";

import { fakeResponse } from "@/test/fixtures";

import { EDGE_GEO_URL, edgeGeoToLocation, fetchEdgeLocation, type EdgeGeo } from "./edgeGeo";

afterEach(() => vi.useRealTimers());

const MUNICH: EdgeGeo = { latitude: 48.1374, longitude: 11.5755, city: "Munich", region: "Bavaria", country: "DE", timezone: "Europe/Berlin" };
const json = (body: unknown, status = 200) => fakeResponse({ status, body: JSON.stringify(body), headers: { "content-type": "application/json; charset=utf-8" } });

describe("edgeGeoToLocation", () => {
  it("names the city and flags the region detail as approximate", () => {
    expect(edgeGeoToLocation(MUNICH)).toEqual({
      name: "Munich",
      detail: "Bavaria, DE (approx.)",
      latitude: 48.1374,
      longitude: 11.5755,
      country_code: "DE",
      timezone: "Europe/Berlin",
    });
  });

  it("falls back to a generic name and a bare approximate marker", () => {
    expect(edgeGeoToLocation({ latitude: 1, longitude: 2 })).toMatchObject({ name: "Your area", detail: "approx." });
    expect(edgeGeoToLocation({ latitude: 1, longitude: 2, country: "AT" })).toMatchObject({ detail: "AT (approx.)" });
  });
});

describe("fetchEdgeLocation", () => {
  it("requests the endpoint as JSON and maps the answer", async () => {
    const mock = vi.fn().mockResolvedValue(json(MUNICH));
    expect(await fetchEdgeLocation(mock)).toMatchObject({ name: "Munich", latitude: 48.1374 });
    const [url, init] = mock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(EDGE_GEO_URL);
    expect((init.headers as Record<string, string>).accept).toBe("application/json");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("returns null for the unplaceable 204", async () => {
    expect(await fetchEdgeLocation(vi.fn().mockResolvedValue(fakeResponse({ status: 204 })))).toBeNull();
  });

  it("returns null when a host without the Worker answers with the SPA shell", async () => {
    const html = fakeResponse({ status: 200, body: "<!doctype html>", headers: { "content-type": "text/html" } });
    expect(await fetchEdgeLocation(vi.fn().mockResolvedValue(html))).toBeNull();
  });

  it("returns null for JSON without usable coordinates", async () => {
    expect(await fetchEdgeLocation(vi.fn().mockResolvedValue(json({ city: "Munich" })))).toBeNull();
    expect(await fetchEdgeLocation(vi.fn().mockResolvedValue(json(null)))).toBeNull();
  });

  it("returns null on a network error", async () => {
    expect(await fetchEdgeLocation(vi.fn().mockRejectedValue(new TypeError("Failed to fetch")))).toBeNull();
  });

  it("aborts and returns null when the endpoint is slower than its leash", async () => {
    vi.useFakeTimers();
    const mock = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    const pending = fetchEdgeLocation(mock as unknown as typeof fetch);
    await vi.advanceTimersByTimeAsync(2500);
    expect(await pending).toBeNull();
  });
});
