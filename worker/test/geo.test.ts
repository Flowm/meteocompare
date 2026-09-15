import { describe, expect, it } from "vitest";

import { handleGeo, readEdgeGeo } from "../src/geo.ts";

interface CfStub {
  city?: string;
  region?: string;
  country?: string;
  timezone?: string;
  latitude?: string;
  longitude?: string;
}

// In workerd `request.cf` is a read-only getter; the runtime's RequestInit takes
// a `cf` field instead. The stub carries only the geo fields the endpoint reads,
// hence the cast.
const request = (cf: CfStub | undefined, init: RequestInit = {}): Request =>
  new Request("https://meteocompare.test/api/geo", { ...init, cf: cf as IncomingRequestCfProperties | undefined });

const MUNICH: CfStub = { city: "Munich", region: "Bavaria", country: "DE", timezone: "Europe/Berlin", latitude: "48.13740", longitude: "11.57550" };

describe("readEdgeGeo", () => {
  it("maps the cf fields, parsing the string coordinates", () => {
    expect(readEdgeGeo(request(MUNICH))).toEqual({
      latitude: 48.1374,
      longitude: 11.5755,
      city: "Munich",
      region: "Bavaria",
      country: "DE",
      timezone: "Europe/Berlin",
    });
  });

  it("returns null without a cf object or without coordinates", () => {
    expect(readEdgeGeo(request(undefined))).toBeNull();
    expect(readEdgeGeo(request({ city: "Munich", country: "DE" }))).toBeNull();
    expect(readEdgeGeo(request({ ...MUNICH, latitude: "" }))).toBeNull();
    expect(readEdgeGeo(request({ ...MUNICH, longitude: "n/a" }))).toBeNull();
  });

  it("treats the unknown and Tor placeholder countries as unplaceable", () => {
    expect(readEdgeGeo(request({ ...MUNICH, country: "XX" }))).toBeNull();
    expect(readEdgeGeo(request({ ...MUNICH, country: "T1" }))).toBeNull();
  });

  it("drops empty optional fields instead of echoing empty strings", () => {
    expect(readEdgeGeo(request({ latitude: "1", longitude: "2", city: "", region: "", timezone: "" }))).toEqual({ latitude: 1, longitude: 2 });
  });
});

describe("handleGeo", () => {
  it("answers a placed request with no-store JSON", async () => {
    const res = handleGeo(request(MUNICH));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^application\/json/);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toMatchObject({ city: "Munich", latitude: 48.1374 });
  });

  it("answers an unplaceable request with an empty 204, still no-store", async () => {
    const res = handleGeo(request(undefined));
    expect(res.status).toBe(204);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.text()).toBe("");
  });

  it("rejects methods other than GET and HEAD", () => {
    const res = handleGeo(request(MUNICH, { method: "POST" }));
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET, HEAD");
  });
});
