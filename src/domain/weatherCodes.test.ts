import { describe, expect, it } from "vitest";

import { iconFor, severitySlug, weatherLabel } from "./weatherCodes";

describe("severitySlug", () => {
  it("maps known codes to their severity group", () => {
    expect(severitySlug(0)).toBe("clear");
    expect(severitySlug(2)).toBe("mostly_clear");
    expect(severitySlug(3)).toBe("cloudy");
    expect(severitySlug(45)).toBe("fog");
    expect(severitySlug(51)).toBe("drizzle");
    expect(severitySlug(65)).toBe("rain");
    expect(severitySlug(73)).toBe("snow");
    expect(severitySlug(95)).toBe("storm");
  });

  it("falls back to 'cloudy' for an unknown code — the neutral default the aggregate votes on", () => {
    // The fallback the severity-weighted mode relies on: an unmapped code reads
    // as ordinary overcast, never as clear or storm.
    expect(severitySlug(999)).toBe("cloudy");
    expect(severitySlug(-1)).toBe("cloudy");
    expect(severitySlug(NaN)).toBe("cloudy");
  });
});

describe("iconFor", () => {
  it("returns the day/night classes and tone for a known code", () => {
    const rain = iconFor(61);
    expect(rain.day).toBe("wi-day-rain");
    expect(rain.night).toBe("wi-night-alt-rain");
    expect(rain.tone).toMatch(/^text-/);
  });

  it("gives distinct day and night variants where the table has them", () => {
    const clear = iconFor(0);
    expect(clear.day).toBe("wi-day-sunny");
    expect(clear.night).toBe("wi-night-clear");
    expect(clear.day).not.toBe(clear.night);
  });

  it("falls back to the wi-na icon for an unknown code", () => {
    const na = iconFor(999);
    expect(na.day).toBe("wi-na");
    expect(na.night).toBe("wi-na");
    expect(na.tone).toMatch(/^text-/);
  });
});

describe("weatherLabel", () => {
  it("returns the human label for a known code", () => {
    expect(weatherLabel(0)).toBe("Clear");
    expect(weatherLabel(95)).toBe("Thunderstorm");
  });

  it("returns 'Unknown' for an unmapped code", () => {
    expect(weatherLabel(999)).toBe("Unknown");
  });
});
