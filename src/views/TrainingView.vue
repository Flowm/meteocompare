<script setup lang="ts">
import { computed, ref, watch } from "vue";

import { fitWeights, MIN_TRAIN_RUNS, MIN_VAL_RUNS, type FitResult } from "@/analysis/learnedWeights";
import { clearWeights, loadWeights, saveWeights, type StoredWeights } from "@/analysis/learnedWeightsStore";
import type { LocationSample } from "@/analysis/sample";
import { loadSample, sampleKey } from "@/analysis/sampleStore";
import AppFooter from "@/components/AppFooter.vue";
import { paletteFor } from "@/components/chartOption";
import LocationBar from "@/components/LocationBar.vue";
import LocationLabel from "@/components/LocationLabel.vue";
import RadarSpinner from "@/components/RadarSpinner.vue";
import { useLocation } from "@/composables/useLocation";
import { useSettings } from "@/composables/useSettings";
import { getModel } from "@/domain/models";

const { current } = useLocation();
const { useTrainedWeights } = useSettings();

const MIN_RUNS = MIN_TRAIN_RUNS + MIN_VAL_RUNS;

const sample = ref<LocationSample | null>(null);
const sampleLoading = ref(false);
const result = ref<FitResult | null>(null);
const training = ref(false);
const stored = ref<StoredWeights | null>(null);
const justSaved = ref(false);

const locationLabel = computed(() => {
  const loc = current.value;
  return loc.detail ? `${loc.name}, ${loc.detail}` : loc.name;
});
const runCount = computed(() => sample.value?.runs.length ?? 0);

/** Per-model multiplier rows, sorted highest-trust first. */
const rows = computed(() =>
  Object.entries(result.value?.multipliers ?? {})
    .map(([id, mult]) => ({ id, mult, label: getModel(id)?.label ?? id, color: paletteFor(id) }))
    .toSorted((a, b) => b.mult - a.mult),
);

const fmt1 = (n: number): string => (Number.isFinite(n) ? n.toFixed(1) : "—");
const fmt2 = (n: number): string => (Number.isFinite(n) ? n.toFixed(2) : "—");

async function reload(): Promise<void> {
  const lat = current.value.latitude;
  const lon = current.value.longitude;
  result.value = null;
  justSaved.value = false;
  stored.value = loadWeights(lat, lon);
  sampleLoading.value = true;
  const key = sampleKey(lat, lon);
  const loaded = await loadSample(key);
  // Ignore a stale load if the location changed while awaiting.
  if (sampleKey(current.value.latitude, current.value.longitude) === key) {
    sample.value = loaded;
    sampleLoading.value = false;
  }
}
watch(current, reload, { immediate: true });

async function train(): Promise<void> {
  if (!sample.value) return;
  training.value = true;
  justSaved.value = false;
  await new Promise((r) => setTimeout(r, 16)); // let the spinner paint before the synchronous fit
  try {
    result.value = fitWeights(sample.value);
  } finally {
    training.value = false;
  }
}

function apply(): void {
  const r = result.value;
  if (!r?.ok) return;
  saveWeights(current.value.latitude, current.value.longitude, { multipliers: r.multipliers, trainedAt: new Date().toISOString(), improvement: r.improvement });
  stored.value = loadWeights(current.value.latitude, current.value.longitude);
  justSaved.value = true;
}

function clear(): void {
  clearWeights(current.value.latitude, current.value.longitude);
  stored.value = null;
  justSaved.value = false;
}
</script>

<template>
  <div class="flex min-h-screen flex-col">
    <LocationBar />

    <main class="mx-auto w-full max-w-3xl flex-1 space-y-6 px-4 py-8 sm:px-6">
      <header class="border-ink-700 bg-ink-900/60 border p-5 sm:p-6">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 class="eyebrow mb-2">Training</h1>
            <LocationLabel :name="locationLabel" />
          </div>
          <p class="text-paper-400 font-mono text-[11px] tracking-wide">
            Trained weights: <span :class="useTrainedWeights ? 'text-predictability-high' : 'text-paper-500'">{{ useTrainedWeights ? "applied" : "off" }}</span>
            <span v-if="stored" class="text-paper-500"> · stored here</span>
          </p>
        </div>
        <p class="border-ink-700 text-paper-400 mt-4 border-t pt-3 font-mono text-[11px] leading-relaxed tracking-wide">
          Fit per-model weight multipliers from this location's stored runs, validated on held-out recent runs. The heuristic weighting stays the default — turn on
          <span class="text-paper-200">Trained weights</span> in settings to apply a saved fit. Uncalibrated and per-location; see ADR 0007.
        </p>
      </header>

      <div v-if="sampleLoading" class="grid place-items-center gap-4 py-24">
        <RadarSpinner />
        <p class="text-paper-400 font-mono text-[11px] tracking-wide">Loading stored data…</p>
      </div>

      <div v-else-if="runCount === 0" class="border-ink-700 bg-ink-900/40 text-paper-400 border p-6 text-center font-mono text-[11px] leading-relaxed tracking-wide">
        No stored runs for this location yet. Open
        <RouterLink to="/verify" class="text-sodium-200 hover:text-sodium-100">Verify → Multi-run</RouterLink>, gather a window of runs, and press
        <span class="text-paper-200">Store data</span>.
      </div>

      <div v-else class="space-y-6">
        <div class="border-ink-700 bg-ink-900/40 flex flex-wrap items-center gap-x-5 gap-y-3 border p-4">
          <p class="text-paper-300 font-mono text-[11px] tracking-wide">
            {{ runCount }} runs stored<span v-if="runCount < MIN_RUNS" class="text-heat-300"> · need ≥ {{ MIN_RUNS }} to train</span>
          </p>
          <button
            type="button"
            :disabled="training || runCount < MIN_RUNS"
            class="border-sodium-300/40 bg-sodium-300/10 text-sodium-200 hover:bg-sodium-300/20 border px-3 py-1 font-mono text-xs tracking-wide transition-colors disabled:opacity-40"
            @click="train"
          >
            {{ training ? "Training…" : "Train" }}
          </button>
        </div>

        <div v-if="training" class="grid place-items-center gap-4 py-16">
          <RadarSpinner />
          <p class="text-paper-400 font-mono text-[11px] tracking-wide">Fitting weights…</p>
        </div>

        <template v-else-if="result">
          <div v-if="!result.ok" class="border-heat-500/40 bg-heat-500/5 text-heat-300 border p-4 font-mono text-[11px] tracking-wide">
            <span class="text-heat-400">[err]</span> {{ result.reason }}
          </div>

          <template v-else>
            <!-- Train/validation summary -->
            <div class="border-ink-700 bg-ink-700/60 grid grid-cols-2 gap-px border sm:grid-cols-4">
              <div class="bg-ink-900 p-3">
                <p class="text-paper-500 font-mono text-[10px] tracking-wide">Train / val runs</p>
                <p class="text-paper-100 mt-1 font-mono text-sm tabular-nums">{{ result.nTrain }} / {{ result.nVal }}</p>
              </div>
              <div class="bg-ink-900 p-3">
                <p class="text-paper-500 font-mono text-[10px] tracking-wide">Heuristic (val)</p>
                <p class="text-paper-100 mt-1 font-mono text-sm tabular-nums">{{ fmt1(result.valBaselineComposite) }}</p>
              </div>
              <div class="bg-ink-900 p-3">
                <p class="text-paper-500 font-mono text-[10px] tracking-wide">Trained (val)</p>
                <p class="text-paper-100 mt-1 font-mono text-sm tabular-nums">{{ fmt1(result.valComposite) }}</p>
              </div>
              <div class="bg-ink-900 p-3">
                <p class="text-paper-500 font-mono text-[10px] tracking-wide">Improvement</p>
                <p class="mt-1 font-mono text-sm tabular-nums" :class="result.improvement > 0 ? 'text-predictability-high' : 'text-heat-300'">
                  {{ result.improvement >= 0 ? "+" : "" }}{{ fmt1(result.improvement) }}
                </p>
              </div>
            </div>

            <p v-if="result.improvement <= 0" class="text-paper-400 font-mono text-[11px] leading-relaxed tracking-wide">
              The fit didn't beat the heuristic on held-out runs — gather more data, or keep the default weighting. You can still store it, but applying it isn't recommended.
            </p>

            <!-- Per-model multipliers -->
            <div class="border-ink-700 bg-ink-900/40 overflow-x-auto border">
              <table class="w-full border-collapse font-mono text-[11px] tabular-nums">
                <thead>
                  <tr class="text-paper-400 text-[10px] tracking-wide">
                    <th scope="col" class="border-ink-700/60 border-b px-3 py-2 text-left font-normal">Model</th>
                    <th scope="col" title="Multiplier on the heuristic weight (1.0 = unchanged)" class="border-ink-700/60 border-b px-3 py-2 text-right font-normal">Weight ×</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in rows" :key="row.id">
                    <th scope="row" class="border-ink-700/40 border-b px-3 py-1.5 text-left font-normal">
                      <span class="flex items-center gap-2">
                        <span class="inline-block size-2 shrink-0" :style="{ backgroundColor: row.color }" />
                        <span class="text-paper-200">{{ row.label }}</span>
                      </span>
                    </th>
                    <td
                      class="border-ink-700/40 border-b px-3 py-1.5 text-right"
                      :class="row.mult > 1.02 ? 'text-predictability-high' : row.mult < 0.98 ? 'text-heat-300' : 'text-paper-400'"
                    >
                      {{ fmt2(row.mult) }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div class="flex flex-wrap items-center gap-3">
              <button
                type="button"
                class="border-ink-600 bg-ink-800 text-paper-100 hover:bg-ink-700 border px-3 py-1 font-mono text-xs tracking-wide transition-colors"
                @click="apply"
              >
                {{ stored ? "Update stored weights" : "Apply + store" }}
              </button>
              <button
                v-if="stored"
                type="button"
                class="border-ink-700 text-paper-300 hover:text-paper-50 border px-3 py-1 font-mono text-xs tracking-wide transition-colors"
                @click="clear"
              >
                Clear stored
              </button>
              <p v-if="justSaved" class="text-predictability-high font-mono text-[11px] tracking-wide">
                Stored. {{ useTrainedWeights ? "Applied to the forecast." : "Turn on Trained weights in settings to apply." }}
              </p>
            </div>
          </template>
        </template>
      </div>
    </main>

    <AppFooter>Trained weights <span class="text-sodium-300">·</span> per location, on-device</AppFooter>
  </div>
</template>
