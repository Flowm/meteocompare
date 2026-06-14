<script setup lang="ts">
import { useDebounceFn, onClickOutside } from "@vueuse/core";
import { computed, ref, watch } from "vue";
import { useRoute } from "vue-router";

import { searchLocations, type GeocodingResult } from "@/api/geocoding";
import { useLocation, type Location } from "@/composables/useLocation";

import SearchResultsPanel from "./SearchResultsPanel.vue";
import SettingsMenu from "./SettingsMenu.vue";

const route = useRoute();
const { favourites, recent, setLocation } = useLocation();

const query = ref("");
const results = ref<GeocodingResult[]>([]);
const isOpen = ref(false);
const isSearching = ref(false);
const searchError = ref<string | null>(null);
const isLocating = ref(false);
const locateError = ref<string | null>(null);
const root = ref<HTMLElement | null>(null);

// View-switcher dropdown — replaces the side-by-side links so a single
// affordance works on every viewport size.
const viewOpen = ref(false);
const viewRoot = ref<HTMLElement | null>(null);
onClickOutside(viewRoot, () => (viewOpen.value = false));

const VIEW_LABEL: Record<string, string> = { forecast: "Forecast", verify: "Verify" };
// Compact labels for the tight mobile header; the dropdown items keep full names.
const VIEW_LABEL_SHORT: Record<string, string> = { forecast: "Fcst", verify: "Verify" };
const currentView = computed(() => VIEW_LABEL[String(route.name ?? "")] ?? "Forecast");
const currentViewShort = computed(() => VIEW_LABEL_SHORT[String(route.name ?? "")] ?? "Fcst");

// Keep the full query string when navigating between views so a runDate
// chosen on /verify survives a quick detour through /forecast and back.
// Location params (lat/lon/name/…) are already handled by useLocation and
// thread through identically.
const preservedQuery = computed(() => ({ ...route.query }));

onClickOutside(root, () => (isOpen.value = false));

const runSearch = useDebounceFn(async () => {
  if (query.value.trim().length < 2) {
    results.value = [];
    isSearching.value = false;
    return;
  }
  isSearching.value = true;
  searchError.value = null;
  try {
    results.value = await searchLocations(query.value);
  } catch (e) {
    searchError.value = e instanceof Error ? e.message : "Search failed";
    results.value = [];
  } finally {
    isSearching.value = false;
  }
}, 250);

watch(query, () => {
  isOpen.value = true;
  void runSearch();
});

function pick(r: GeocodingResult): void {
  const detail = [r.admin1, r.country_code].filter(Boolean).join(", ") || undefined;
  setLocation({
    name: r.name,
    detail,
    latitude: r.latitude,
    longitude: r.longitude,
    country_code: r.country_code,
    timezone: r.timezone,
  });
  query.value = "";
  results.value = [];
  isOpen.value = false;
}

function pickSaved(loc: Location): void {
  setLocation(loc);
  isOpen.value = false;
}

function geolocate(): void {
  if (!navigator.geolocation) {
    locateError.value = "Geolocation not supported by this browser.";
    return;
  }
  locateError.value = null;
  isLocating.value = true;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      isLocating.value = false;
      setLocation({
        name: "Your location",
        detail: `${pos.coords.latitude.toFixed(3)}, ${pos.coords.longitude.toFixed(3)}`,
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      isOpen.value = false;
    },
    (err) => {
      isLocating.value = false;
      switch (err.code) {
        case err.PERMISSION_DENIED:
          locateError.value = "Location permission denied.";
          break;
        case err.POSITION_UNAVAILABLE:
          locateError.value = "Location unavailable.";
          break;
        case err.TIMEOUT:
          locateError.value = "Location request timed out.";
          break;
        default:
          locateError.value = "Could not determine location.";
      }
    },
    { enableHighAccuracy: false, timeout: 10_000, maximumAge: 5 * 60_000 },
  );
}
</script>

<template>
  <header ref="root" class="border-ink-700 bg-ink-950/85 sticky top-0 z-30 border-b backdrop-blur">
    <!-- One row at every width. The search keeps a usable width via a compact
         view-switcher label and tighter gaps on mobile; `relative` anchors the
         full-bleed results panel, which spans the whole bar via grid placement. -->
    <div class="relative mx-auto grid max-w-5xl grid-cols-[auto_1fr_auto] items-center gap-2 px-4 py-2 sm:gap-6 sm:px-6 sm:py-3.5">
      <!-- Wordmark + view switcher ------------------------------------ -->
      <div class="flex items-center gap-2 sm:gap-5">
        <a href="/" class="group flex items-center gap-1.5 leading-none">
          <!-- The mark: the stylised barometer dial, shared with the
               favicon / PWA icons via the single source in public/logo.svg. -->
          <img src="/logo.svg" alt="" aria-hidden="true" class="size-5 shrink-0" />
          <span class="hidden text-lg leading-none font-semibold tracking-tight sm:inline"
            ><span class="text-paper-50">Meteo</span><span class="text-sodium-300">Compare</span></span
          >
          <span class="text-lg leading-none font-semibold tracking-tight sm:hidden"><span class="text-paper-50">M</span><span class="text-sodium-300">C</span></span>
        </a>

        <span class="bg-ink-700 hidden h-5 w-px sm:inline-block" aria-hidden="true" />

        <!-- View switcher: visible on every viewport so mobile users can navigate. -->
        <div ref="viewRoot" class="relative">
          <button
            type="button"
            class="group border-ink-700 bg-ink-900/60 text-paper-200 hover:border-sodium-300/60 hover:text-paper-50 flex h-9 items-center gap-2 border px-2.5 font-mono text-xs tracking-wide transition-colors"
            :aria-expanded="viewOpen"
            aria-haspopup="menu"
            @click="viewOpen = !viewOpen"
          >
            <span class="bg-sodium-300 size-1 rounded-full" aria-hidden="true" />
            <span class="sm:hidden">{{ currentViewShort }}</span>
            <span class="hidden sm:inline">{{ currentView }}</span>
            <svg class="text-paper-300 size-3 transition-transform" :class="{ 'rotate-180': viewOpen }" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>
          <div
            v-if="viewOpen"
            role="menu"
            class="panel-in border-ink-700 bg-ink-900 absolute top-full left-0 z-40 mt-1 min-w-[10rem] overflow-hidden border shadow-2xl shadow-black/60"
          >
            <RouterLink
              :to="{ path: '/', query: preservedQuery }"
              role="menuitem"
              class="text-paper-200 hover:bg-ink-800 hover:text-sodium-200 block px-3 py-2 font-mono text-xs tracking-wide transition-colors"
              active-class="bg-ink-800 text-sodium-200"
              @click="viewOpen = false"
            >
              · Forecast
            </RouterLink>
            <RouterLink
              :to="{ path: '/verify', query: preservedQuery }"
              role="menuitem"
              class="text-paper-200 hover:bg-ink-800 hover:text-sodium-200 block px-3 py-2 font-mono text-xs tracking-wide transition-colors"
              active-class="bg-ink-800 text-sodium-200"
              @click="viewOpen = false"
            >
              · Verify
            </RouterLink>
          </div>
        </div>
      </div>

      <!-- Search ------------------------------------------------------- -->
      <div class="relative w-full min-w-0">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="text-paper-400 pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          v-model="query"
          type="search"
          placeholder="Search station, city, coordinates…"
          class="border-ink-700 bg-ink-900/70 text-paper-50 placeholder:text-paper-400/70 focus:border-sodium-300/70 focus:bg-ink-900 h-9 w-full min-w-0 border pr-10 pl-9 text-base outline-none sm:text-sm"
          @focus="isOpen = true"
        />
        <button
          type="button"
          class="text-paper-300 hover:text-sodium-300 absolute top-1/2 right-1 flex -translate-y-1/2 items-center justify-center p-1.5 transition-colors"
          :disabled="isLocating"
          :title="locateError ?? 'Use my location'"
          @click="geolocate"
        >
          <svg
            v-if="!isLocating"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="size-4"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="3" />
            <circle cx="12" cy="12" r="8" />
            <line x1="12" y1="2" x2="12" y2="5" />
            <line x1="12" y1="19" x2="12" y2="22" />
            <line x1="2" y1="12" x2="5" y2="12" />
            <line x1="19" y1="12" x2="22" y2="12" />
          </svg>
          <span v-else class="border-ink-600 border-t-sodium-300 size-4 animate-spin rounded-full border" aria-hidden="true" />
          <span class="sr-only">Use my location</span>
        </button>
      </div>

      <!-- Settings ---------------------------------------------------- -->
      <div class="flex justify-self-end">
        <SettingsMenu />
      </div>

      <!-- Results panel: its own grid placement makes it full-bleed on mobile
           (spans the whole bar) yet aligned under the input on sm+. -->
      <SearchResultsPanel
        v-if="isOpen && (results.length || favourites.length || recent.length || isSearching || searchError)"
        :query="query"
        :results="results"
        :favourites="favourites"
        :recent="recent"
        :is-searching="isSearching"
        :search-error="searchError"
        @pick-result="pick"
        @pick-saved="pickSaved"
      />
    </div>
  </header>
</template>
