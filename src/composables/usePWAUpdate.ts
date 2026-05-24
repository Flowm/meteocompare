import { registerSW } from "virtual:pwa-register";
import { ref } from "vue";

interface UsePWAUpdateOptions {
  /** Whether to automatically reload the app when a new version is detected. @default false */
  autoUpdate?: boolean;
  /** Interval in seconds to check for updates. Set to 0 to disable. @default 86400 (24 hours) */
  updateInterval?: number;
}

// Singleton state — shared across all callers
const needRefresh = ref(false);
const offlineReady = ref(false);
let updateSW: ((reloadPage?: boolean) => Promise<void>) | undefined;
let registered = false;
let intervalId: ReturnType<typeof setInterval> | undefined;

export function usePWAUpdate(options: UsePWAUpdateOptions = {}) {
  const { autoUpdate = false, updateInterval = 60 * 60 * 24 } = options;

  const updateApp = async () => {
    if (updateSW) {
      try {
        await updateSW(true);
        needRefresh.value = false;
      } catch (error) {
        console.error("PWA: Failed to update app:", error);
      }
    }
  };

  if (!registered) {
    registered = true;
    updateSW = registerSW({
      immediate: true,
      onNeedRefresh() {
        needRefresh.value = true;
        if (autoUpdate) updateApp();
      },
      onOfflineReady() {
        offlineReady.value = true;
      },
      onRegistered(registration) {
        if (registration && updateInterval > 0 && !intervalId) {
          intervalId = setInterval(() => registration.update(), updateInterval * 1000);
        }
      },
      onRegisterError(error) {
        console.error("PWA: Service worker registration error:", error);
      },
    });
  }

  return { needRefresh, offlineReady, updateApp };
}
