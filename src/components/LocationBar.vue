<script setup lang="ts">
import { ref, watch } from 'vue'
import { useDebounceFn, onClickOutside } from '@vueuse/core'
import { searchLocations, formatLocation, type GeocodingResult } from '@/api/geocoding'
import { useLocation, type Location } from '@/composables/useLocation'
import UnitsToggle from './UnitsToggle.vue'

const { current, favourites, recent, setLocation } = useLocation()

const query = ref('')
const results = ref<GeocodingResult[]>([])
const isOpen = ref(false)
const isSearching = ref(false)
const searchError = ref<string | null>(null)
const root = ref<HTMLElement | null>(null)

onClickOutside(root, () => (isOpen.value = false))

const runSearch = useDebounceFn(async () => {
  if (query.value.trim().length < 2) {
    results.value = []
    isSearching.value = false
    return
  }
  isSearching.value = true
  searchError.value = null
  try {
    results.value = await searchLocations(query.value)
  } catch (e) {
    searchError.value = e instanceof Error ? e.message : 'Search failed'
    results.value = []
  } finally {
    isSearching.value = false
  }
}, 250)

watch(query, () => {
  isOpen.value = true
  void runSearch()
})

function pick(r: GeocodingResult): void {
  const detail = [r.admin1, r.country_code].filter(Boolean).join(', ') || undefined
  setLocation({
    name: r.name,
    detail,
    latitude: r.latitude,
    longitude: r.longitude,
    country_code: r.country_code,
    timezone: r.timezone,
  })
  query.value = ''
  results.value = []
  isOpen.value = false
}

function pickSaved(loc: Location): void {
  setLocation(loc)
  isOpen.value = false
}
</script>

<template>
  <header
    ref="root"
    class="sticky top-0 z-30 bg-slate-950/90 backdrop-blur border-b border-slate-800"
  >
    <div class="max-w-4xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
      <div class="flex items-baseline gap-2 flex-shrink-0">
        <span class="text-lg sm:text-xl font-semibold tracking-tight">MeteoCompare</span>
      </div>

      <div class="relative flex-1 max-w-md">
        <input
          v-model="query"
          type="search"
          :placeholder="`Search a city… (current: ${current.name})`"
          class="w-full bg-slate-900 border border-slate-800 focus:border-slate-600 rounded-lg px-3 py-2 text-sm placeholder:text-slate-500 outline-none"
          @focus="isOpen = true"
        />

        <div
          v-if="isOpen && (results.length || favourites.length || recent.length || isSearching || searchError)"
          class="absolute z-40 mt-1 w-full bg-slate-900 border border-slate-800 rounded-lg shadow-xl overflow-hidden"
        >
          <div v-if="isSearching" class="px-3 py-2 text-xs text-slate-500">Searching…</div>
          <div v-else-if="searchError" class="px-3 py-2 text-xs text-rose-400">{{ searchError }}</div>

          <div v-if="results.length" class="max-h-64 overflow-y-auto">
            <button
              v-for="r in results"
              :key="`${r.id}-${r.latitude}`"
              class="w-full text-left px-3 py-2 text-sm hover:bg-slate-800 flex justify-between gap-3"
              @click="pick(r)"
            >
              <span class="truncate">{{ formatLocation(r) }}</span>
              <span class="text-slate-500 tabular-nums shrink-0 text-xs">
                {{ r.latitude.toFixed(2) }}, {{ r.longitude.toFixed(2) }}
              </span>
            </button>
          </div>

          <template v-if="!query && favourites.length">
            <div class="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-slate-500">Favourites</div>
            <button
              v-for="f in favourites"
              :key="`f-${f.latitude},${f.longitude}`"
              class="w-full text-left px-3 py-1.5 text-sm hover:bg-slate-800 flex items-center gap-2"
              @click="pickSaved(f)"
            >
              <span class="text-amber-400">★</span>
              <span class="truncate">{{ f.name }}<span v-if="f.detail" class="text-slate-500">, {{ f.detail }}</span></span>
            </button>
          </template>

          <template v-if="!query && recent.length">
            <div class="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-slate-500">Recent</div>
            <button
              v-for="r in recent.slice(0, 5)"
              :key="`r-${r.latitude},${r.longitude}`"
              class="w-full text-left px-3 py-1.5 text-sm hover:bg-slate-800 flex items-center gap-2"
              @click="pickSaved(r)"
            >
              <span class="text-slate-500">↻</span>
              <span class="truncate">{{ r.name }}<span v-if="r.detail" class="text-slate-500">, {{ r.detail }}</span></span>
            </button>
          </template>
        </div>
      </div>

      <UnitsToggle />
    </div>
  </header>
</template>
