<script setup lang="ts" generic="T extends string | number">
// The segmented pill-toggle used across the app: a bordered row of options
// where the selected one gets the sodium highlight and the rest get the muted
// hover treatment. Single-sources the active/inactive class pair
// (`bg-sodium-300/15 text-sodium-200` / `text-paper-300 hover:bg-ink-800
// hover:text-paper-50`) that was copied across the settings menu, the
// verification mode/cycle toggles and the chart window selector.
//
// The caller supplies the options and binds v-model. Display (inline vs block
// flex), inter-segment dividers and per-button padding are props so each call
// site keeps its exact layout; extra classes (font, ml-auto, shrink-0, …) fall
// through to the root row.
withDefaults(
  defineProps<{
    /** Selectable segments, in display order. */
    options: readonly { value: T; label: string }[];
    /** Row display: block `flex` (default) or `inline-flex`. */
    inline?: boolean;
    /** Draw a divider (`border-l`) between adjacent segments. */
    divided?: boolean;
    /** Per-button padding (Tailwind classes). */
    padding?: string;
    /** ARIA role for the row — `radiogroup` where each segment is a radio. */
    role?: string;
  }>(),
  { inline: false, divided: false, padding: "px-3 py-1", role: undefined },
);

const model = defineModel<T>({ required: true });
</script>

<template>
  <div class="border-ink-700 border" :class="inline ? 'inline-flex' : 'flex'" :role="role">
    <button
      v-for="(opt, i) in options"
      :key="opt.value"
      type="button"
      :role="role === 'radiogroup' ? 'radio' : undefined"
      :aria-checked="role === 'radiogroup' ? model === opt.value : undefined"
      class="transition-colors"
      :class="[
        padding,
        divided && i > 0 ? 'border-ink-700 border-l' : '',
        model === opt.value ? 'bg-sodium-300/15 text-sodium-200' : 'text-paper-300 hover:bg-ink-800 hover:text-paper-50',
      ]"
      @click="model = opt.value"
    >
      {{ opt.label }}
    </button>
  </div>
</template>
