import { afterEach, beforeEach, describe, it, expect } from "vitest";

import type { RunEvaluation } from "./runEvaluation";
import type { LocationSample } from "./sample";
import { listSamples, loadSample, mergeRuns, sampleKey, saveSample } from "./sampleStore";
import { installFakeIndexedDB } from "./testFakeIdb";

describe("sampleKey", () => {
  it("snaps a location to a 0.25° grid cell", () => {
    expect(sampleKey(48.12, 11.38)).toBe("48.00,11.50");
  });

  it("maps nearby points to the same cell", () => {
    expect(sampleKey(48.0, 11.49)).toBe(sampleKey(48.12, 11.51));
  });

  it("handles negative coordinates", () => {
    expect(sampleKey(40.0, -74.06)).toBe("40.00,-74.00");
  });
});

function mkRun(runDate: string, runHour: number, marker: string): RunEvaluation {
  return { runDate, runHour, marker } as unknown as RunEvaluation;
}

describe("mergeRuns", () => {
  it("de-dupes by (date, cycle) with incoming winning, newest first", () => {
    const existing = [mkRun("2026-06-01", 0, "old")];
    const incoming = [mkRun("2026-06-01", 0, "new"), mkRun("2026-05-31", 0, "x")];
    const merged = mergeRuns(existing, incoming);
    expect(merged.map((r) => r.runDate)).toEqual(["2026-06-01", "2026-05-31"]);
    expect((merged[0] as unknown as { marker: string }).marker).toBe("new");
  });

  it("keeps distinct cycles of the same day as separate runs", () => {
    const merged = mergeRuns([mkRun("2026-06-01", 0, "a")], [mkRun("2026-06-01", 12, "b")]);
    expect(merged).toHaveLength(2);
  });
});

function mkSample(name: string): LocationSample {
  return { location: { latitude: 47.26, longitude: 11.39, name }, runs: [], gatheredAt: "2026-06-01T00:00:00Z" };
}

describe("sampleStore IndexedDB I/O (fake-idb)", () => {
  let fake: ReturnType<typeof installFakeIndexedDB>;

  beforeEach(() => {
    fake = installFakeIndexedDB();
  });
  afterEach(() => fake.restore());

  it("round-trips a sample through save/load", async () => {
    await saveSample("k1", mkSample("Innsbruck"));
    const loaded = await loadSample("k1");
    expect(loaded?.location.name).toBe("Innsbruck");
  });

  it("returns null for a missing key", async () => {
    expect(await loadSample("nope")).toBeNull();
  });

  it("lists every stored sample", async () => {
    await saveSample("k1", mkSample("A"));
    await saveSample("k2", mkSample("B"));
    const names = (await listSamples()).map((s) => s.location.name).toSorted();
    expect(names).toEqual(["A", "B"]);
  });

  it("stamps new records with the schema version envelope", async () => {
    await saveSample("k1", mkSample("A"));
    // The stored record carries v/data, not the legacy `sample` field.
    const loaded = await loadSample("k1");
    expect(loaded?.location.name).toBe("A");
  });

  it("still loads a legacy pre-envelope { key, sample } record (v0 migration)", async () => {
    // Seed a record in the old shape an earlier install would have written.
    const legacy: LocationSample = mkSample("Legacy");
    fake.factory.seed("samples", [{ key: "old", value: { key: "old", sample: legacy } }]);
    const loaded = await loadSample("old");
    expect(loaded?.location.name).toBe("Legacy");
  });
});
