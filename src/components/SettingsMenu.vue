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
      class="flex items-center justify-center rounded-md border border-slate-800 p-2 text-slate-300 transition-colors hover:border-slate-600 hover:text-sky-300"
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
        stroke-width="2"
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

    <div v-if="isOpen" class="absolute right-0 z-40 mt-1 w-56 overflow-hidden rounded-lg border border-slate-800 bg-slate-900 shadow-xl" role="menu">
      <div class="px-3 pt-2 pb-1 text-[10px] tracking-wider text-slate-500 uppercase">Units</div>

      <div class="flex items-center justify-between px-3 py-2 text-sm">
        <span class="text-slate-300">Temperature</span>
        <div class="flex gap-1" role="radiogroup" aria-label="Temperature unit">
          <button
            v-for="opt in tempOptions"
            :key="opt.value"
            type="button"
            role="radio"
            :aria-checked="temp === opt.value"
            class="rounded-md border px-2 py-1 text-xs tabular-nums transition-colors"
            :class="temp === opt.value ? 'border-sky-600 bg-sky-600/20 text-sky-200' : 'border-slate-800 text-slate-300 hover:border-slate-600'"
            @click="temp = opt.value"
          >
            {{ opt.label }}
          </button>
        </div>
      </div>

      <div class="flex items-center justify-between px-3 pt-1 pb-3 text-sm">
        <span class="text-slate-300">Precipitation</span>
        <div class="flex gap-1" role="radiogroup" aria-label="Precipitation unit">
          <button
            v-for="opt in precipOptions"
            :key="opt.value"
            type="button"
            role="radio"
            :aria-checked="precip === opt.value"
            class="rounded-md border px-2 py-1 text-xs transition-colors"
            :class="precip === opt.value ? 'border-sky-600 bg-sky-600/20 text-sky-200' : 'border-slate-800 text-slate-300 hover:border-slate-600'"
            @click="precip = opt.value"
          >
            {{ opt.label }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
