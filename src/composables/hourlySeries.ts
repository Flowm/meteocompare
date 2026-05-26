// Shared view-model for the unified hourly chart (HourlySeriesChart).
// Both useForecast and useVerification emit data conforming to this shape;
// the chart consumes it. Keeping `aggregate`, `truth`, and `perModel` as
// distinct fields is deliberate — see CONTEXT.md ("Model" ≠ aggregate ≠
// truth) and docs/adr/0001: the reanalysis truth is not a model, and the
// aggregate is a derived product of the models, not a peer of them.

import type { AggregatePoint } from "@/domain/aggregate";

/** Open-meteo hourly variable ids the chart can render. These are the keys
 *  used inside `aggregate`, `perModel`, and `truth`. */
export type DataVarId = "temperature_2m" | "precipitation" | "precipitation_probability" | "wind_speed_10m" | "cloud_cover";

export interface HourlySeries {
  /** Hourly time axis (location-local ISO strings, no TZ suffix). */
  times: string[];
  /** Variable id → weighted-ensemble aggregate points (carry `stdDev` → band). */
  aggregate: Partial<Record<DataVarId, AggregatePoint[]>>;
  /** Variable id → model id → raw per-model hourly series. */
  perModel: Partial<Record<DataVarId, Record<string, (number | null)[]>>>;
  /** Variable id → ERA5-Seamless truth, aligned to `times`. Present on the
   *  verification page only; absent on the forecast page. */
  truth?: Partial<Record<DataVarId, (number | null)[]>>;
}
