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

// open-meteo answers a rate-limited request with HTTP 429. The free tier's
// per-minute / hourly / daily limits are easy to trip on a wide multi-run gather,
// and a bare fetch would surface the 429 as a hard failure — the caller drops the
// run and its data is silently lost. fetchOpenMeteo instead backs off and retries
// on 429 *only*: it waits the server's `Retry-After` when given, else an
// exponential delay with jitter, up to MAX_RETRIES. Every other response (ok or
// not) is returned untouched so callers keep their own status handling; an aborted
// signal rejects immediately, mid-wait included.
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 20_000;

/** Sleep `ms`, rejecting with an AbortError if `signal` fires first. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    let timer: ReturnType<typeof setTimeout>;
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Delay per a `Retry-After` header (delta-seconds or an HTTP date), clamped to
 *  [0, MAX_DELAY_MS]; null when the header is absent or unparseable. */
function retryAfterMs(res: Response): number | null {
  const header = res.headers.get("Retry-After");
  if (!header) return null;
  const seconds = Number(header);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - Date.now();
  return Number.isNaN(ms) ? null : Math.min(MAX_DELAY_MS, Math.max(0, ms));
}

/** Exponential backoff with equal jitter: 50–100% of min(cap, base·2^attempt). */
function backoffMs(attempt: number): number {
  const ceiling = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** attempt);
  return ceiling / 2 + Math.random() * (ceiling / 2);
}

/** fetch() that transparently retries on HTTP 429 with backoff — see the note
 *  above. Pass the URL from buildOpenMeteoUrl; the response is returned as-is. */
export async function fetchOpenMeteo(url: string, signal?: AbortSignal): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    // eslint-disable-next-line no-await-in-loop -- a retry can't start until the prior attempt's 429 is in hand.
    const res = await fetch(url, { signal });
    if (res.status !== 429 || attempt >= MAX_RETRIES) return res;
    // eslint-disable-next-line no-await-in-loop -- backoff between attempts is inherently sequential.
    await sleep(retryAfterMs(res) ?? backoffMs(attempt), signal);
  }
}
