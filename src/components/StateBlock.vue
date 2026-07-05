<script setup lang="ts">
// The three transient full-width states the views share: an error panel, a
// centred loading spinner with a caption, and an empty-state panel. One
// primitive so the coral error frame, the RadarSpinner block and the muted
// empty panel can't drift apart across ForecastView / VerificationView /
// TrainingView.
//
// - error:   coral-framed panel; the `[err]` prefix is fixed, the message goes
//            in the default slot.
// - loading: centred RadarSpinner over a muted caption.
// - empty:   muted panel; content (usually a short instruction) in the slot.
import RadarSpinner from "./RadarSpinner.vue";

withDefaults(
  defineProps<{
    kind: "error" | "loading" | "empty";
    /** Loading caption under the spinner. */
    caption?: string;
    /** Vertical padding for the loading state (Tailwind `py-*` class). Views use
     *  different heights (a full page vs an inline slot), so it's a prop. */
    loadingPy?: string;
    /** Error/empty text size — `text-xs` on the views, `text-[11px]` in the
     *  denser training panel. */
    textSize?: string;
    /** Relax line-height on the empty panel (multi-line instructions). */
    relaxed?: boolean;
  }>(),
  { caption: "", loadingPy: "py-32", textSize: "text-xs", relaxed: false },
);
</script>

<template>
  <div v-if="kind === 'error'" class="border-heat-500/40 bg-heat-500/5 text-heat-300 border p-4 font-mono tracking-wide" :class="textSize">
    <span class="text-heat-400">[err]</span> <slot />
  </div>

  <div v-else-if="kind === 'loading'" class="grid place-items-center gap-4" :class="loadingPy">
    <RadarSpinner />
    <p class="text-paper-400 font-mono text-[11px] tracking-wide">{{ caption }}</p>
  </div>

  <div v-else class="border-ink-700 bg-ink-900/40 text-paper-400 border p-6 text-center font-mono tracking-wide" :class="[textSize, { 'leading-relaxed': relaxed }]">
    <slot />
  </div>
</template>
