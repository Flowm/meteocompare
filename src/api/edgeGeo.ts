// Client for the site's own `/api/geo` endpoint (worker/src/geo.ts): Cloudflare's
// IP-derived estimate of the visitor's position. City-level at best — a mobile
// carrier or VPN can be hundreds of kilometres out — but it needs no permission
// prompt, which makes it the first step of "Use my location" (useLocate.ts).

import type { Location } from "@/composables/useLocation";

export const EDGE_GEO_URL = "/api/geo";

/** The endpoint's answer; mirrors `EdgeGeo` in worker/src/geo.ts. */
export interface EdgeGeo {
  latitude: number;
  longitude: number;
  city?: string;
  region?: string;
  country?: string;
  timezone?: string;
}

// The locate button waits on this before falling back to GPS, so keep it short.
const TIMEOUT_MS = 2500;

/** The estimate as a `Location`. The city is the name; the detail names the
 *  region and flags the fix as approximate, so the banner never presents an IP
 *  centroid as a measured position. */
export function edgeGeoToLocation(geo: EdgeGeo): Location {
  const admin = [geo.region, geo.country].filter(Boolean).join(", ");
  return {
    name: geo.city ?? "Your area",
    detail: admin ? `${admin} (approx.)` : "approx.",
    latitude: geo.latitude,
    longitude: geo.longitude,
    country_code: geo.country,
    timezone: geo.timezone,
  };
}

/** Cloudflare's estimate for this visitor, or null when there is none to use:
 *  a 204 (unplaceable IP), a non-JSON answer (a host without the Worker returns
 *  the SPA shell), a network error, or a reply slower than TIMEOUT_MS. */
export async function fetchEdgeLocation(fetchImpl: typeof fetch = fetch): Promise<Location | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(EDGE_GEO_URL, { headers: { accept: "application/json" }, signal: controller.signal });
    if (res.status !== 200 || !(res.headers.get("content-type") ?? "").includes("application/json")) return null;
    const geo = (await res.json()) as Partial<EdgeGeo> | null;
    if (!geo || !Number.isFinite(geo.latitude) || !Number.isFinite(geo.longitude)) return null;
    return edgeGeoToLocation(geo as EdgeGeo);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
