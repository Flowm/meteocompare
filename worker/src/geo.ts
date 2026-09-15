// `/api/geo`, the one dynamic endpoint behind an otherwise static site: it
// echoes Cloudflare's IP-derived estimate of where the request came from.
//
// Cloudflare attaches that estimate to every request as `request.cf`, which
// only a Worker can read — a static asset never sees the request. The browser
// calls this when the user taps "Use my location" (src/composables/useLocate.ts)
// for a city-level position without a geolocation permission prompt. Precise
// GPS stays an explicit second step.

/** What `/api/geo` answers with; mirrored by `EdgeGeo` in src/api/edgeGeo.ts. */
export interface EdgeGeo {
  latitude: number;
  longitude: number;
  city?: string;
  region?: string;
  /** ISO 3166-1 alpha-2 */
  country?: string;
  /** IANA name, e.g. "Europe/Berlin" */
  timezone?: string;
}

/** The subset of `IncomingRequestCfProperties` this endpoint reads. */
interface CfGeo {
  city?: string;
  region?: string;
  country?: string;
  timezone?: string;
  // Cloudflare ships the coordinates as strings.
  latitude?: string;
  longitude?: string;
}

// Cloudflare's placeholders for "cannot place this request": unknown, and the
// Tor network — where the coordinates describe the exit node, not the visitor.
const UNPLACEABLE_COUNTRIES = new Set(["XX", "T1"]);

// Derived from the visitor's IP, so no browser or shared cache may keep it:
// one visitor's city served to the next is the bug this header prevents.
const NO_STORE: Record<string, string> = { "cache-control": "no-store" };

function numeric(value: string | undefined): number | undefined {
  if (value == null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Cloudflare's estimate for the request, or null when it has no usable one.
 *  Coordinates are required — they are what the forecast is fetched for; a
 *  bare city name would only be a label with nothing to attach it to. */
export function readEdgeGeo(request: Request): EdgeGeo | null {
  const cf = (request as Request & { cf?: CfGeo }).cf;
  if (!cf) return null;
  if (cf.country && UNPLACEABLE_COUNTRIES.has(cf.country)) return null;
  const latitude = numeric(cf.latitude);
  const longitude = numeric(cf.longitude);
  if (latitude == null || longitude == null) return null;
  return {
    latitude,
    longitude,
    city: cf.city || undefined,
    region: cf.region || undefined,
    country: cf.country || undefined,
    timezone: cf.timezone || undefined,
  };
}

/** GET /api/geo → 200 JSON `EdgeGeo`, or 204 when Cloudflare cannot place the request. */
export function handleGeo(request: Request): Response {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(null, { status: 405, headers: { allow: "GET, HEAD" } });
  }
  const geo = readEdgeGeo(request);
  if (!geo) return new Response(null, { status: 204, headers: NO_STORE });
  return new Response(JSON.stringify(geo), {
    headers: { "content-type": "application/json; charset=utf-8", ...NO_STORE },
  });
}
