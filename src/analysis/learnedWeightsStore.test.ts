import { describe, it, expect, beforeEach } from "vitest";

import { clearWeights, clearWeightsByKey, listWeights, loadWeights, saveWeights, setReach } from "./learnedWeightsStore";
import { sampleKey } from "./sampleStore";

const INNSBRUCK = { lat: 47.2654, lon: 11.3927 };
// ~33 km north of Innsbruck — a different 0.25° cell.
const NEARBY = { lat: 47.5654, lon: 11.3927 };

describe("learnedWeightsStore", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips weights, keyed by the 0.25° grid cell", () => {
    saveWeights(48.12, 11.38, { multipliers: { ecmwf_ifs: 1.5 }, trainedAt: "2026-06-01T00:00:00Z", improvement: 2.3 });
    expect(loadWeights(48.12, 11.38)?.multipliers.ecmwf_ifs).toBe(1.5);
    // A nearby point in the same cell resolves to the same stored weights.
    expect(loadWeights(48.0, 11.49)?.multipliers.ecmwf_ifs).toBe(1.5);
  });

  it("returns null when nothing is stored", () => {
    expect(loadWeights(0, 0)).toBeNull();
  });

  it("clears stored weights", () => {
    saveWeights(10, 10, { multipliers: {}, trainedAt: "2026-06-01T00:00:00Z", improvement: 0 });
    clearWeights(10, 10);
    expect(loadWeights(10, 10)).toBeNull();
  });

  describe("reach", () => {
    const store = (loc: { lat: number; lon: number }, radiusKm: number, mult: Record<string, number>): void =>
      saveWeights(loc.lat, loc.lon, {
        multipliers: mult,
        trainedAt: "2026-06-01T00:00:00Z",
        improvement: 1,
        location: { name: "x", latitude: loc.lat, longitude: loc.lon },
        radiusKm,
      });

    it("does not reach a different cell when radius is 0 (this point only)", () => {
      store(INNSBRUCK, 0, { ecmwf_ifs: 1.4 });
      expect(loadWeights(NEARBY.lat, NEARBY.lon)).toBeNull();
    });

    it("reaches a different cell within the radius", () => {
      store(INNSBRUCK, 50, { ecmwf_ifs: 1.4 });
      expect(loadWeights(NEARBY.lat, NEARBY.lon)?.multipliers.ecmwf_ifs).toBe(1.4);
    });

    it("does not reach beyond the radius", () => {
      store(INNSBRUCK, 25, { ecmwf_ifs: 1.4 });
      expect(loadWeights(NEARBY.lat, NEARBY.lon)).toBeNull();
    });

    it("prefers an exact-cell fit over a covering neighbour", () => {
      store(INNSBRUCK, 100, { ecmwf_ifs: 1.1 });
      store(NEARBY, 0, { ecmwf_ifs: 1.9 });
      expect(loadWeights(NEARBY.lat, NEARBY.lon)?.multipliers.ecmwf_ifs).toBe(1.9);
    });

    it("picks the nearest covering center when several reach the point", () => {
      // Far center reaches with a big radius; near center reaches too — near wins.
      store({ lat: 48.0654, lon: 11.3927 }, 250, { ecmwf_ifs: 0.5 }); // ~89 km away
      store({ lat: 47.4654, lon: 11.3927 }, 250, { ecmwf_ifs: 1.7 }); // ~22 km away
      expect(loadWeights(INNSBRUCK.lat, INNSBRUCK.lon)?.multipliers.ecmwf_ifs).toBe(1.7);
    });
  });

  describe("record / recipe versioning", () => {
    const PREFIX = "meteocompare:weights:";

    it("drops a bare (pre-envelope, v0) record — a decay-recipe fit that would double-apply", () => {
      // Older devices stored StoredWeights directly under the hand-tuned decay
      // recipe; re-applying those residuals on top of the fitted builtin tier
      // would double-count the lead-time correction (ADR 0011), so v0 is dropped.
      const legacy = { multipliers: { ecmwf_ifs: 1.6 }, trainedAt: "2026-01-01T00:00:00Z", improvement: 0.9 };
      localStorage.setItem(PREFIX + sampleKey(INNSBRUCK.lat, INNSBRUCK.lon), JSON.stringify(legacy));
      expect(loadWeights(INNSBRUCK.lat, INNSBRUCK.lon)).toBeNull();
      expect(listWeights()).toHaveLength(0);
    });

    it("drops an enveloped v1 record — the previous (decay) recipe version", () => {
      const stale = { v: 1, data: { multipliers: { ecmwf_ifs: 1.6 }, trainedAt: "2026-01-01T00:00:00Z", improvement: 0.9 } };
      localStorage.setItem(PREFIX + sampleKey(INNSBRUCK.lat, INNSBRUCK.lon), JSON.stringify(stale));
      expect(loadWeights(INNSBRUCK.lat, INNSBRUCK.lon)).toBeNull();
      expect(listWeights()).toHaveLength(0);
    });

    it("round-trips a current (v2, ladder-recipe) record and stamps the version", () => {
      saveWeights(INNSBRUCK.lat, INNSBRUCK.lon, { multipliers: { gfs_seamless: 1.2 }, trainedAt: "t", improvement: 0 });
      const raw = JSON.parse(localStorage.getItem(PREFIX + sampleKey(INNSBRUCK.lat, INNSBRUCK.lon))!) as { v: number; data: unknown };
      expect(raw.v).toBe(2);
      expect(raw.data).toMatchObject({ multipliers: { gfs_seamless: 1.2 } });
      expect(loadWeights(INNSBRUCK.lat, INNSBRUCK.lon)?.multipliers.gfs_seamless).toBe(1.2);
    });

    it("drops a record whose JSON is corrupt (parse-null-on-error)", () => {
      localStorage.setItem(PREFIX + sampleKey(INNSBRUCK.lat, INNSBRUCK.lon), "{not json");
      expect(loadWeights(INNSBRUCK.lat, INNSBRUCK.lon)).toBeNull();
      expect(listWeights()).toHaveLength(0);
    });
  });

  describe("management", () => {
    it("lists every stored entry with its grid key", () => {
      saveWeights(INNSBRUCK.lat, INNSBRUCK.lon, { multipliers: {}, trainedAt: "t", improvement: 0 });
      saveWeights(10, 10, { multipliers: {}, trainedAt: "t", improvement: 0 });
      const keys = listWeights()
        .map((e) => e.key)
        .toSorted();
      expect(keys).toEqual([sampleKey(10, 10), sampleKey(INNSBRUCK.lat, INNSBRUCK.lon)].toSorted());
    });

    it("updates only the reach radius via setReach", () => {
      saveWeights(INNSBRUCK.lat, INNSBRUCK.lon, { multipliers: { ecmwf_ifs: 1.4 }, trainedAt: "t", improvement: 0 });
      setReach(sampleKey(INNSBRUCK.lat, INNSBRUCK.lon), 50);
      expect(loadWeights(NEARBY.lat, NEARBY.lon)?.multipliers.ecmwf_ifs).toBe(1.4);
    });

    it("clears an entry by key", () => {
      saveWeights(INNSBRUCK.lat, INNSBRUCK.lon, { multipliers: {}, trainedAt: "t", improvement: 0 });
      clearWeightsByKey(sampleKey(INNSBRUCK.lat, INNSBRUCK.lon));
      expect(listWeights()).toHaveLength(0);
    });
  });
});
