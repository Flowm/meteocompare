<script setup lang="ts">
// The run-identity picker on the verification page: a run date, plus (in
// single-run mode) the run cycle. A run is identified by date + cycle
// (CONTEXT.md), so the two live together. State stays in the view; this only
// renders the inputs and emits changes. The date label switches between "Run
// date" and "End date" because the single-run date picker doubles as the
// run-date window end when gathering a multi-run sample.
defineProps<{
  runDate: string;
  cycle: number;
  /** Earliest selectable date (single-runs archive retention floor). */
  min: string;
  /** Latest selectable date (truth-lag bound). */
  max: string;
  /** Selectable run cycles (00 / 06 / 12 / 18 Z). */
  cycles: readonly number[];
  /** Show the cycle select — off in multi-run mode where the window spans cycles. */
  showCycle: boolean;
  /** The date input's label — "Run date" (single) or "End date" (multi). */
  dateLabel: string;
}>();

const emit = defineEmits<{
  "update:runDate": [value: string];
  "update:cycle": [value: number];
}>();
</script>

<template>
  <div class="flex flex-col items-end gap-1.5">
    <label class="text-paper-300 flex items-center gap-2.5 font-mono text-[11px] tracking-wide">
      <span>{{ dateLabel }}</span>
      <input
        type="date"
        :value="runDate"
        :min="min"
        :max="max"
        class="border-ink-700 bg-ink-950 text-paper-50 focus:border-sodium-300/60 border px-2 py-1 font-mono text-base tracking-normal outline-none sm:text-xs"
        @change="emit('update:runDate', ($event.target as HTMLInputElement).value)"
      />
    </label>
    <label v-if="showCycle" class="text-paper-300 flex items-center gap-2.5 font-mono text-[11px] tracking-wide">
      <span>Cycle</span>
      <select
        :value="String(cycle)"
        class="border-ink-700 bg-ink-950 text-paper-50 focus:border-sodium-300/60 border px-2 py-1 font-mono text-base tracking-normal outline-none sm:text-xs"
        @change="emit('update:cycle', Number(($event.target as HTMLSelectElement).value))"
      >
        <option v-for="h in cycles" :key="h" :value="String(h)">{{ String(h).padStart(2, "0") }}Z</option>
      </select>
    </label>
    <slot name="hint" />
  </div>
</template>
