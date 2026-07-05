// Shared contract between the service worker (producer) and the app
// (consumer) for the forecast-cache-update BroadcastChannel. sw.ts is bundled
// separately by vite-plugin-pwa, but importing a types + const module is fine —
// no runtime dependency crosses the bundle boundary beyond the string constant.
//
// open-meteo returns no etag / last-modified / content-length over CORS, so
// Workbox's header-based broadcastUpdate can't fire; the SW instead compares
// response bodies (current.time) and posts this message when it advances, so
// the app can swap in the fresher forecast (see sw.ts + useForecast.ts).

/** BroadcastChannel name the SW posts forecast-cache updates on. */
export const FORECAST_UPDATE_CHANNEL = "open-meteo-forecast-update";

/** Message the SW broadcasts when a cached forecast response changed. */
export interface ForecastCacheUpdatedMessage {
  type: "CACHE_UPDATED";
  payload: { updatedURL: string };
}
