<script setup lang="ts">
import { onClickOutside } from "@vueuse/core";
import { computed, ref } from "vue";

import { useApiKey } from "@/composables/useApiKey";
import { useSettings } from "@/composables/useSettings";
import { useUnits, type PrecipitationUnit, type TemperatureUnit } from "@/composables/useUnits";

import PopoverPanel from "./PopoverPanel.vue";
import SegmentedToggle from "./SegmentedToggle.vue";

const { temp, precip } = useUnits();
const { useTrainedWeights } = useSettings();
const { apiKey } = useApiKey();

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

// SegmentedToggle models a string/number; bridge it to the boolean setting.
const trainedWeightsMode = computed<"off" | "on">({
  get: () => (useTrainedWeights.value ? "on" : "off"),
  set: (v) => {
    useTrainedWeights.value = v === "on";
  },
});
const trainedWeightsOptions = [
  { value: "off", label: "Off" },
  { value: "on", label: "On" },
] as const;
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

    <PopoverPanel v-if="isOpen" role="menu" class="right-0 w-60">
      <div class="eyebrow px-3 pt-3 pb-0.5">Units</div>

      <div class="flex items-center justify-between px-3 py-2 text-sm">
        <span class="text-paper-200 font-mono text-xs tracking-wide">Temperature</span>
        <SegmentedToggle v-model="temp" :options="tempOptions" role="radiogroup" aria-label="Temperature unit" class="font-mono text-[11px] tabular-nums" />
      </div>

      <div class="flex items-center justify-between px-3 py-2 text-sm">
        <span class="text-paper-200 font-mono text-xs tracking-wide">Precipitation</span>
        <SegmentedToggle v-model="precip" :options="precipOptions" role="radiogroup" aria-label="Precipitation unit" class="font-mono text-[11px]" />
      </div>

      <div class="eyebrow border-ink-700 border-t px-3 pt-3 pb-0.5">Forecast</div>
      <div class="flex items-center justify-between px-3 py-2 text-sm">
        <span class="text-paper-200 font-mono text-xs tracking-wide" title="Apply per-location trained weights to the aggregate where available">Trained weights</span>
        <SegmentedToggle v-model="trainedWeightsMode" :options="trainedWeightsOptions" role="radiogroup" aria-label="Use trained weights" class="font-mono text-[11px]" />
      </div>

      <div class="eyebrow border-ink-700 border-t px-3 pt-3 pb-0.5">Open-Meteo API key</div>

      <div class="px-3 py-2.5">
        <div class="flex items-stretch gap-1.5">
          <input
            v-model.lazy.trim="apiKey"
            type="password"
            autocomplete="off"
            autocapitalize="off"
            autocorrect="off"
            spellcheck="false"
            placeholder="Paste key…"
            aria-label="Open-Meteo API key"
            class="border-ink-700 bg-ink-950 text-paper-100 placeholder:text-paper-500 focus:border-sodium-300/60 min-w-0 flex-1 border px-2 py-1 font-mono text-[11px] transition-colors outline-none"
          />
          <button
            type="button"
            :disabled="!apiKey"
            class="border-ink-700 text-paper-300 hover:border-sodium-300/60 hover:text-sodium-300 disabled:hover:border-ink-700 disabled:hover:text-paper-300 border px-2.5 py-1 font-mono text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-40"
            @click="apiKey = ''"
          >
            Clear
          </button>
        </div>
        <p class="text-paper-400 mt-2 font-mono text-[10px] leading-relaxed">Optional: with a key the commercial endpoints are used, otherwise the free ones.</p>
      </div>
    </PopoverPanel>
  </div>
</template>
