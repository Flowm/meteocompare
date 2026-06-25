// Shared open-meteo endpoint helper.
//
// The free-tier open-meteo hosts — api., single-runs-api., archive-api.,
// geocoding-api. — each have a paid "commercial" twin under a `customer-`
// prefix that lifts the rate limits in exchange for an API key. When the user
// has stored a key (see SettingsMenu), every request routes through the
// commercial host and carries the key as an `apikey` query param; with no key
// we hit the free tier unchanged.
//
// Docs: https://open-meteo.com/en/docs (see "Commercial API access").

/** localStorage key for the optional open-meteo commercial API key. */
export const OPEN_METEO_API_KEY_STORAGE_KEY = "meteocompare:openmeteo:api-key";

/** The configured key, trimmed; empty string when none is set. Read live from
 *  localStorage so the data layer never serves a stale value after a change. */
export function getOpenMeteoApiKey(): string {
  try {
    return (localStorage.getItem(OPEN_METEO_API_KEY_STORAGE_KEY) ?? "").trim();
  } catch {
    return ""; // localStorage unavailable (private mode / no DOM) — treat as free tier
  }
}

/** Build the request URL for an open-meteo data endpoint. With a stored key,
 *  swaps the free host for its `customer-` commercial twin and appends `apikey`;
 *  with no key, returns the free-tier URL untouched. Only mutation of `params`
 *  is the added key, so callers can pass a freshly-built URLSearchParams. */
export function buildOpenMeteoUrl(baseUrl: string, params: URLSearchParams): string {
  const key = getOpenMeteoApiKey();
  if (!key) return `${baseUrl}?${params}`;
  params.set("apikey", key);
  return `${baseUrl.replace("https://", "https://customer-")}?${params}`;
}
