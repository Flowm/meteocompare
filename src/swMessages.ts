// Shared contract between the service worker (producer) and the app (consumer)
// for the forecast-cache-update BroadcastChannel. sw.ts is bundled separately by
// vite-plugin-pwa, but importing a types + const module is fine — no runtime
// dependency crosses the bundle boundary beyond the string constant.
//
// See sw.ts for why the SW compares response bodies instead of using Workbox's
// header-based broadcastUpdate; useForecast.ts is the consumer.

/** BroadcastChannel name the SW posts forecast-cache updates on. */
export const FORECAST_UPDATE_CHANNEL = "open-meteo-forecast-update";

/** Message the SW broadcasts when a cached forecast response changed. */
export interface ForecastCacheUpdatedMessage {
  type: "CACHE_UPDATED";
  payload: { updatedURL: string };
}
