import { CacheableResponsePlugin } from "workbox-cacheable-response";
import type { WorkboxPlugin } from "workbox-core";
import { ExpirationPlugin } from "workbox-expiration";
import { cleanupOutdatedCaches, precacheAndRoute } from "workbox-precaching";
import { registerRoute } from "workbox-routing";
import { NetworkFirst, StaleWhileRevalidate } from "workbox-strategies";

declare const self: ServiceWorkerGlobalScope;

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

    if (oldJson?.current?.time === newJson?.current?.time) return; // data unchanged

    const channel = new BroadcastChannel("open-meteo-forecast-update");
    // eslint-disable-next-line unicorn/require-post-message-target-origin -- BroadcastChannel.postMessage takes no targetOrigin
    channel.postMessage({ type: "CACHE_UPDATED", payload: { updatedURL: request.url } });
    channel.close();
  },
};

// Forecast: serve stale immediately, revalidate in background, broadcast when
// current.time changes.
registerRoute(
  /^https:\/\/api\.open-meteo\.com\/.*/i,
  new StaleWhileRevalidate({
    cacheName: "open-meteo-forecast",
    plugins: [forecastBroadcastPlugin, new ExpirationPlugin({ maxEntries: 50, maxAgeSeconds: 60 * 15 }), new CacheableResponsePlugin({ statuses: [0, 200] })],
  }),
);

// Geocoding: network-first with 5 s timeout.
registerRoute(
  /^https:\/\/geocoding-api\.open-meteo\.com\/.*/i,
  new NetworkFirst({
    cacheName: "open-meteo-geocoding",
    networkTimeoutSeconds: 5,
    plugins: [new ExpirationPlugin({ maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 }), new CacheableResponsePlugin({ statuses: [0, 200] })],
  }),
);
