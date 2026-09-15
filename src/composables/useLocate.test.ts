import { afterEach, describe, expect, it, vi } from "vitest";
import { effectScope, nextTick, ref } from "vue";

import { useLocate, type LocateSources } from "./useLocate";
import type { Location } from "./useLocation";

afterEach(() => vi.useRealTimers());

const MUNICH_APPROX: Location = { name: "Munich", detail: "Bavaria, DE (approx.)", latitude: 48.1374, longitude: 11.5755 };
const DEFAULT: Location = { name: "Paris", latitude: 48.85, longitude: 2.35 };

function fakeGeolocation(outcome: { coords?: { latitude: number; longitude: number }; errorCode?: number }): Geolocation {
  const getCurrentPosition = vi.fn((ok: PositionCallback, fail?: PositionErrorCallback) => {
    if (outcome.coords) ok({ coords: outcome.coords } as GeolocationPosition);
    else fail?.({ code: outcome.errorCode ?? 2, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError);
  });
  return { getCurrentPosition } as unknown as Geolocation;
}

/** Runs the composable in a scope with a `current` that follows `setLocation`,
 *  the way the URL-backed location does in the app. */
function setup(sources: LocateSources) {
  const current = ref<Location>(DEFAULT);
  const setLocation = vi.fn((loc: Location) => (current.value = loc));
  const scope = effectScope();
  const state = scope.run(() => useLocate(current, setLocation, sources))!;
  return { current, setLocation, scope, ...state };
}

describe("useLocate", () => {
  it("takes the edge estimate first and announces the precise option", async () => {
    vi.useFakeTimers();
    const geolocation = fakeGeolocation({ coords: { latitude: 1, longitude: 2 } });
    const s = setup({ fetchEdge: vi.fn().mockResolvedValue(MUNICH_APPROX), geolocation });
    expect(s.title.value).toBe("Use my location");
    await s.locate();
    expect(s.setLocation).toHaveBeenCalledWith(MUNICH_APPROX);
    expect(geolocation.getCurrentPosition).not.toHaveBeenCalled();
    expect(s.isApproximate.value).toBe(true);
    expect(s.title.value).toBe("Use precise location (GPS)");
    expect(s.notice.value).toMatch(/Tap again for GPS/);
    await vi.advanceTimersByTimeAsync(6000);
    expect(s.notice.value).toBeNull();
    s.scope.stop();
  });

  it("runs GPS on the second tap while the approximate fix is current", async () => {
    const geolocation = fakeGeolocation({ coords: { latitude: 48.2, longitude: 11.6 } });
    const s = setup({ fetchEdge: vi.fn().mockResolvedValue(MUNICH_APPROX), geolocation });
    await s.locate();
    await s.locate();
    expect(geolocation.getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(s.current.value).toMatchObject({ name: "Your location", latitude: 48.2, longitude: 11.6, detail: "48.200, 11.600" });
    expect(s.isApproximate.value).toBe(false);
    expect(s.isLocating.value).toBe(false);
    s.scope.stop();
  });

  it("forgets the approximate state once the user picks somewhere else", async () => {
    const fetchEdge = vi.fn().mockResolvedValue(MUNICH_APPROX);
    const geolocation = fakeGeolocation({ coords: { latitude: 1, longitude: 2 } });
    const s = setup({ fetchEdge, geolocation });
    await s.locate();
    s.current.value = DEFAULT;
    await nextTick();
    expect(s.isApproximate.value).toBe(false);
    await s.locate();
    expect(fetchEdge).toHaveBeenCalledTimes(2);
    expect(geolocation.getCurrentPosition).not.toHaveBeenCalled();
    s.scope.stop();
  });

  it("falls through to GPS when the edge has no estimate", async () => {
    const geolocation = fakeGeolocation({ coords: { latitude: 1, longitude: 2 } });
    const s = setup({ fetchEdge: vi.fn().mockResolvedValue(null), geolocation });
    await s.locate();
    expect(geolocation.getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(s.current.value.name).toBe("Your location");
    expect(s.notice.value).toBeNull();
    s.scope.stop();
  });

  it("reports GPS failures by code and clears them on the next attempt", async () => {
    const s = setup({ fetchEdge: vi.fn().mockResolvedValue(null), geolocation: fakeGeolocation({ errorCode: 1 }) });
    await s.locate();
    expect(s.error.value).toBe("Location permission denied.");
    expect(s.isLocating.value).toBe(false);
    await s.locate();
    expect(s.error.value).toBe("Location permission denied.");
    s.scope.stop();
  });

  it("reports a browser without geolocation when nothing else is available", async () => {
    const s = setup({ fetchEdge: vi.fn().mockResolvedValue(null), geolocation: undefined });
    await s.locate();
    expect(s.error.value).toBe("Geolocation not supported by this browser.");
    expect(s.setLocation).not.toHaveBeenCalled();
    s.scope.stop();
  });

  it("ignores taps while a lookup is in flight", async () => {
    let resolveEdge!: (loc: Location | null) => void;
    const fetchEdge = vi.fn(() => new Promise<Location | null>((resolve) => (resolveEdge = resolve)));
    const s = setup({ fetchEdge, geolocation: undefined });
    const first = s.locate();
    expect(s.isLocating.value).toBe(true);
    await s.locate();
    expect(fetchEdge).toHaveBeenCalledTimes(1);
    resolveEdge(MUNICH_APPROX);
    await first;
    expect(s.isLocating.value).toBe(false);
    s.scope.stop();
  });
});
