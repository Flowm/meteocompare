import { useEventListener } from "@vueuse/core";
import { computed, ref } from "vue";

/**
 * Map raw finger travel (px) to the visual pull distance (px). Travel up to the
 * trigger threshold tracks the finger 1:1; past it, rubber-band resistance eases
 * the indicator toward `maxPull` instead of following the finger forever.
 */
export function resolvePull(rawDelta: number, threshold: number, maxPull: number): number {
  if (rawDelta <= 0) return 0;
  const pulled = rawDelta <= threshold ? rawDelta : threshold + (rawDelta - threshold) * 0.4;
  return Math.min(pulled, maxPull);
}

export interface UsePullToRefreshOptions {
  /** Finger travel (px) required before a release triggers a refresh. @default 72 */
  threshold?: number;
  /** Hard cap on the visual pull distance (px), past which resistance flattens. @default 120 */
  maxPull?: number;
  /** Invoked exactly once when a pull is released past the threshold. */
  onRefresh: () => void;
}

/**
 * Custom pull-to-refresh for touch devices. Installed PWAs (iOS standalone in
 * particular) have no browser chrome and no native pull-to-refresh, so there is
 * otherwise no way to force a reload. We watch document touch gestures, engage
 * only when the page is at the very top and the finger travels downward, and
 * fire `onRefresh` on release past the threshold.
 *
 * Singleton-free and view-agnostic: both views scroll on the window, so the
 * window scroll position is the single source of truth for "at the top".
 */
export function usePullToRefresh(options: UsePullToRefreshOptions) {
  const { threshold = 72, maxPull = 120, onRefresh } = options;

  /** Current visual pull distance in px (0 when idle). */
  const distance = ref(0);
  /** True from the moment a refresh fires until the page tears down. */
  const refreshing = ref(false);
  /** 0..1 pull progress toward the trigger threshold. */
  const progress = computed(() => Math.min(distance.value / threshold, 1));

  let startY = 0;
  let tracking = false;

  const atTop = () => window.scrollY <= 0;

  useEventListener(
    window,
    "touchstart",
    (e) => {
      // Single-finger pulls from the top only — ignore pinch and mid-page touches.
      const touch = e.touches[0];
      if (refreshing.value || e.touches.length !== 1 || !touch || !atTop()) {
        tracking = false;
        return;
      }
      startY = touch.clientY;
      tracking = true;
    },
    { passive: true },
  );

  useEventListener(
    window,
    "touchmove",
    (e) => {
      const touch = e.touches[0];
      if (!tracking || refreshing.value || !touch) return;

      const delta = touch.clientY - startY;
      // Abandon the moment the finger reverses or the page scrolls off the top,
      // handing the gesture back to native scrolling.
      if (delta <= 0 || !atTop()) {
        tracking = false;
        distance.value = 0;
        return;
      }

      distance.value = resolvePull(delta, threshold, maxPull);
      // Own the gesture: suppress the native overscroll bounce while pulling.
      // Requires a non-passive listener; we only call it once actually engaged.
      e.preventDefault();
    },
    { passive: false },
  );

  const release = () => {
    if (!tracking || refreshing.value) {
      tracking = false;
      return;
    }
    tracking = false;
    if (distance.value >= threshold) {
      refreshing.value = true;
      distance.value = threshold; // settle the indicator at the trigger point
      onRefresh();
    } else {
      distance.value = 0;
    }
  };

  useEventListener(window, "touchend", release, { passive: true });
  useEventListener(window, "touchcancel", release, { passive: true });

  return { distance, progress, refreshing, threshold };
}
