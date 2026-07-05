<script setup lang="ts">
import { nextTick, ref, watch } from "vue";

import { formatLocation, type GeocodingResult } from "@/api/geocoding";
import type { Location } from "@/composables/useLocation";

import PopoverPanel from "./PopoverPanel.vue";

const props = defineProps<{
  query: string;
  results: GeocodingResult[];
  favourites: Location[];
  recent: Location[];
  isSearching: boolean;
  searchError: string | null;
  // Global index of the keyboard-highlighted row, or -1 for none. Indices run
  // results-then-favourites-then-recent, matching LocationBar's navItems order.
  activeIndex: number;
}>();

const emit = defineEmits<{
  pickResult: [result: GeocodingResult];
  pickSaved: [location: Location];
  hover: [index: number];
}>();

// PopoverPanel is a single-root component, so its instance ref exposes the panel
// DOM node as `$el` — used to scroll the keyboard-highlighted row into view.
const root = ref<{ $el: HTMLElement } | null>(null);

// Keep the highlighted row visible as the user arrows through the scrollable list.
watch(
  () => props.activeIndex,
  async (i) => {
    if (i < 0) return;
    await nextTick();
    root.value?.$el.querySelector(`#location-option-${i}`)?.scrollIntoView({ block: "nearest" });
  },
);

// Shared highlight for the keyboard-active row — sodium inset bar over the
// hover fill, so it reads as "selected" without shifting layout.
const ACTIVE_CLASS = "bg-ink-800 shadow-[inset_2px_0_0_var(--color-sodium-300)]";
</script>

<template>
  <PopoverPanel id="location-results" ref="root" role="listbox" class="top-full right-0 left-0 col-span-full sm:col-[2/3]">
    <div v-if="isSearching" class="text-paper-400 flex items-center gap-2 px-3 py-2 font-mono text-[11px] tracking-wide">
      <span class="bg-sodium-300 size-1 animate-pulse rounded-full" /> Searching…
    </div>
    <div v-else-if="searchError" class="text-heat-400 px-3 py-2 font-mono text-[11px] tracking-wide">{{ searchError }}</div>

    <div v-if="results.length" class="max-h-64 overflow-y-auto">
      <button
        v-for="(r, i) in results"
        :id="`location-option-${i}`"
        :key="`${r.id}-${r.latitude}`"
        role="option"
        :aria-selected="activeIndex === i"
        class="group border-ink-800/60 hover:bg-ink-800 flex w-full items-center justify-between gap-3 border-b px-3 py-2 text-left text-sm last:border-b-0"
        :class="{ [ACTIVE_CLASS]: activeIndex === i }"
        @click="emit('pickResult', r)"
        @mouseenter="emit('hover', i)"
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
        v-for="(f, i) in favourites"
        :id="`location-option-${i}`"
        :key="`f-${f.latitude},${f.longitude}`"
        role="option"
        :aria-selected="activeIndex === i"
        class="hover:bg-ink-800 flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm"
        :class="{ [ACTIVE_CLASS]: activeIndex === i }"
        @click="emit('pickSaved', f)"
        @mouseenter="emit('hover', i)"
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
        v-for="(r, i) in recent.slice(0, 5)"
        :id="`location-option-${favourites.length + i}`"
        :key="`r-${r.latitude},${r.longitude}`"
        role="option"
        :aria-selected="activeIndex === favourites.length + i"
        class="hover:bg-ink-800 flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm"
        :class="{ [ACTIVE_CLASS]: activeIndex === favourites.length + i }"
        @click="emit('pickSaved', r)"
        @mouseenter="emit('hover', favourites.length + i)"
      >
        <span class="text-paper-400">↻</span>
        <span class="text-paper-100 truncate"
          >{{ r.name }}<span v-if="r.detail" class="text-paper-400">, {{ r.detail }}</span></span
        >
      </button>
    </template>
  </PopoverPanel>
</template>
