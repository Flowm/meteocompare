<script setup lang="ts">
import { useDebounceFn, onClickOutside } from "@vueuse/core";
import { computed, ref, watch } from "vue";
import { useRoute } from "vue-router";

import { searchLocations, formatLocation, type GeocodingResult } from "@/api/geocoding";
import { useLocation, type Location } from "@/composables/useLocation";

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
const currentView = computed(() => VIEW_LABEL[String(route.name ?? "")] ?? "Forecast");

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
    <div class="mx-auto grid max-w-5xl grid-cols-[auto_1fr_auto] items-center gap-4 px-4 py-3.5 sm:gap-6 sm:px-6">
      <!-- Wordmark + view switcher ------------------------------------ -->
      <div class="flex items-center gap-3 sm:gap-5">
        <a href="/" class="group flex items-baseline gap-2 leading-none">
          <!-- The mark itself: a hairline circle with a sodium dot in the
               centre — a stylised barometer dial. -->
          <span class="relative inline-block size-5 shrink-0 self-center">
            <span class="border-paper-300/60 absolute inset-0 rounded-full border" aria-hidden="true" />
            <span class="bg-sodium-300 absolute top-1/2 left-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full" aria-hidden="true" />
            <span class="bg-sodium-300/70 absolute top-[1px] left-1/2 h-1 w-px -translate-x-1/2" aria-hidden="true" />
          </span>
          <span
            class="display-serif text-paper-50 hidden text-xl leading-none font-medium tracking-tight sm:inline"
            style="
              font-variation-settings:
                &quot;opsz&quot; 144,
                &quot;SOFT&quot; 30;
            "
          >
            meteo<span class="text-sodium-300">·</span>compare
          </span>
          <span class="display-serif text-paper-50 text-xl leading-none font-medium tracking-tight sm:hidden"> m<span class="text-sodium-300">·</span>c </span>
        </a>

        <span class="bg-ink-700 hidden h-5 w-px sm:inline-block" aria-hidden="true" />

        <!-- View switcher: visible on every viewport so mobile users can navigate. -->
        <div ref="viewRoot" class="relative">
          <button
            type="button"
            class="group border-ink-700 bg-ink-900/60 text-paper-200 hover:border-sodium-300/60 hover:text-paper-50 flex items-center gap-2 border px-2.5 py-1.5 font-mono text-[10px] tracking-[0.22em] uppercase transition-colors"
            :aria-expanded="viewOpen"
            aria-haspopup="menu"
            @click="viewOpen = !viewOpen"
          >
            <span class="bg-sodium-300 size-1 rounded-full" aria-hidden="true" />
            {{ currentView }}
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
              class="text-paper-200 hover:bg-ink-800 hover:text-sodium-200 block px-3 py-2 font-mono text-[11px] tracking-[0.12em] uppercase transition-colors"
              active-class="bg-ink-800 text-sodium-200"
              @click="viewOpen = false"
            >
              · Forecast
            </RouterLink>
            <RouterLink
              :to="{ path: '/verify', query: preservedQuery }"
              role="menuitem"
              class="text-paper-200 hover:bg-ink-800 hover:text-sodium-200 block px-3 py-2 font-mono text-[11px] tracking-[0.12em] uppercase transition-colors"
              active-class="bg-ink-800 text-sodium-200"
              @click="viewOpen = false"
            >
              · Verify
            </RouterLink>
          </div>
        </div>
      </div>

      <!-- Search ------------------------------------------------------- -->
      <div class="relative w-full">
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
          class="border-ink-700 bg-ink-900/70 text-paper-50 placeholder:text-paper-400/70 focus:border-sodium-300/70 focus:bg-ink-900 w-full border py-2 pr-10 pl-9 text-sm outline-none"
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

        <div
          v-if="isOpen && (results.length || favourites.length || recent.length || isSearching || searchError)"
          class="panel-in border-ink-700 bg-ink-900 absolute z-40 mt-1 w-full overflow-hidden border shadow-2xl shadow-black/60"
        >
          <div v-if="isSearching" class="text-paper-400 flex items-center gap-2 px-3 py-2 font-mono text-[10px] tracking-[0.18em] uppercase">
            <span class="bg-sodium-300 size-1 animate-pulse rounded-full" /> Searching
          </div>
          <div v-else-if="searchError" class="text-heat-400 px-3 py-2 font-mono text-[10px] tracking-[0.18em] uppercase">{{ searchError }}</div>

          <div v-if="results.length" class="max-h-64 overflow-y-auto">
            <button
              v-for="r in results"
              :key="`${r.id}-${r.latitude}`"
              class="group border-ink-800/60 hover:bg-ink-800 flex w-full items-center justify-between gap-3 border-b px-3 py-2 text-left text-sm last:border-b-0"
              @click="pick(r)"
            >
              <span class="text-paper-100 group-hover:text-paper-50 truncate">{{ formatLocation(r) }}</span>
              <span class="text-paper-400 shrink-0 font-mono text-[10px] tabular-nums">
                {{ r.latitude.toFixed(2) }}<span class="text-sodium-300/60">°</span>
                <span class="text-paper-500 mx-1">,</span>
                {{ r.longitude.toFixed(2) }}<span class="text-sodium-300/60">°</span>
              </span>
            </button>
          </div>

          <template v-if="!query && favourites.length">
            <div class="border-ink-800 text-paper-400 border-t px-3 pt-2 pb-1 font-mono text-[10px] tracking-[0.22em] uppercase">
              <span class="text-sodium-300">★</span> Favourites
            </div>
            <button
              v-for="f in favourites"
              :key="`f-${f.latitude},${f.longitude}`"
              class="hover:bg-ink-800 flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm"
              @click="pickSaved(f)"
            >
              <span class="text-sodium-300">★</span>
              <span class="text-paper-100 truncate"
                >{{ f.name }}<span v-if="f.detail" class="text-paper-400">, {{ f.detail }}</span></span
              >
            </button>
          </template>

          <template v-if="!query && recent.length">
            <div class="border-ink-800 text-paper-400 border-t px-3 pt-2 pb-1 font-mono text-[10px] tracking-[0.22em] uppercase"><span class="text-paper-300">↻</span> Recent</div>
            <button
              v-for="r in recent.slice(0, 5)"
              :key="`r-${r.latitude},${r.longitude}`"
              class="hover:bg-ink-800 flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm"
              @click="pickSaved(r)"
            >
              <span class="text-paper-400">↻</span>
              <span class="text-paper-100 truncate"
                >{{ r.name }}<span v-if="r.detail" class="text-paper-400">, {{ r.detail }}</span></span
              >
            </button>
          </template>
        </div>
      </div>

      <!-- Settings ---------------------------------------------------- -->
      <div class="flex justify-self-end">
        <SettingsMenu />
      </div>
    </div>
  </header>
</template>
