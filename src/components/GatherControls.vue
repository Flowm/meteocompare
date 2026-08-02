<script setup lang="ts">
// The multi-run gather form on the verification page. State stays in the view;
// this only renders and emits. `durationDays` and `cyclesPerDay` are two-way so
// the view keeps owning them; the rest are one-way status props.
import SegmentedToggle from "./SegmentedToggle.vue";

const CYCLES_OPTIONS = [
  { value: 1, label: "00Z only" },
  { value: 4, label: "All cycles" },
] as const;

defineProps<{
  gathering: boolean;
  progress: { done: number; total: number };
  /** Runs gathered in-memory (not yet stored). */
  gatheredCount: number;
  /** Runs stored for this location after the last store(), else null. */
  storedCount: number | null;
  error: string | null;
}>();

const durationDays = defineModel<number>("durationDays", { required: true });
const cyclesPerDay = defineModel<1 | 4>("cyclesPerDay", { required: true });

const emit = defineEmits<{
  gather: [];
  store: [];
  cancel: [];
}>();
</script>

<template>
  <div class="border-ink-700 space-y-3 border-t pt-4">
    <div class="flex flex-wrap items-center gap-x-5 gap-y-3">
      <label class="text-paper-300 flex items-center gap-2.5 font-mono text-[11px] tracking-wide">
        <span>Duration (days)</span>
        <input
          v-model.number="durationDays"
          type="number"
          min="1"
          max="120"
          class="border-ink-700 bg-ink-950 text-paper-50 focus:border-sodium-300/60 w-20 border px-2 py-1 font-mono text-base tracking-normal outline-none sm:text-xs"
        />
      </label>
      <div class="text-paper-300 flex items-center gap-2.5 font-mono text-[11px] tracking-wide">
        <span>Runs / day</span>
        <SegmentedToggle v-model="cyclesPerDay" :options="CYCLES_OPTIONS" inline divided padding="px-2.5 py-1" />
      </div>
      <button
        type="button"
        :disabled="gathering"
        class="border-sodium-300/40 bg-sodium-300/10 text-sodium-200 hover:bg-sodium-300/20 border px-3 py-1 font-mono text-xs tracking-wide transition-colors disabled:opacity-40"
        @click="emit('gather')"
      >
        {{ gathering ? "Gathering…" : "Gather" }}
      </button>
      <button
        v-if="gathering"
        type="button"
        class="border-ink-700 text-paper-300 hover:text-paper-50 border px-3 py-1 font-mono text-xs tracking-wide transition-colors"
        @click="emit('cancel')"
      >
        Cancel
      </button>
      <button
        type="button"
        :disabled="!gatheredCount || gathering"
        class="border-ink-600 bg-ink-800 text-paper-100 hover:bg-ink-700 border px-3 py-1 font-mono text-xs tracking-wide transition-colors disabled:opacity-40"
        @click="emit('store')"
      >
        Store data
      </button>
    </div>
    <p v-if="gathering || progress.total" class="text-paper-400 font-mono text-[11px] tracking-wide">
      Gathered {{ gatheredCount }} runs · {{ progress.done }}/{{ progress.total }} fetched
    </p>
    <p v-if="storedCount != null" class="text-predictability-high font-mono text-[11px] tracking-wide">Stored {{ storedCount }} runs for this location.</p>
    <p v-if="error" class="text-heat-300 font-mono text-[11px] tracking-wide"><span class="text-heat-400">[err]</span> {{ error }}</p>
  </div>
</template>
