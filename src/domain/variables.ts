// The single per-variable descriptor table. Every place that once switched on
// the forecast Variable — the aggregate reducer, the predictability formula and
// its typical-spread bands, the CAM precipitation boost, and the daily→family
// mapping — now reads its behaviour from one row here, so adding a variable is a
// single edit rather than a hunt across aggregate.ts / predictability.ts /
// weighting.ts / useForecast.ts.
//
// This is a pure domain module: it holds *data and small pure samplers*, never
// the reducer/formula implementations themselves (those stay in aggregate.ts /
// predictability.ts) and never an import of the api layer (the daily→family
// mapping is keyed by string, with a typed accessor, so api/omForecast's
// DailyVar type is not pulled into the domain — see docs/adr/0001).

/** A forecast variable the aggregate + predictability stack understands. */
export type Variable = "temperature_2m" | "precipitation" | "precipitation_probability" | "weather_code" | "wind_speed_10m" | "wind_direction_10m" | "cloud_cover";

/** How the aggregate blends the contributing models at a timestep:
 *  - `mean`     — weighted arithmetic mean (the numeric default),
 *  - `circular` — weighted circular mean (angles, for wind direction),
 *  - `mode`     — severity-weighted modal code (weather_code). */
export type ReducerKind = "mean" | "circular" | "mode";

/** How predictability is estimated for the variable:
 *  - `spread`    — normalise inter-model spread against typical spread,
 *  - `agreement` — weather_code only: weight-share agreeing with the modal slug. */
export type PredictabilityKind = "spread" | "agreement";

export interface VariableDescriptor {
  reducer: ReducerKind;
  predictability: PredictabilityKind;
  /** Expected inter-model standard deviation under normal conditions, per lead
   *  time and resolution. Daily accumulated variables (precipitation_sum) pass
   *  `"daily"`. weather_code keeps its dummy `1` (unused — it scores by
   *  agreement, not spread). */
  typicalSpread: (leadHours: number, resolution: "hourly" | "daily") => number;
  /** Multiplier applied to a CAM (regional convection-allowing) model's weight
   *  for this variable. Only precipitation + precipitation_probability carry
   *  one (1.3); absent elsewhere. */
  camBoost?: number;
}

export const VARIABLES: Record<Variable, VariableDescriptor> = {
  temperature_2m: {
    reducer: "mean",
    predictability: "spread",
    typicalSpread: (leadHours) => {
      if (leadHours <= 24) return 1;
      if (leadHours <= 72) return 1 + ((leadHours - 24) / 48) * 1;
      if (leadHours <= 168) return 2 + ((leadHours - 72) / 96) * 1.5;
      return 3.5;
    },
  },
  precipitation: {
    reducer: "mean",
    predictability: "spread",
    typicalSpread: (leadHours, resolution) => {
      if (resolution === "daily") return leadHours <= 48 ? 5 : 10; // mm/day
      return leadHours <= 48 ? 1.5 : 2.5; // mm/h
    },
    camBoost: 1.3,
  },
  precipitation_probability: {
    reducer: "mean",
    predictability: "spread",
    typicalSpread: () => 25,
    camBoost: 1.3,
  },
  weather_code: {
    reducer: "mode",
    predictability: "agreement",
    typicalSpread: () => 1, // unused — weather_code uses agreement, not spread
  },
  wind_speed_10m: {
    reducer: "mean",
    predictability: "spread",
    typicalSpread: (leadHours) => (leadHours <= 48 ? 4 : 7),
  },
  wind_direction_10m: {
    reducer: "circular",
    predictability: "spread",
    typicalSpread: (leadHours) => (leadHours <= 48 ? 30 : 70),
  },
  cloud_cover: {
    reducer: "mean",
    predictability: "spread",
    typicalSpread: () => 25,
  },
};

/** The variable a daily variable rolls up to for weighting + predictability
 *  (e.g. a daily max is weighted/scored as `temperature_2m`). Keyed by the
 *  fetched daily-variable string so the api layer's `DailyVar` type stays out
 *  of the domain; read it through {@link dailyBaseVariable}. */
const DAILY_BASE: Record<string, Variable> = {
  temperature_2m_max: "temperature_2m",
  temperature_2m_min: "temperature_2m",
  precipitation_sum: "precipitation",
  precipitation_probability_max: "precipitation_probability",
  wind_speed_10m_max: "wind_speed_10m",
  wind_direction_10m_dominant: "wind_direction_10m",
  weather_code: "weather_code",
};

/** Map a daily variable name to its base variable family. Throws on an unknown
 *  key rather than silently returning undefined, so a new daily variable that
 *  forgets its mapping fails loudly. */
export function dailyBaseVariable(daily: string): Variable {
  const base = DAILY_BASE[daily];
  if (base === undefined) throw new Error(`No base variable mapped for daily variable "${daily}"`);
  return base;
}
