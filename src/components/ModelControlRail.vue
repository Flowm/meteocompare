<script setup lang="ts">
import { computed, ref } from "vue";

import type { ModelDef } from "@/domain/models";

import { paletteFor } from "./chartOption";

const props = defineProps<{
  models: ModelDef[];
  modelHasData: Record<string, boolean>;
  enabledModels: ReadonlySet<string>;
  allModelsActive: boolean;
}>();

const emit = defineEmits<{
  toggleAll: [];
  toggleModel: [id: string];
}>();

const expanded = ref(false);
const enabledCount = computed(() => props.models.filter((m) => props.enabledModels.has(m.id)).length);
</script>

<template>
  <div v-if="models.length > 0" class="flex items-start gap-2">
    <span class="text-paper-400 w-14 shrink-0 pt-[5px]">Models</span>
    <div class="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        class="border px-2 py-1 transition-colors"
        :class="allModelsActive ? 'border-ink-600 bg-ink-800 text-paper-50' : 'border-ink-700 bg-ink-950 text-paper-400 hover:text-paper-200'"
        :aria-pressed="allModelsActive"
        :title="allModelsActive ? 'Disable all models' : 'Enable all models'"
        @click="emit('toggleAll')"
      >
        All
      </button>
      <span class="bg-ink-700 mx-1 hidden h-4 w-px self-center sm:inline-block" aria-hidden="true" />
      <button
        type="button"
        class="border-ink-700 bg-ink-950 text-paper-400 hover:text-paper-200 flex items-center gap-1.5 border px-2 py-1 transition-colors"
        :aria-expanded="expanded"
        :title="expanded ? 'Hide model list' : 'Show all models'"
        @click="expanded = !expanded"
      >
        <span v-if="enabledCount > 0 && !allModelsActive" class="text-paper-200">{{ enabledCount }}/{{ models.length }} on</span>
        <span v-else>{{ models.length }} models</span>
        <svg class="text-paper-300 size-3 transition-transform" :class="{ 'rotate-180': expanded }" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
      <template v-if="expanded">
        <button
          v-for="m in models"
          :key="m.id"
          type="button"
          class="flex items-center gap-1.5 border px-2 py-1 transition-colors"
          :class="
            !modelHasData[m.id]
              ? 'border-ink-700/50 bg-ink-950 text-paper-500 cursor-not-allowed line-through opacity-50'
              : enabledModels.has(m.id)
                ? 'border-ink-600 bg-ink-800 text-paper-50'
                : 'border-ink-700 bg-ink-950 text-paper-400 hover:text-paper-200'
          "
          :disabled="!modelHasData[m.id]"
          :title="modelHasData[m.id] ? `${m.provider} · ${m.description}` : `${m.provider} · no data for this variable`"
          @click="emit('toggleModel', m.id)"
        >
          <span class="inline-block size-2" :style="{ backgroundColor: paletteFor(m.id) }" />{{ m.label }}
        </button>
      </template>
    </div>
  </div>
</template>
