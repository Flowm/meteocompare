<script setup lang="ts">
import { formatLocation, type GeocodingResult } from "@/api/geocoding";
import type { Location } from "@/composables/useLocation";

const props = defineProps<{
  query: string;
  results: GeocodingResult[];
  favourites: Location[];
  recent: Location[];
  isSearching: boolean;
  searchError: string | null;
}>();

const emit = defineEmits<{
  pickResult: [result: GeocodingResult];
  pickSaved: [location: Location];
}>();
</script>

<template>
  <div class="panel-in border-ink-700 bg-ink-900 absolute top-full right-0 left-0 z-40 col-span-full mt-1 overflow-hidden border shadow-2xl shadow-black/60 sm:col-[2/3]">
    <div v-if="isSearching" class="text-paper-400 flex items-center gap-2 px-3 py-2 font-mono text-[11px] tracking-wide">
      <span class="bg-sodium-300 size-1 animate-pulse rounded-full" /> Searching…
    </div>
    <div v-else-if="searchError" class="text-heat-400 px-3 py-2 font-mono text-[11px] tracking-wide">{{ searchError }}</div>

    <div v-if="results.length" class="max-h-64 overflow-y-auto">
      <button
        v-for="r in results"
        :key="`${r.id}-${r.latitude}`"
        class="group border-ink-800/60 hover:bg-ink-800 flex w-full items-center justify-between gap-3 border-b px-3 py-2 text-left text-sm last:border-b-0"
        @click="emit('pickResult', r)"
      >
        <span class="text-paper-100 group-hover:text-paper-50 truncate">{{ formatLocation(r) }}</span>
        <span class="text-paper-400 shrink-0 font-mono text-[10px] tabular-nums">
          {{ r.latitude.toFixed(2) }}<span class="text-sodium-300/60">°</span>
          <span class="text-paper-500 mx-1">,</span>
          {{ r.longitude.toFixed(2) }}<span class="text-sodium-300/60">°</span>
        </span>
      </button>
    </div>

    <template v-if="!props.query && favourites.length">
      <div class="border-ink-800 text-paper-400 border-t px-3 pt-2 pb-1 font-mono text-[11px] tracking-wide"><span class="text-sodium-300">★</span> Favourites</div>
      <button
        v-for="f in favourites"
        :key="`f-${f.latitude},${f.longitude}`"
        class="hover:bg-ink-800 flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm"
        @click="emit('pickSaved', f)"
      >
        <span class="text-sodium-300">★</span>
        <span class="text-paper-100 truncate"
          >{{ f.name }}<span v-if="f.detail" class="text-paper-400">, {{ f.detail }}</span></span
        >
      </button>
    </template>

    <template v-if="!props.query && recent.length">
      <div class="border-ink-800 text-paper-400 border-t px-3 pt-2 pb-1 font-mono text-[11px] tracking-wide"><span class="text-paper-300">↻</span> Recent</div>
      <button
        v-for="r in recent.slice(0, 5)"
        :key="`r-${r.latitude},${r.longitude}`"
        class="hover:bg-ink-800 flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm"
        @click="emit('pickSaved', r)"
      >
        <span class="text-paper-400">↻</span>
        <span class="text-paper-100 truncate"
          >{{ r.name }}<span v-if="r.detail" class="text-paper-400">, {{ r.detail }}</span></span
        >
      </button>
    </template>
  </div>
</template>
