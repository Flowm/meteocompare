# MeteoCompare

Multi-model weather forecast comparison with a weighted aggregate and a per-timestep confidence score.

Frontend-only (Vue 3 + Vite). Forecasts come straight from [open-meteo.com](https://open-meteo.com) — no MeteoCompare backend, no API key.

## Features

- **11 NWP models**, automatically dropped in/out based on geographic coverage and forecast horizon.
- **Aggregate-first UI**: temperature + ±1σ confidence band, precipitation bars, daily strip with weather icon / high / low / precip prob / wind.
- **Confidence score** per timestep — derived from inter-model agreement, spread normalised against typical seasonal spread, and lead-time decay.
- **Multi-model breakdown** (opt-in) — spaghetti chart of every contributing model with per-model toggles, switchable between temperature, precipitation, precipitation probability, wind speed, and cloud cover.
- **Window toggle** — 24 h / 3 d / 7 d on both charts.
- **Locations** — open-meteo geocoding search, browser geolocation, URL-shareable state, favourites and recent-search in localStorage.
- **Units** — °C ⇄ °F, mm ⇄ in, km/h ⇄ mph; persisted.

## How the aggregation works

Per timestep and per variable:

1. **Pick the contributing models.** Each model has a home region (rough bbox) and a max useful lead time. Models that don't cover the location, or whose horizon has been exceeded, are filtered out.
2. **Weight them.**
   - Base weight = 1.
   - Region bonus of +0.2 (mid-resolution) or +0.3 (convection-allowing) when the location is inside the model's home region.
   - Lead-time decay per model class: convection-allowing models fade out by 60 h, mid-resolution regionals by 120 h, globals stay flat.
   - Variable boost: CAMs get ×1.3 for precipitation, since they explicitly resolve convection.
3. **Aggregate**:
   - **Temperature / precip / cloud cover / wind speed** → weighted mean + weighted standard deviation.
   - **Wind direction** → weighted circular mean via unit-vector sum (so 350° + 10° averages to 0°, not 180°). Angular standard deviation via Mardia's formula on the mean resultant length.
   - **Weather code** → severity-weighted modal class: bin WMO codes into severity groups (clear / mostly_clear / cloudy / fog / drizzle / rain / snow / storm), pick the group with the highest summed weight, then within that group pick the most-weighted code.

## How the confidence score works

For each numeric variable:

```
agreement   = share of contributing weight whose values fall within ±tolerance of the weighted mean
              (tolerance: 1.5 °C, 1 mm/h, 15 pp, 3 km/h, …)

spreadScore = clamp(1 − stdDev / typicalSpread, 0, 1)
              (typicalSpread ramps with lead time)

leadDecay   = piecewise(1.0 up to 48 h, → 0.9 @72 h, → 0.6 @168 h, → 0.2 @240 h)

confidence  = clamp((0.6 × agreement + 0.4 × spreadScore) × leadDecay, 0, 1)
```

Wind direction uses a circular variant of the same formula (signed angular delta within ±30°).

The badge maps the result to one of three tiers — high (≥70 %, emerald), mid (≥40 %, amber), low (rose).

## Models

| Open-meteo id        | Provider         | Resolution / scope        | Class            | Max lead |
| -------------------- | ---------------- | ------------------------- | ---------------- | -------- |
| `ecmwf_ifs025`       | ECMWF            | 25 km global              | global           | 240 h    |
| `gfs_global`         | NOAA             | 13–25 km global           | global           | 384 h    |
| `gfs_hrrr`           | NOAA             | 3 km CONUS CAM            | regional-cam     | 48 h     |
| `icon_global`        | DWD              | 11 km global              | global           | 180 h    |
| `icon_eu`            | DWD              | 7 km Europe               | regional-mid     | 120 h    |
| `icon_d2`            | DWD              | 2 km central Europe CAM   | regional-cam     | 48 h     |
| `gem_seamless`       | Environment Canada | 2.5–15 km, NA focus     | regional-mid     | 240 h    |
| `meteofrance_seamless` | Météo-France   | 1.3 km AROME / 25 km ARPEGE | regional-cam   | 102 h    |
| `ukmo_seamless`      | UK Met Office    | 2 km UKV / 10 km global   | regional-mid     | 168 h    |
| `knmi_seamless`      | KNMI             | 2.5 km Benelux            | regional-cam     | 60 h     |
| `metno_seamless`     | MET Norway       | 2.5 km Nordics            | regional-cam     | 60 h     |
| `jma_seamless`       | JMA              | 5 km Japan / 55 km global | regional-mid     | 264 h    |
| `kma_seamless`       | KMA              | 1.5–13 km, Korea focus    | regional-mid     | 288 h    |
| `bom_access_global`  | BOM              | 15 km global, Aus. focus  | global           | 240 h    |

## Tech

- **Vue 3** (`<script setup>`, Composition API) + **Vite** + **TypeScript** (strict)
- **Tailwind CSS v4** via `@tailwindcss/vite`
- **vue-echarts** (ECharts 5) for the charts
- **vue-router** for URL state, **@vueuse/core** for localStorage / debounce
- **Erik Flowers' [weather-icons](https://github.com/erikflowers/weather-icons)** for the icon set
- **Vitest** for unit tests
- **oxlint** (Rust-based linter) + **oxfmt** for formatting
- **wrangler** for deploys to Cloudflare Workers static assets

## Architecture

```
            UI (Vue components)              Composables               Domain layer (pure TS)
┌──────────────────────────────────┐   ┌──────────────────┐   ┌────────────────────────────────┐
│  LocationBar  ─────┐             │   │  useLocation     │   │  models.ts                     │
│  AggregateSummary  │             │   │   ─ URL sync     │   │   ─ registry + bboxes          │
│  HourlyChart       │             │   │   ─ favourites   │   │  weighting.ts                  │
│  DailyStrip ──────►│ ForecastView│◄──┤  useForecast     │◄──┤   ─ region bonus + decay       │
│  ModelBreakdown    │             │   │   ─ fetch+aggreg.│   │  aggregate.ts                  │
│  WeatherIcon       │             │   │  useUnits        │   │   ─ weighted mean / circ. mean │
│  ConfidenceBadge ──┘             │   │   ─ formatters   │   │   ─ severity-weighted mode     │
└──────────────────────────────────┘   └──────────────────┘   │  confidence.ts                 │
                                                              │   ─ agreement + spread + decay │
                                                              │  weatherCodes.ts               │
                                                              │   ─ WMO ↔ icon ↔ severity      │
                                                              └────────────────────────────────┘
                                                                            ▲
                                                                            │
                                                              ┌─────────────┴──────────────────┐
                                                              │  api/openMeteo.ts              │
                                                              │   ─ typed forecast client +    │
                                                              │     30-min in-memory cache     │
                                                              │  api/geocoding.ts              │
                                                              └────────────────────────────────┘
```

The **domain layer** is pure TS, unit-tested with Vitest (21 tests). The UI sits on top of it via three composables. There is no global store — the URL is the source of truth for the location, and localStorage holds units, favourites, and recent searches.

## Develop

```bash
npm install
npm run dev          # http://localhost:5173
```

### Scripts

```bash
npm run dev          # Vite dev server
npm run build        # type-check + production build to ./dist
npm run preview      # serve ./dist locally

npm test             # Vitest unit tests (21 cases)
npm run test:watch   # interactive

npm run lint         # oxlint + oxfmt --check + vue-tsc (CI gate)
npm run lint:fix     # oxlint --fix + oxfmt --write (local autofix)

npm run deploy       # build + wrangler deploy (Cloudflare Workers)
```

The lint script is the single quality gate — it runs the linter, asserts formatting, and type-checks in one command.

## Deploy

The app is shipped as static assets via Cloudflare Workers. Configuration lives in `wrangler.jsonc`:

- `assets.directory: ./dist` — the Vite build output
- `assets.not_found_handling: "single-page-application"` — Cloudflare serves `index.html` for any unmatched path, which is exactly what `vue-router`'s history mode needs

```bash
npx wrangler login   # one-time
npm run deploy
```

## Limitations

- **No bias correction.** Weights are static — no calibration against ERA5 reanalysis. Some models systematically run cold/warm or under/over-predict precipitation in some regions; that bias passes through to the aggregate.
- **No ensemble members.** We pull deterministic runs only, not full ensemble distributions. Confidence is derived from inter-model spread, not from individual ensemble forecasts.

## Acknowledgements

- **[open-meteo.com](https://open-meteo.com)** — free, generous, CORS-friendly weather API that makes the whole frontend-only design possible. Forecasts are CC BY 4.0.
- **Erik Flowers' [weather-icons](https://github.com/erikflowers/weather-icons)** — SIL OFL 1.1 font + MIT CSS.
- The numeric weather prediction community at ECMWF, NOAA, DWD, Météo-France, UK Met Office, KNMI, MET Norway, JMA, KMA, BOM, Environment Canada, and others — open-meteo aggregates their public model outputs.

The multi-model aggregate is informational and not a forecast of record. For severe weather decisions, consult your local meteorological service.
