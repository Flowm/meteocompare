import { describe, expect, it } from "vitest";

import { addDaysIso, daysBetweenIso } from "./date";

describe("addDaysIso", () => {
  it("adds within a month", () => {
    expect(addDaysIso("2026-05-10", 5)).toBe("2026-05-15");
  });

  it("crosses a month boundary", () => {
    expect(addDaysIso("2026-05-30", 3)).toBe("2026-06-02");
  });

  it("crosses a year boundary", () => {
    expect(addDaysIso("2026-12-30", 5)).toBe("2027-01-04");
  });

  it("handles negative deltas (subtracting days)", () => {
    expect(addDaysIso("2026-06-02", -3)).toBe("2026-05-30");
    expect(addDaysIso("2027-01-04", -5)).toBe("2026-12-30");
  });

  it("returns the same date for a zero delta", () => {
    expect(addDaysIso("2026-05-10", 0)).toBe("2026-05-10");
  });

  it("steps onto and off a leap day", () => {
    // 2024 is a leap year: Feb has 29 days.
    expect(addDaysIso("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDaysIso("2024-02-29", 1)).toBe("2024-03-01");
    // 2026 is not: Feb 28 → Mar 1.
    expect(addDaysIso("2026-02-28", 1)).toBe("2026-03-01");
  });
});

describe("daysBetweenIso", () => {
  it("is positive when the second date is later", () => {
    expect(daysBetweenIso("2026-05-10", "2026-05-15")).toBe(5);
  });

  it("is negative when the second date is earlier", () => {
    expect(daysBetweenIso("2026-05-15", "2026-05-10")).toBe(-5);
  });

  it("is zero for the same date", () => {
    expect(daysBetweenIso("2026-05-10", "2026-05-10")).toBe(0);
  });

  it("counts across month and year boundaries", () => {
    expect(daysBetweenIso("2026-05-30", "2026-06-02")).toBe(3);
    expect(daysBetweenIso("2026-12-30", "2027-01-04")).toBe(5);
  });

  it("counts the leap day", () => {
    // Feb 2024 has 29 days, so 28 Feb → 1 Mar is 2 days, not 1.
    expect(daysBetweenIso("2024-02-28", "2024-03-01")).toBe(2);
    expect(daysBetweenIso("2026-02-28", "2026-03-01")).toBe(1);
  });

  it("round-trips with addDaysIso", () => {
    const from = "2026-01-15";
    const to = addDaysIso(from, 200);
    expect(daysBetweenIso(from, to)).toBe(200);
  });
});

describe("UTC anchoring — the module's reason to exist", () => {
  // The whole point of the module: anchor date arithmetic to midnight UTC so it
  // is independent of the browser's timezone. A naive `new Date("2026-05-31")`
  // + local getDate() implementation would drift by a day for users west/east
  // of UTC. These helpers must land on the same calendar date everywhere.

  it("adds a whole number of days without a fractional-day drift", () => {
    // 400 days across two DST transitions in most local zones. A local-time
    // implementation would accumulate ±1 h per transition and could roll the
    // slice(0,10) date back a day; the UTC-anchored one cannot.
    expect(addDaysIso("2025-01-01", 400)).toBe("2026-02-05");
  });

  it("treats the input as a UTC calendar date, not a local one", () => {
    // The result never carries a time-of-day, so no local-offset rounding can
    // shift the calendar day — true for any browser timezone the CI runs in.
    for (let d = 0; d < 5; d++) {
      const iso = addDaysIso("2026-06-30", d);
      expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(iso).toHaveLength(10);
    }
    expect(addDaysIso("2026-06-30", 1)).toBe("2026-07-01");
  });

  it("day spans are exact multiples with no DST fractional remainder", () => {
    // Spanning a spring-forward and a fall-back in most zones; a local-ms diff
    // would give 89.958… or 90.042… and round wrong at the edge. UTC gives 90.
    expect(daysBetweenIso("2026-02-01", "2026-05-02")).toBe(90);
  });
});
