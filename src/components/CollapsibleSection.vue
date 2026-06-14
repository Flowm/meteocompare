<script setup lang="ts">
import { computed, ref } from "vue";

const props = withDefaults(
  defineProps<{
    title: string;
    /** Starts expanded unless explicitly set false. */
    defaultOpen?: boolean;
    /** Render slot content only after the section is opened at least once. */
    lazy?: boolean;
    summary?: string;
  }>(),
  { defaultOpen: true, lazy: false, summary: undefined },
);

const open = ref(props.defaultOpen);
const hasOpened = ref(props.defaultOpen);

const panelId = computed(
  () =>
    `section-${props.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")}`,
);
const shouldRender = computed(() => !props.lazy || hasOpened.value);

function toggle(): void {
  open.value = !open.value;
  if (open.value) hasOpened.value = true;
}
</script>

<template>
  <section>
    <div class="mb-1.5 flex flex-wrap items-center justify-between gap-2 sm:mb-3">
      <button type="button" class="group flex items-center gap-2 text-left" :aria-expanded="open" :aria-controls="panelId" @click="toggle">
        <span
          class="border-ink-700 bg-ink-900/60 text-paper-300 group-hover:border-sodium-300/60 group-hover:text-sodium-200 flex size-5 items-center justify-center border transition-colors"
        >
          <svg class="size-3 transition-transform" :class="{ 'rotate-90': open }" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path d="M4.5 2.75L7.75 6L4.5 9.25" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </span>
        <span class="eyebrow group-hover:text-paper-100 transition-colors">{{ title }}</span>
      </button>
      <span v-if="summary" class="text-paper-400 font-mono text-[10px] tracking-wide">{{ summary }}</span>
    </div>

    <div v-if="shouldRender" v-show="open" :id="panelId">
      <slot />
    </div>
  </section>
</template>
