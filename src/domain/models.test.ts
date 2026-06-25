import { describe, it, expect } from "vitest";

import { MODEL_IDS, effectiveModelCount, familyOf } from "./models";

describe("effectiveModelCount", () => {
  it("counts distinct lineages fully", () => {
    expect(effectiveModelCount(["ecmwf_ifs", "gem_seamless", "jma_seamless"])).toBeCloseTo(3, 5);
  });

  it("discounts same-family siblings (first counts fully, each sibling +0.25)", () => {
    // Four ICON variants are one family: 1 + 0.25*3 = 1.75, not 4.
    expect(effectiveModelCount(["icon_global", "icon_eu", "icon_d2", "meteoswiss_icon_seamless"])).toBeCloseTo(1.75, 5);
  });

  it("groups AI products with the analysis they derive from", () => {
    // AIFS rides with ECMWF IFS; GraphCast / AI-GFS ride with GFS.
    expect(effectiveModelCount(["ecmwf_ifs", "ecmwf_aifs025_single"])).toBeCloseTo(1.25, 5);
    expect(effectiveModelCount(["gfs_seamless", "gfs_graphcast025", "ncep_aigfs025"])).toBeCloseTo(1.5, 5);
  });

  it("treats unknown ids as independent (test fixtures, unregistered models)", () => {
    expect(effectiveModelCount(["a", "b", "c", "d"])).toBeCloseTo(4, 5);
  });

  it("collapses the full registry to far fewer effective models", () => {
    // 21 registered models, 8 lineage families → effective count well below 21.
    expect(effectiveModelCount(MODEL_IDS)).toBeLessThan(MODEL_IDS.length);
  });
});

describe("model family coverage", () => {
  it("assigns every registered model to a family (no silent singletons)", () => {
    for (const id of MODEL_IDS) {
      expect(familyOf(id), id).toBeDefined();
    }
  });
});
