# MeteoCompare

Multi-model weather forecast comparison with a weighted aggregate and a per-timestep predictability signal.

Frontend-only (Vue 3 + Vite). Forecasts come straight from [open-meteo.com](https://open-meteo.com) — no MeteoCompare backend, no API key.

## Features

- **21 forecast models/products**, automatically dropped in/out based on geographic coverage and forecast horizon.
- **Aggregate-first UI**: temperature + ±1σ predictability band, precipitation bars, daily strip with weather icon / high / low / precip prob / wind.
- **Predictability signal** per timestep — derived from inter-model spread (agreement) normalised against typical seasonal spread, a model-count penalty, and lead-time decay encoded in the model weights. An _uncalibrated, agreement-based_ estimate — a "poor man's" predictability; see ADR 0005.
- **Per-model overlay** (opt-in) — one line per contributing model drawn over the aggregate, with per-model toggles, switchable between temperature, precipitation, precipitation probability, wind speed, and cloud cover.
- **Window toggle** — 24 h / 3 d / 7 d on both charts.
- **Locations** — open-meteo geocoding search, browser geolocation, URL-shareable state, favourites and recent-search in localStorage.
- **Units** — °C ⇄ °F, mm ⇄ in, km/h ⇄ mph; persisted.

## How the aggregation works

Per timestep and per variable:

1. **Pick the contributing models.** Each model has a home region (rough bbox) and a max useful lead time. Models that don't cover the location, or whose horizon has been exceeded, are filtered out.
2. **Weight them.**
   - Base weight = 1.
   - Region bonus of +0.2 (mid-resolution) or +0.3 (convection-allowing) when the location is inside the model's home region.
   - Lead-time decay per model class: convection-allowing models fade out by 60 h, mid-resolution regionals by 120 h, globals decay gently from 72 h → 0.4× by 240 h, and AI plus ensemble-mean products follow global decay with a smaller vote.
   - Variable boost: CAMs get ×1.3 for precipitation and precipitation probability, since they explicitly resolve convection.
3. **Aggregate**:
   - **Temperature / precip / cloud cover / wind speed** → weighted mean + weighted standard deviation.
   - **Wind direction** → weighted circular mean via unit-vector sum (so 350° + 10° averages to 0°, not 180°). Angular standard deviation via Mardia's formula on the mean resultant length.
   - **Weather code** → severity-weighted modal class: bin WMO codes into severity groups (clear / mostly_clear / cloudy / fog / drizzle / rain / snow / storm), pick the group with the highest summed weight, then within that group pick the most-weighted code.

## How the predictability signal works

Predictability is computed from **agreement** (inter-model spread). It is an
_uncalibrated_ estimate — see the limitations and ADR 0005. For each numeric variable:

```
spreadScore    = clamp(1 − stdDev / typicalSpread, 0, 1)
                 typicalSpread ramps with lead time; daily accumulated variables
                 (precipitation_sum) use a day-scale typical spread (mm/day) rather
                 than the hourly rate scale (mm/h).

modelFactor    = min(1, n / 3)   where n = number of contributing models
                 1 model → ⅓,  2 models → ⅔,  3+ models → 1

predictability = clamp(spreadScore × modelFactor, 0, 1)
```

Wind direction uses the same formula with circular standard deviation in degrees.
Weather codes have no meaningful stdDev, so they use severity-group agreement instead:
`predictability = clamp(weightShare(same severity group) × modelFactor, 0, 1)`.

Lead-time decay is handled entirely in the model weighting layer (not as a separate
multiplier here): CAMs fade out by 60 h, regionals by 120 h, globals decay past 72 h,
and AI plus ensemble-mean products follow global decay with a smaller vote.

The badge maps the result to one of three tiers — high (≥70 %, emerald), mid (≥40 %, amber), low (rose).

## Models

| Open-meteo id                 | Provider           | Resolution / scope                 | Class         | Max lead |
| ----------------------------- | ------------------ | ---------------------------------- | ------------- | -------- |
| `ecmwf_ifs`                   | ECMWF              | 9 km HRES global                   | global        | 240 h    |
| `gfs_seamless`                | NOAA               | seamless NOAA global/U.S. coverage | global        | 384 h    |
| `gem_seamless`                | Environment Canada | 2.5–15 km, NA focus                | regional-mid  | 240 h    |
| `ukmo_seamless`               | UK Met Office      | 2 km UKV / 10 km global            | regional-mid  | 168 h    |
| `meteofrance_seamless`        | Météo-France       | 1.3 km AROME / 25 km ARPEGE        | regional-cam  | 102 h    |
| `cma_grapes_global`           | CMA                | 15 km global, East Asia focus      | global        | 240 h    |
| `bom_access_global`           | BOM                | 15 km global, Aus. focus           | global        | 240 h    |
| `jma_seamless`                | JMA                | 5 km Japan / 55 km global          | regional-mid  | 264 h    |
| `kma_seamless`                | KMA                | 1.5–13 km, Korea focus             | regional-mid  | 288 h    |
| `icon_global`                 | DWD                | 11 km global                       | global        | 180 h    |
| `icon_eu`                     | DWD                | 7 km Europe                        | regional-mid  | 120 h    |
| `icon_d2`                     | DWD                | 2 km central Europe CAM            | regional-cam  | 48 h     |
| `knmi_harmonie_arome_europe`  | KNMI               | 2 km Harmonie AROME Europe         | regional-cam  | 60 h     |
| `dmi_harmonie_arome_europe`   | DMI                | 2 km Harmonie AROME Europe         | regional-cam  | 60 h     |
| `metno_nordic`                | MET Norway         | 2.5 km Nordics                     | regional-cam  | 60 h     |
| `meteoswiss_icon_seamless`    | MeteoSwiss         | 1–2 km ICON Switzerland seamless   | regional-cam  | 120 h    |
| `geosphere_arome_austria`     | GeoSphere Austria  | AROME Austria                      | regional-cam  | 60 h     |
| `ecmwf_aifs025_single`        | ECMWF              | 0.25° AI forecast                  | ai            | 360 h    |
| `gfs_graphcast025`            | NOAA               | 0.25° GraphCast forecast           | ai            | 384 h    |
| `ncep_aigfs025`               | NOAA               | 0.25° AI-enhanced GFS              | ai            | 384 h    |
| `ncep_hgefs025_ensemble_mean` | NOAA               | 0.25° ensemble mean                | ensemble-mean | 384 h    |

## Tech

- **Vue 3** (`<script setup>`, Composition API) + **Vite** + **TypeScript** (strict)
- **Tailwind CSS v4** via `@tailwindcss/vite`
- **vue-echarts** (ECharts 6) for the charts
- **vue-router** for URL state, **@vueuse/core** for localStorage / debounce
- **Erik Flowers' [weather-icons](https://github.com/erikflowers/weather-icons)** for the icon set
- **Vitest** for unit tests
- **oxlint** (Rust-based linter) + **oxfmt** for formatting
- **wrangler** for deploys to Cloudflare Workers static assets

## Architecture

```
        UI (Vue components)               Composables                Domain layer (pure TS)
┌──────────────────────────────────┐  ┌──────────────────┐  ┌────────────────────────────────┐
│  LocationBar                     │  │  useLocation     │  │  models.ts                     │
│  AggregateSummary                │  │   ─ URL sync     │  │   ─ registry + bboxes          │
│  HourlySeriesChart  (shared)     │  │   ─ favourites   │  │  weighting.ts                  │
│  DailyStrip / DayCard            │  │  useForecast     │  │   ─ region bonus + decay       │
│  VerificationDayCard            ►│◄─┤   ─ fetch+aggreg.│◄─┤  aggregate.ts                  │
│  HitMissStrip                    │  │  useVerification │  │  aggregateVariables.ts (triad) │
│  WeatherIcon/PredictabilityBadge │  │   ─ fetch+score  │  │  predictability.ts             │
│                                  │  │  useUnits        │  │  verification.ts (bias/MAE …)  │
│  ForecastView · VerificationView │  │   ─ formatters   │  │  weatherCodes.ts               │
└──────────────────────────────────┘  └──────────────────┘  └────────────────────────────────┘
                                                                            ▲
                                                                            │
                                            ┌───────────────────────────────┴──────────────────┐
                                            │  api/omForecast.ts      ─ live forecast client    │
                                            │  api/omSingleRuns.ts    ─ historical model runs   │
                                            │  api/omHistoricalWeather.ts ─ ERA5-Seamless truth │
                                            │  api/geocoding.ts       ─ location search         │
                                            │  (HTTP caching via the service worker, SWR)       │
                                            └────────────────────────────────────────────────────┘
```

The **domain layer** is pure TS, unit-tested with Vitest. The UI sits on top of it via the
composables. There is no global store — the URL is the source of truth for the location, and
localStorage holds units, favourites, and recent searches.

## Develop

```bash
mise install         # provision Node + prek (see mise.toml); or use your own Node 24
mise run setup       # install the git hooks (one-time; runs `prek install`)

npm install
npm run dev          # http://localhost:5173
```

[mise](https://mise.jdx.dev) pins the toolchain (Node 24, matching CI). Git hooks are run by
[prek](https://prek.j178.dev), a pre-commit-compatible runner — on every **commit**,
`.pre-commit-config.yaml` auto-fixes with oxlint/oxfmt and runs the type-check + tests, the same gate
as CI. mise is optional: any Node 24 works, but you'll then install prek yourself to get the hooks.

### Scripts

```bash
npm run dev          # Vite dev server
npm run build        # type-check + production build to ./dist
npm run preview      # serve ./dist locally

npm test             # Vitest unit tests
npm run test:watch   # interactive

npm run lint         # oxlint + oxfmt --check + vue-tsc (CI gate)
npm run lint:fix     # oxlint --fix + oxfmt --write (local autofix)

npm run deploy       # build + wrangler deploy (Cloudflare Workers)
npm run deploy:preview  # build + upload a preview version aliased to the current commit
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

Pushes to `main` deploy to production automatically via the `deploy` job in CI.

### PR previews

Every pull request gets its own preview deployment. The `preview` job in CI uploads a new Worker version with `wrangler versions upload` (without promoting it to production), aliased to the first 8 chars of the head commit, and posts a sticky comment with the URL — `<sha>-meteocompare.<subdomain>.workers.dev`. The alias is derived from the commit, so `npm run deploy:preview` mints the same URL from your machine.

Requirements (one-time):

- A **workers.dev subdomain** registered on the Cloudflare account — preview URLs resolve under it (`preview_urls: true` in `wrangler.jsonc` enables them). Production stays on the custom domain.
- The `CLOUDFLARE_API_TOKEN` repo secret needs **Workers Scripts: Edit** (the same token used by the deploy job).

Previews are skipped for PRs from forks, which can't access the deploy secrets.

## Limitations

- **No bias correction.** Weights are static — no weight calibration against ERA5 reanalysis. Some models systematically run cold/warm or under/over-predict precipitation in some regions; that bias passes through to the aggregate.
- **No ensemble members.** We pull deterministic runs only, not full ensemble distributions. Predictability is derived from inter-model spread (model agreement), not from individual ensemble forecasts — so it is an uncalibrated proxy, not a probability (see ADR 0005).
- **Verification covers temperature and precipitation only.** ERA5-Seamless also provides wind and cloud-cover truth, but the verification page does not yet score them.

## Acknowledgements

- **[open-meteo.com](https://open-meteo.com)** — free, generous, CORS-friendly weather API that makes the whole frontend-only design possible. Forecasts are CC BY 4.0.
- **Erik Flowers' [weather-icons](https://github.com/erikflowers/weather-icons)** — SIL OFL 1.1 font + MIT CSS.
- The numeric weather prediction community at ECMWF, NOAA, DWD, Météo-France, UK Met Office, KNMI, MET Norway, JMA, KMA, BOM, Environment Canada, and others — open-meteo aggregates their public model outputs.

The multi-model aggregate is informational and not a forecast of record. For severe weather decisions, consult your local meteorological service.
