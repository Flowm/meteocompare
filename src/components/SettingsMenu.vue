<script setup lang="ts">
import { onClickOutside } from "@vueuse/core";
import { ref } from "vue";

import { useUnits, type PrecipitationUnit, type TemperatureUnit } from "@/composables/useUnits";

const { temp, precip } = useUnits();

const isOpen = ref(false);
const root = ref<HTMLElement | null>(null);

onClickOutside(root, () => (isOpen.value = false));

const tempOptions: { value: TemperatureUnit; label: string }[] = [
  { value: "c", label: "°C" },
  { value: "f", label: "°F" },
];
const precipOptions: { value: PrecipitationUnit; label: string }[] = [
  { value: "mm", label: "mm" },
  { value: "in", label: "in" },
];
</script>

<template>
  <div ref="root" class="relative">
    <button
      type="button"
      class="border-ink-700 bg-ink-900/60 text-paper-300 hover:border-sodium-300/60 hover:text-sodium-300 flex h-9 w-9 items-center justify-center border transition-colors"
      :aria-expanded="isOpen"
      aria-haspopup="true"
      title="Settings"
      @click="isOpen = !isOpen"
    >
      <svg
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
        <path
          d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
        />
      </svg>
      <span class="sr-only">Settings</span>
    </button>

    <div v-if="isOpen" class="panel-in border-ink-700 bg-ink-900 absolute right-0 z-40 mt-1 w-60 overflow-hidden border shadow-2xl shadow-black/60" role="menu">
      <div class="border-ink-700 text-paper-400 border-b px-3 py-2 font-mono text-[11px] tracking-wide"><span class="text-sodium-300">·</span> Units</div>

      <div class="flex items-center justify-between px-3 py-2.5 text-sm">
        <span class="text-paper-200 font-mono text-xs tracking-wide">Temperature</span>
        <div class="border-ink-700 flex border" role="radiogroup" aria-label="Temperature unit">
          <button
            v-for="opt in tempOptions"
            :key="opt.value"
            type="button"
            role="radio"
            :aria-checked="temp === opt.value"
            class="px-3 py-1 font-mono text-[11px] tabular-nums transition-colors"
            :class="temp === opt.value ? 'bg-sodium-300/15 text-sodium-200' : 'text-paper-300 hover:bg-ink-800 hover:text-paper-50'"
            @click="temp = opt.value"
          >
            {{ opt.label }}
          </button>
        </div>
      </div>

      <div class="border-ink-700/60 flex items-center justify-between border-t px-3 py-2.5 text-sm">
        <span class="text-paper-200 font-mono text-xs tracking-wide">Precipitation</span>
        <div class="border-ink-700 flex border" role="radiogroup" aria-label="Precipitation unit">
          <button
            v-for="opt in precipOptions"
            :key="opt.value"
            type="button"
            role="radio"
            :aria-checked="precip === opt.value"
            class="px-3 py-1 font-mono text-[11px] transition-colors"
            :class="precip === opt.value ? 'bg-sodium-300/15 text-sodium-200' : 'text-paper-300 hover:bg-ink-800 hover:text-paper-50'"
            @click="precip = opt.value"
          >
            {{ opt.label }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
