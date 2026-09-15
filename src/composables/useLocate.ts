import { computed, getCurrentScope, onScopeDispose, ref, type Ref } from "vue";

import { fetchEdgeLocation } from "@/api/edgeGeo";

import { sameLocation, type Location } from "./useLocation";

/** The two position sources, injectable so the flow is testable without a browser. */
export interface LocateSources {
  /** The permission-free, city-level estimate (api/edgeGeo). */
  fetchEdge: () => Promise<Location | null>;
  /** The browser Geolocation API; undefined where unsupported. */
  geolocation: Geolocation | undefined;
}

const NOTICE_MS = 6000;
const GPS_OPTIONS: PositionOptions = { enableHighAccuracy: false, timeout: 10_000, maximumAge: 5 * 60_000 };

/**
 * The "Use my location" flow: approximate first, precise on request.
 *
 * Browser geolocation raises a permission prompt, and an installed iOS web app
 * raises it on every launch — iOS does not persist the grant for standalone
 * web apps. So the first tap asks the site's edge endpoint, which places the
 * visitor at city level from their IP with no prompt. While that approximate
 * fix is the current location, the same button becomes "precise": a second tap
 * runs GPS, and only then does the prompt appear. Where the edge has no
 * estimate (a VPN, a host without the Worker) the first tap falls straight
 * through to GPS, so the button never dead-ends.
 */
export function useLocate(
  current: Readonly<Ref<Location>>,
  setLocation: (loc: Location) => void,
  sources: LocateSources = { fetchEdge: () => fetchEdgeLocation(), geolocation: navigator.geolocation },
) {
  const isLocating = ref(false);
  const error = ref<string | null>(null);
  /** Transient hint after an approximate fix: how to refine it. */
  const notice = ref<string | null>(null);
  const approximate = ref<Location | null>(null);

  /** True while the location on screen is the edge estimate from this session. */
  const isApproximate = computed(() => approximate.value !== null && sameLocation(approximate.value, current.value));
  const title = computed(() => (isApproximate.value ? "Use precise location (GPS)" : "Use my location"));

  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  function showNotice(text: string): void {
    clearTimeout(noticeTimer);
    notice.value = text;
    noticeTimer = setTimeout(() => (notice.value = null), NOTICE_MS);
  }
  if (getCurrentScope()) onScopeDispose(() => clearTimeout(noticeTimer));

  function locatePrecise(): Promise<void> {
    const geolocation = sources.geolocation;
    if (!geolocation) {
      error.value = "Geolocation not supported by this browser.";
      return Promise.resolve();
    }
    isLocating.value = true;
    return new Promise((resolve) => {
      geolocation.getCurrentPosition(
        (pos) => {
          isLocating.value = false;
          setLocation({
            name: "Your location",
            detail: `${pos.coords.latitude.toFixed(3)}, ${pos.coords.longitude.toFixed(3)}`,
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          });
          resolve();
        },
        (err) => {
          isLocating.value = false;
          switch (err.code) {
            case err.PERMISSION_DENIED:
              error.value = "Location permission denied.";
              break;
            case err.POSITION_UNAVAILABLE:
              error.value = "Location unavailable.";
              break;
            case err.TIMEOUT:
              error.value = "Location request timed out.";
              break;
            default:
              error.value = "Could not determine location.";
          }
          resolve();
        },
        GPS_OPTIONS,
      );
    });
  }

  async function locate(): Promise<void> {
    if (isLocating.value) return;
    error.value = null;
    notice.value = null;
    if (isApproximate.value) return locatePrecise();
    isLocating.value = true;
    const edge = await sources.fetchEdge();
    isLocating.value = false;
    if (!edge) return locatePrecise();
    approximate.value = edge;
    setLocation(edge);
    // Short enough to fit the phone-width strip in LocationBar without truncating.
    showNotice("Approximate location. Tap again for GPS.");
  }

  return { locate, isLocating, error, notice, isApproximate, title };
}
