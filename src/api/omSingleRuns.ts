// Typed client for open-meteo's Single Runs API.
// Docs: https://open-meteo.com/en/docs/single-runs-api
//
// This API serves *historical* forecast runs — the actual data each model
// produced at a given run cycle. Distinct from /v1/forecast (live current
// runs) and /v1/archive (reanalysis truth). The response shape is the same
// as the forecast API, so we reuse ForecastResponse and the extract helpers.

import { MODELS } from "@/domain/models";

import type { ForecastResponse } from "./omForecast";
import { extractHourlyByModel } from "./omForecast";
import { buildOpenMeteoUrl, fetchOpenMeteo } from "./openMeteo";

const SINGLE_RUNS_URL = "https://single-runs-api.open-meteo.com/v1/forecast";

// Every model worth attempting: anything not flagged `never` in the registry.
// We send them all in one batch and prune misses at runtime (see fetchSingleRuns)
// rather than pre-filtering on the static core/partial split — retention is a
// moving window, so a model that's archived this far back today may not be next
// week, and only the API knows for a given run date.
export const ARCHIVED_MODEL_IDS: string[] = MODELS.filter((m) => m.singleRunAvailability !== "never").map((m) => m.id);

// open-meteo's single-runs API expands several of our registry ids into a
// differently-named *internal* component, and a "model run is not available"
// error names that component, not the id we sent (e.g. we request `icon_global`,
// the error says `dwd_icon`). resolveMissingId maps the component back so the
// retry can drop the right model, in two layers:
//
//  1. This explicit map, for providers whose components fan out to *different*
//     registry ids and so can't be matched by prefix: the DWD ICON family
//     (global/eu/d2 are three separate models for us) and the NCEP family (the
//     GFS component feeds gfs_seamless, GraphCast its own id).
//  2. A provider-prefix fallback (PROVIDER_PREFIX_TO_SEAMLESS_ID) for the
//     single-owner seamless products — see its note for why the component can't
//     be pinned statically.
//
// Models whose component already equals their registry id (ecmwf_ifs,
// cma_grapes_global, the Harmonie pair, …) need no entry; the direct-id check
// in resolveMissingId handles them.
const COMPONENT_TO_REGISTRY_ID: Readonly<Record<string, string>> = {
  ncep_gfs025: "gfs_seamless",
  ncep_gfs_graphcast025: "gfs_graphcast025",
  dwd_icon: "icon_global",
  dwd_icon_eu: "icon_eu",
  dwd_icon_d2: "icon_d2",
};

// Single-owner seamless products. open-meteo serves these by picking the
// highest-resolution component available at the queried point (e.g. AROME
// France HD 15-min inside France, ARPEGE elsewhere), so *which* component a run
// resolves to — and which one ages out of the archive first — is
// location-dependent: there's no single id to pin in the map above. But every
// component such a product expands into shares the provider's prefix, and no
// other registry id claims that prefix, so any unmapped component under it
// resolves unambiguously to the one seamless model. NOT usable for
// dwd_*/ncep_*, whose prefixes span several distinct registry ids (handled
// exactly above).
const PROVIDER_PREFIX_TO_SEAMLESS_ID: ReadonlyArray<readonly [string, string]> = [
  ["meteofrance_", "meteofrance_seamless"],
  ["ukmo_", "ukmo_seamless"],
  ["jma_", "jma_seamless"],
  ["kma_", "kma_seamless"],
  ["meteoswiss_", "meteoswiss_icon_seamless"],
];

// This API serves hourly cleanly, but its `daily=` aggregation requires the run
// to start at 00:00 in the *requested* timezone — which our UTC run cycles
// (00/06/12/18Z) at a location-local timezone can never satisfy. So we request
// hourly only: daily verification is recomputed from these series downstream,
// and the chart's day/night solar comes from the archive/truth call instead
// (see extractSolar in omHistoricalWeather).
const HOURLY_VARS = ["temperature_2m", "precipitation"] as const;

export type SingleRunsHourlyVar = (typeof HOURLY_VARS)[number];

export interface SingleRunsRequest {
  lat: number;
  lon: number;
  /** ISO local date (`YYYY-MM-DD`), combined with `runHour` into the run cycle. */
  runDate: string;
  /** Run cycle hour (00 / 06 / 12 / 18 Z); defaults to 0 (00Z). Models publish
   *  different cycles, so a non-00Z hour naturally prunes models that skip it. */
  runHour?: number;
  /** Optional subset of model ids; defaults to the full registry. */
  models?: string[];
  /** Days forward from the run start; defaults to 7. */
  forecastDays?: number;
}

/** Same shape as the live forecast response — variables are suffixed with
 *  `_<modelId>` when `models=` carries multiple ids. */
export type SingleRunsResponse = ForecastResponse;

export interface FetchSingleRunsOptions {
  signal?: AbortSignal;
  /** Called with each registry id the retry loop prunes as unavailable for this
   *  run. Lets a multi-run gather carry the miss forward to older runs of the
   *  same cycle instead of rediscovering it (and eating a 400) every time. */
  onModelUnavailable?: (id: string) => void;
}

function buildUrl(models: string[], req: SingleRunsRequest): string {
  const params = new URLSearchParams({
    latitude: String(req.lat),
    longitude: String(req.lon),
    run: `${req.runDate}T${String(req.runHour ?? 0).padStart(2, "0")}:00`,
    hourly: HOURLY_VARS.join(","),
    models: models.join(","),
    forecast_days: String(req.forecastDays ?? 7),
    timezone: "auto",
    wind_speed_unit: "kmh",
    temperature_unit: "celsius",
    precipitation_unit: "mm",
  });
  return buildOpenMeteoUrl(SINGLE_RUNS_URL, params);
}

async function fetchModels(models: string[], req: SingleRunsRequest, signal?: AbortSignal): Promise<SingleRunsResponse> {
  const res = await fetchOpenMeteo(buildUrl(models, req), signal);
  const text = await res.text().catch(() => "");
  if (res.ok) {
    try {
      return JSON.parse(text) as SingleRunsResponse;
    } catch {
      // A 200 with an unparseable body is the *streamed* failure shape: a large
      // batch sends its status before the body, so a missing run surfaces as a
      // plain-text "...modelRunUnavailable(model: …)" mid-stream rather than a
      // clean JSON 4xx. Fall through and raise it so the retry can act on it.
    }
  }
  // Both shapes carry the offending model id; cap the body so a partial-JSON
  // prefix can't bloat the message while still keeping the marker in range.
  throw new Error(`open-meteo single-runs ${res.status}: ${(text || res.statusText).slice(0, 500)}`);
}

// Pull the offending model id out of an error. open-meteo reports a missing run
// two ways: a clean JSON 4xx ("...Model: jma_gsm, run: …") and a streamed 200
// abort ("...modelRunUnavailable(model: App.DomainRegistry.jma_gsm, …)"). Match
// `model:` either case, skip any dotted namespace prefix, take the trailing id.
// Returns null for errors that name no model — a network failure, or a
// location-coverage miss ("No data is available for this location"), which the
// batch silently drops rather than failing on.
function parseMissingModel(message: string): string | null {
  return /model:\s*(?:[A-Za-z0-9_]+\.)*([a-z0-9_]+)/i.exec(message)?.[1] ?? null;
}

// Resolve the component id named in an error to the requested registry id to
// drop, in three layers: the model reports its own id (direct hit), an explicit
// component→id mapping, or a provider-prefix fallback for single-owner seamless
// products. Only ever returns an id that's actually in `requested`.
function resolveMissingId(named: string, requested: readonly string[]): string | null {
  if (requested.includes(named)) return named;
  const mapped = COMPONENT_TO_REGISTRY_ID[named];
  if (mapped && requested.includes(mapped)) return mapped;
  for (const [prefix, id] of PROVIDER_PREFIX_TO_SEAMLESS_ID) {
    if (named.startsWith(prefix) && requested.includes(id)) return id;
  }
  return null;
}

// A single missing run fails the *entire* batch — and the archive's per-model
// retention is a drifting window, so scrolling back far enough is guaranteed to
// hit a model that's aged out. Instead of betting on a static "core" subset, we
// attempt the full set and, when the API reports a missing run (clean JSON 4xx
// or a streamed 200 abort — fetchModels normalises both), parse the offending
// model, drop it, and retry. Each retry removes at least one id so the loop is
// bounded by the request size; we keep at least one model in the batch. Errors
// that name no model (network failure, unexpected body) propagate unchanged.
// A caller-supplied subset gets the same treatment. Every pruned model is
// reported through `opts.onModelUnavailable` — including the last one standing,
// which we can't drop but a caller can still carry forward — so a multi-run
// gather learns each miss once instead of per run (see collectSample.gatherRuns).
export async function fetchSingleRuns(req: SingleRunsRequest, opts: FetchSingleRunsOptions = {}): Promise<SingleRunsResponse> {
  let ids = req.models ?? ARCHIVED_MODEL_IDS;
  for (;;) {
    try {
      // eslint-disable-next-line no-await-in-loop -- retries are inherently sequential: each one drops the model the previous attempt reported missing.
      return await fetchModels(ids, req, opts.signal);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") throw e;
      const named = e instanceof Error ? parseMissingModel(e.message) : null;
      const drop = named ? resolveMissingId(named, ids) : null;
      if (!drop) throw e; // can't attribute the failure to a requested model
      opts.onModelUnavailable?.(drop); // learn it whether or not we can retry further
      if (ids.length <= 1) throw e;
      ids = ids.filter((id) => id !== drop);
    }
  }
}

export { HOURLY_VARS, extractHourlyByModel };
