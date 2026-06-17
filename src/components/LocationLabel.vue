<script setup lang="ts">
import { computed } from "vue";

import { useLocation } from "@/composables/useLocation";

defineProps<{ name: string }>();

const { current, isFavourite, toggleFavourite } = useLocation();
const starred = computed(() => isFavourite(current.value));
</script>

<template>
  <!-- The location name + favourite toggle, shared by the forecast banner and
       the verification header so both read identically. -->
  <div class="flex min-w-0 items-center gap-2">
    <span class="text-paper-50 truncate font-mono text-sm tracking-[0.04em] sm:text-base" :title="name">{{ name }}</span>
    <button
      type="button"
      class="-m-1 shrink-0 p-1 text-sm leading-none transition-colors"
      :class="starred ? 'text-sodium-300 hover:text-sodium-200' : 'text-paper-400 hover:text-sodium-300'"
      :title="starred ? 'Remove from favourites' : 'Save as favourite'"
      :aria-pressed="starred"
      @click="toggleFavourite(current)"
    >
      {{ starred ? "★" : "☆" }}
    </button>
  </div>
</template>
