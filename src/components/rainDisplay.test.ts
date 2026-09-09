import { describe, expect, it } from "vitest";
import { createSSRApp } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { renderToString } from "vue/server-renderer";

import type { DailyAggregate } from "@/analysis/forecastEvaluation";
import { aggPoint } from "@/test/fixtures";

import DayCard from "./DayCard.vue";
import LocationBanner from "./LocationBanner.vue";

const dayProps = {
  date: "2026-06-01",
  code: 0,
  high: 20,
  low: 10,
  precipSum: 4.2,
  windSpeed: null,
  windDirection: null,
  predictability: { overall: 0, temperature: null, precipitation: null, temperatureSource: null, precipitationSource: null, calibrated: false },
};

describe("rain probability display", () => {
  it.each([null, NaN])("shows unavailable probability without hiding a known amount (%s)", async (precipProb) => {
    const html = await renderToString(createSSRApp(DayCard, { ...dayProps, precipProb }));
    expect(html).toContain("Rain chance —");
    expect(html).toContain("4.2 mm");
    expect(html).not.toContain(">dry</span>");
  });

  it.each([null, NaN, 0, 5])("distinguishes missing and low probabilities in the banner (%s)", async (probability) => {
    const daily = { aggregate: { precipitation_probability_max: [aggPoint(probability)] } } as unknown as DailyAggregate;
    const app = createSSRApp(LocationBanner, {
      current: { time: "2026-06-01T12:00", temperature_2m: 20, weather_code: 0, isDay: true },
      daily,
      solar: null,
      locationName: "Test",
    });
    app.use(createRouter({ history: createMemoryHistory(), routes: [] }));
    const html = await renderToString(app);
    expect(html).toContain(probability != null && Number.isFinite(probability) ? `${probability}%` : "Rain chance —");
    expect(html).not.toContain(">dry</span>");
  });
});
