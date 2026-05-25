import posthogClient from "posthog-js/dist/module.full.no-external";

let initialized = false;

export function usePostHog() {
  if (!initialized) {
    const projectKey = import.meta.env.VITE_POSTHOG_KEY;
    const apiHost = import.meta.env.VITE_POSTHOG_API_HOST || "https://eu.i.posthog.com";
    const uiHost = import.meta.env.VITE_POSTHOG_UI_HOST || "https://eu.posthog.com";

    if (projectKey && window.location.href.includes("meteocompare")) {
      posthogClient.init(projectKey, {
        api_host: apiHost,
        ui_host: uiHost,
        cookieless_mode: "always",
        defaults: "2026-01-30",
      });
      posthogClient.register({
        build_date: __BUILD_DATE__,
        build_sha: __BUILD_SHA__,
      });
    }
    initialized = true;
  }

  return { posthog: posthogClient };
}
