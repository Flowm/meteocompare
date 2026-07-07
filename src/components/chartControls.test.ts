import { describe, expect, it } from "vitest";
import { nextTick, ref } from "vue";

import type { HourlySeries } from "@/composables/hourlySeries";

import { useChartControls } from "./chartControls";
import type { ChartViewId } from "./chartHelpers";

const FORECAST_VARIABLES: ChartViewId[] = ["temperature_2m", "precipitation", "wind_speed_10m"];

/** Two registry models; gfs has no precipitation data (all-null), so the
 *  precipitation view's chip for it must read as disabled. */
function series(over: Partial<HourlySeries> = {}): HourlySeries {
  return {
    times: ["2026-05-20T00:00", "2026-05-20T01:00"],
    aggregate: {},
    perModel: {
      temperature_2m: { ecmwf_ifs: [1, 2], gfs_seamless: [3, 4] },
      precipitation: { ecmwf_ifs: [0, 0.5], gfs_seamless: [null, null] },
    },
    ...over,
  };
}

function controlsFor(data: HourlySeries, variables: ChartViewId[] = FORECAST_VARIABLES) {
  return useChartControls({ data: () => data, variables, defaultWindow: 72 });
}

describe("useChartControls — view selection", () => {
  it("opens on the composite when temp + precip are combinable (no truth)", () => {
    const c = controlsFor(series());
    expect(c.view.value).toBe("temp_precip");
  });

  it("opens on the first variable when truth is present (verify keeps per-variable views)", () => {
    const c = controlsFor(series({ truth: { temperature_2m: [1, 1] } }));
    expect(c.view.value).toBe("temperature_2m");
    expect(c.hasTruth.value).toBe(true);
  });

  it("toggles the combinable pair through the composite and never empties it", () => {
    const c = controlsFor(series());
    // From the composite, clicking precipitation toggles it off → temperature.
    c.selectVariable("precipitation");
    expect(c.view.value).toBe("temperature_2m");
    // Clicking precipitation again re-adds it → back to the composite.
    c.selectVariable("precipitation");
    expect(c.view.value).toBe("temp_precip");
    // Toggling off the last remaining variable is a no-op.
    c.selectVariable("precipitation");
    c.selectVariable("temperature_2m");
    expect(c.view.value).toBe("temperature_2m");
  });

  it("treats every other variable as an exclusive single-axis view", () => {
    const c = controlsFor(series());
    c.selectVariable("wind_speed_10m");
    expect(c.view.value).toBe("wind_speed_10m");
    // Clicking temperature from an exclusive view focuses it (not the composite).
    c.selectVariable("temperature_2m");
    expect(c.view.value).toBe("temperature_2m");
  });

  it("marks both members of the pair active while the composite is shown", () => {
    const c = controlsFor(series());
    expect(c.isVarActive("temperature_2m")).toBe(true);
    expect(c.isVarActive("precipitation")).toBe(true);
    expect(c.isVarActive("wind_speed_10m")).toBe(false);
  });
});

describe("useChartControls — overlay ↔ composite snaps", () => {
  it("snaps the composite to Temperature when the overlay turns on", async () => {
    const c = controlsFor(series());
    expect(c.view.value).toBe("temp_precip");
    c.toggleModel("ecmwf_ifs");
    await nextTick();
    expect(c.overlayOn.value).toBe(true);
    expect(c.view.value).toBe("temperature_2m");
  });

  it("clears the enabled models when the composite is re-selected", () => {
    const c = controlsFor(series());
    c.toggleModel("ecmwf_ifs");
    expect(c.enabledModels.value.size).toBe(1);
    c.selectView("temp_precip");
    expect(c.enabledModels.value.size).toBe(0);
    expect(c.view.value).toBe("temp_precip");
  });
});

describe("useChartControls — model chips", () => {
  it("builds the chip universe from models with any data, in registry order", () => {
    const c = controlsFor(series());
    expect(c.allModels.value.map((m) => m.id)).toEqual(["ecmwf_ifs", "gfs_seamless"]);
  });

  it("disables a chip when the model has no data for the active variable", () => {
    const c = controlsFor(series({ truth: { temperature_2m: [1, 1] } }), ["precipitation", "temperature_2m"]);
    expect(c.view.value).toBe("precipitation");
    // gfs is all-null on precipitation → guarded off.
    expect(c.modelHasData.value.gfs_seamless).toBe(false);
    c.toggleModel("gfs_seamless");
    expect(c.enabledModels.value.size).toBe(0);
    c.toggleModel("ecmwf_ifs");
    expect(c.enabledModels.value.has("ecmwf_ifs")).toBe(true);
  });

  it("toggles all available models on and off as one flip", async () => {
    const c = controlsFor(series());
    c.toggleModel("ecmwf_ifs");
    await nextTick(); // overlay snap → temperature view
    expect(c.allModelsActive.value).toBe(false);
    c.toggleAllModels();
    expect(c.enabledModels.value.size).toBe(2);
    expect(c.allModelsActive.value).toBe(true);
    c.toggleAllModels();
    expect(c.enabledModels.value.size).toBe(0);
  });

  it("resets the enabled models when the chip universe changes (new data / run)", async () => {
    const data = ref(series());
    const c = useChartControls({ data: () => data.value, variables: FORECAST_VARIABLES, defaultWindow: 72 });
    c.toggleModel("ecmwf_ifs");
    expect(c.enabledModels.value.size).toBe(1);
    data.value = series({ perModel: { temperature_2m: { ecmwf_ifs: [5, 6] } } });
    await nextTick();
    expect(c.enabledModels.value.size).toBe(0);
  });
});
