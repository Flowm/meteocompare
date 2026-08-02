import { CacheableResponsePlugin } from "workbox-cacheable-response";
import type { WorkboxPlugin } from "workbox-core";
import { clientsClaim } from "workbox-core";
import { ExpirationPlugin } from "workbox-expiration";
import { cleanupOutdatedCaches, precacheAndRoute } from "workbox-precaching";
import { registerRoute } from "workbox-routing";
import { CacheFirst, NetworkFirst, StaleWhileRevalidate } from "workbox-strategies";

import { FORECAST_UPDATE_CHANNEL, type ForecastCacheUpdatedMessage } from "./swMessages";

declare const self: ServiceWorkerGlobalScope;

// Allow the client (virtual:pwa-register) to trigger activation of a waiting SW.
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

clientsClaim();

// eslint-disable-next-line no-underscore-dangle
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// open-meteo returns only content-type over CORS (no etag / last-modified /
// content-length), so Workbox's header-based broadcastUpdate can never fire.
// Instead, inspect the response bodies: current.time advances every 900 s
// and is the canonical signal that new forecast data is available.
const forecastBroadcastPlugin: WorkboxPlugin = {
  async cacheDidUpdate({ request, oldResponse, newResponse }) {
    if (!oldResponse) return; // first cache entry — nothing to compare

    const [oldJson, newJson] = await Promise.all([
      oldResponse.json().catch(() => null) as Promise<{ current?: { time?: string } } | null>,
      newResponse.json().catch(() => null) as Promise<{ current?: { time?: string } } | null>,
    ]);

    if (oldJson?.current?.time === newJson?.current?.time) return;

    const channel = new BroadcastChannel(FORECAST_UPDATE_CHANNEL);
    const message: ForecastCacheUpdatedMessage = { type: "CACHE_UPDATED", payload: { updatedURL: request.url } };
    // eslint-disable-next-line unicorn/require-post-message-target-origin -- BroadcastChannel.postMessage takes no targetOrigin
    channel.postMessage(message);
    channel.close();
  },
};

// Forecast: serve stale immediately, revalidate in background, broadcast when
// current.time changes.
registerRoute(
  /^https:\/\/(?:customer-)?api\.open-meteo\.com\/.*/i,
  new StaleWhileRevalidate({
    cacheName: "open-meteo-forecast",
    plugins: [forecastBroadcastPlugin, new ExpirationPlugin({ maxEntries: 50, maxAgeSeconds: 60 * 15 }), new CacheableResponsePlugin({ statuses: [0, 200] })],
  }),
);

registerRoute(
  /^https:\/\/(?:customer-)?geocoding-api\.open-meteo\.com\/.*/i,
  new NetworkFirst({
    cacheName: "open-meteo-geocoding",
    networkTimeoutSeconds: 5,
    plugins: [new ExpirationPlugin({ maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 }), new CacheableResponsePlugin({ statuses: [0, 200] })],
  }),
);

// Single Runs (verification page): historical model runs are immutable for
// past dates, so a long-TTL cache-first is the right call. The endpoint is on
// a distinct subdomain from /v1/forecast.
registerRoute(
  /^https:\/\/(?:customer-)?single-runs-api\.open-meteo\.com\/.*/i,
  new CacheFirst({
    cacheName: "open-meteo-single-runs",
    plugins: [new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 }), new CacheableResponsePlugin({ statuses: [0, 200] })],
  }),
);

// Historical weather (ERA5-Seamless truth): also effectively immutable for
// past dates. Same cache-first strategy.
registerRoute(
  /^https:\/\/(?:customer-)?archive-api\.open-meteo\.com\/.*/i,
  new CacheFirst({
    cacheName: "open-meteo-historical-weather",
    plugins: [new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 }), new CacheableResponsePlugin({ statuses: [0, 200] })],
  }),
);
