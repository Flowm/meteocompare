import { describe, expect, it } from "vitest";

import { latestVerifiableRunDate, SINGLE_FORECAST_DAYS, TRAINING_FORECAST_DAYS } from "./truthWindow";

describe("truth availability window", () => {
  it("reserves the complete forecast horizon and publication delay", () => {
    expect(latestVerifiableRunDate("2026-06-20", SINGLE_FORECAST_DAYS)).toBe("2026-06-07");
    expect(latestVerifiableRunDate("2026-06-20", TRAINING_FORECAST_DAYS)).toBe("2026-06-04");
  });
});
