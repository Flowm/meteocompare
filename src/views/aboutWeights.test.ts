import { describe, it, expect } from "vitest";

import { DEFAULT_WEIGHTS } from "@/analysis/defaultWeights";
import { MODELS } from "@/domain/models";
import { LEAD_BANDS } from "@/domain/scorecard";
import { bandIndexFor, resolveMultiplier } from "@/domain/weightLadder";

import { computeBandVotes, VOTE_KIND_ORDER } from "./aboutWeights";

describe("computeBandVotes — About §02 vote-share model", () => {
  const votes = computeBandVotes();

  it("emits one entry per lead band, in order", () => {
    expect(votes).not.toBeNull();
    expect(votes!.map((v) => v.band.label)).toEqual(LEAD_BANDS.map((b) => b.label));
  });

  it("normalises: each band's class shares sum to 1", () => {
    for (const v of votes!) {
      const sum = VOTE_KIND_ORDER.reduce((s, k) => s + v.byClass[k].share, 0);
      expect(sum).toBeCloseTo(1, 10);
      for (const k of VOTE_KIND_ORDER) {
        expect(v.byClass[k].share).toBeGreaterThanOrEqual(0);
        expect(v.byClass[k].share).toBeLessThanOrEqual(1);
      }
    }
  });

  it("counts exactly the models whose horizon reaches the band midpoint", () => {
    for (const v of votes!) {
      const expected = MODELS.filter((m) => v.midLead <= m.maxLeadHours).length;
      expect(v.memberCount).toBe(expected);
      const byClassSum = VOTE_KIND_ORDER.reduce((s, k) => s + v.byClass[k].count, 0);
      expect(byClassSum).toBe(expected);
    }
  });

  it("shares are the normalised production ladder multipliers (no region/precip factors)", () => {
    // Recompute one class in one band straight from resolveMultiplier and match.
    const band = votes![0]!;
    const bandIndex = bandIndexFor(band.midLead);
    let globalWeight = 0;
    let total = 0;
    for (const m of MODELS) {
      if (band.midLead > m.maxLeadHours) continue;
      const w = resolveMultiplier(m.id, m.kind, bandIndex, undefined, DEFAULT_WEIGHTS ?? undefined);
      total += w;
      if (m.kind === "global") globalWeight += w;
    }
    expect(band.byClass.global.share).toBeCloseTo(globalWeight / total, 10);
  });

  it("tells the honest lead-time story: convection-allowing models lead early then leave; AI grows long", () => {
    const first = votes![0]!;
    const last = votes![votes!.length - 1]!;
    // Convection-allowing models exist in the first band and none survive to the last.
    expect(first.byClass["regional-cam"].count).toBeGreaterThan(0);
    expect(first.byClass["regional-cam"].share).toBeGreaterThan(0);
    expect(last.byClass["regional-cam"].count).toBe(0);
    expect(last.byClass["regional-cam"].share).toBe(0);
    // The roster shrinks with lead, and AI's share of the vote grows.
    expect(last.memberCount).toBeLessThan(first.memberCount);
    expect(last.byClass.ai.share).toBeGreaterThan(first.byClass.ai.share);
  });
});
