<script setup lang="ts">
import { computed } from "vue";

import { REACH_PRESETS_KM } from "@/analysis/learnedWeightsStore";
import AppFooter from "@/components/AppFooter.vue";
import CollapsibleSection from "@/components/CollapsibleSection.vue";
import LocationBar from "@/components/LocationBar.vue";
import LocationLabel from "@/components/LocationLabel.vue";
import { accent, label as scorecardLabel } from "@/components/scorecardFormat";
import StateBlock from "@/components/StateBlock.vue";
import Swatch from "@/components/Swatch.vue";
import { useLocation } from "@/composables/useLocation";
import { useSettings } from "@/composables/useSettings";
import { MIN_RUNS, useTrainingFlow } from "@/composables/useTrainingFlow";

const { current, label: locationLabel, setLocation } = useLocation();
const { useTrainedWeights } = useSettings();

// The flow — load stored sample, fit, persist, inventory — lives in the
// testable useTrainingFlow module; this view renders its state.
const { sampleLoading, result, training, justSaved, runCount, currentKey, stored, overview, train, apply, setEntryReach: onReachChange, removeEntry } = useTrainingFlow(current);

const reachLabel = (km: number): string => (km <= 0 ? "This point only" : `${km} km`);
const fmtDate = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
};

/** Per-model multiplier rows, sorted highest-trust first. Row label + swatch
 *  colour come from the shared scorecardFormat helpers (these are all model rows
 *  — no aggregate — so `label(id, false)` / `accent(id, false)`), so they can't
 *  drift from the scorecard surfaces. */
const rows = computed(() =>
  Object.entries(result.value?.multipliers ?? {})
    .map(([id, mult]) => ({ id, mult, label: scorecardLabel(id, false), color: accent(id, false) }))
    .toSorted((a, b) => b.mult - a.mult),
);

const fmt1 = (n: number): string => (Number.isFinite(n) ? n.toFixed(1) : "—");
const fmt2 = (n: number): string => (Number.isFinite(n) ? n.toFixed(2) : "—");

function jumpTo(row: { name: string; detail?: string; latitude?: number; longitude?: number }): void {
  if (row.latitude == null || row.longitude == null) return;
  setLocation({ name: row.name, detail: row.detail, latitude: row.latitude, longitude: row.longitude });
}
</script>

<template>
  <div class="flex min-h-screen flex-col">
    <LocationBar />

    <main class="mx-auto w-full max-w-3xl flex-1 space-y-8 px-4 py-8 sm:px-6">
      <CollapsibleSection title="Training" :summary="locationLabel">
        <div class="space-y-6">
          <div class="border-ink-700 bg-ink-900/60 border p-5 sm:p-6">
            <div class="flex flex-wrap items-start justify-between gap-4">
              <LocationLabel :name="locationLabel" />
              <p class="text-paper-400 font-mono text-[11px] tracking-wide">
                Trained weights: <span :class="useTrainedWeights ? 'text-predictability-high' : 'text-paper-500'">{{ useTrainedWeights ? "applied" : "off" }}</span>
                <span v-if="stored" class="text-paper-500"> · stored here</span>
              </p>
            </div>
            <p class="border-ink-700 text-paper-400 mt-4 border-t pt-3 font-mono text-[11px] leading-relaxed tracking-wide">
              Fit per-model weight multipliers from this location's stored runs, validated on held-out recent runs. The heuristic weighting stays the default — turn on
              <span class="text-paper-200">Trained weights</span> in settings to apply a saved fit. Uncalibrated and per-location; see ADR 0007.
            </p>
          </div>

          <StateBlock v-if="sampleLoading" kind="loading" loading-py="py-24" caption="Loading stored data…" />

          <StateBlock v-else-if="runCount === 0" kind="empty" text-size="text-[11px]" relaxed>
            No stored runs for this location yet. Open
            <RouterLink to="/verify" class="text-sodium-200 hover:text-sodium-100">Verify → Multi-run</RouterLink>, gather a window of runs, and press
            <span class="text-paper-200">Store data</span>.
          </StateBlock>

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

            <StateBlock v-if="training" kind="loading" loading-py="py-16" caption="Fitting weights…" />

            <template v-else-if="result">
              <StateBlock v-if="!result.ok" kind="error" text-size="text-[11px]">{{ result.reason }}</StateBlock>

              <template v-else>
                <!-- Train/validation summary -->
                <div class="border-ink-700 bg-ink-700/60 grid grid-cols-2 gap-px border sm:grid-cols-4">
                  <div class="bg-ink-900 p-3">
                    <p
                      title="Stored runs are split by date: older runs fit the weights, the most recent are held out to validate them."
                      class="text-paper-500 font-mono text-[10px] tracking-wide"
                    >
                      Train / val runs
                    </p>
                    <p class="text-paper-100 mt-1 font-mono text-sm tabular-nums">{{ result.nTrain }} / {{ result.nVal }}</p>
                  </div>
                  <div class="bg-ink-900 p-3">
                    <p
                      title="Composite score (0–100) of the default heuristic aggregate on the held-out validation runs."
                      class="text-paper-500 font-mono text-[10px] tracking-wide"
                    >
                      Heuristic (val)
                    </p>
                    <p class="text-paper-100 mt-1 font-mono text-sm tabular-nums">{{ fmt1(result.valBaselineComposite) }}</p>
                  </div>
                  <div class="bg-ink-900 p-3">
                    <p title="Composite score (0–100) of the trained aggregate on the same held-out validation runs." class="text-paper-500 font-mono text-[10px] tracking-wide">
                      Trained (val)
                    </p>
                    <p class="text-paper-100 mt-1 font-mono text-sm tabular-nums">{{ fmt1(result.valComposite) }}</p>
                  </div>
                  <div class="bg-ink-900 p-3">
                    <p
                      title="Trained minus heuristic composite on the validation runs — positive means the fit helped out-of-sample."
                      class="text-paper-500 font-mono text-[10px] tracking-wide"
                    >
                      Improvement
                    </p>
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
                        <th scope="col" title="Multiplier on the heuristic weight (1.0 = unchanged)" class="border-ink-700/60 border-b px-3 py-2 text-right font-normal">
                          Weight ×
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="row in rows" :key="row.id">
                        <th scope="row" class="border-ink-700/40 border-b px-3 py-1.5 text-left font-normal">
                          <span class="flex items-center gap-2">
                            <Swatch :color="row.color" class="shrink-0" />
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
                    @click="removeEntry(currentKey)"
                  >
                    Clear stored
                  </button>
                  <p v-if="justSaved" class="text-predictability-high font-mono text-[11px] tracking-wide">
                    Stored. {{ useTrainedWeights ? "Applied to the forecast." : "Turn on Trained weights in settings to apply." }}
                  </p>
                </div>

                <!-- Reach: apply this location's fit to nearby locations. -->
                <div v-if="stored" class="border-ink-700 bg-ink-900/40 flex flex-wrap items-center gap-x-3 gap-y-2 border p-4">
                  <label for="reach-current" class="text-paper-300 font-mono text-[11px] tracking-wide">Reach</label>
                  <select
                    id="reach-current"
                    class="border-ink-600 bg-ink-800 text-paper-100 border px-2 py-1 font-mono text-[11px] tracking-wide"
                    :value="stored.radiusKm ?? 0"
                    @change="onReachChange(currentKey, Number(($event.target as HTMLSelectElement).value))"
                  >
                    <option v-for="km in REACH_PRESETS_KM" :key="km" :value="km">{{ reachLabel(km) }}</option>
                  </select>
                  <span class="text-paper-500 font-mono text-[11px] leading-relaxed tracking-wide">
                    Apply these weights to any location within this distance of {{ locationLabel }}.
                  </span>
                </div>
              </template>
            </template>
          </div>
        </div>
      </CollapsibleSection>

      <!-- Device-wide stored-weights inventory. -->
      <CollapsibleSection title="Trained weights on this device" :summary="overview.length ? `${overview.length} stored` : undefined">
        <p class="text-paper-500 mb-4 font-mono text-[11px] leading-relaxed tracking-wide">
          Every location with a stored fit. Give a fit a reach to apply it to nearby locations; where a location has no fit of its own, the nearest covering fit is used.
        </p>

        <p v-if="overview.length === 0" class="text-paper-400 font-mono text-[11px] tracking-wide">Nothing stored yet. Train a location above and press Apply.</p>

        <div v-else class="overflow-x-auto">
          <table class="w-full border-collapse font-mono text-[11px] tabular-nums">
            <thead>
              <tr class="text-paper-400 text-[10px] tracking-wide">
                <th scope="col" class="border-ink-700/60 border-b px-3 py-2 text-left font-normal">Location</th>
                <th scope="col" class="border-ink-700/60 border-b px-3 py-2 text-left font-normal">Trained</th>
                <th scope="col" class="border-ink-700/60 border-b px-3 py-2 text-right font-normal">Improvement</th>
                <th scope="col" title="Models whose weight was changed from the heuristic" class="border-ink-700/60 border-b px-3 py-2 text-right font-normal">Tuned</th>
                <th scope="col" class="border-ink-700/60 border-b px-3 py-2 text-left font-normal">Reach</th>
                <th scope="col" class="border-ink-700/60 border-b px-3 py-2"><span class="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in overview" :key="row.key" :class="row.isCurrent ? 'bg-sodium-300/5' : ''">
                <th scope="row" class="border-ink-700/40 border-b px-3 py-1.5 text-left font-normal">
                  <button v-if="row.latitude != null" type="button" class="text-paper-200 hover:text-sodium-200 cursor-pointer text-left transition-colors" @click="jumpTo(row)">
                    {{ row.name }}<span v-if="row.detail" class="text-paper-500">, {{ row.detail }}</span>
                  </button>
                  <span v-else class="text-paper-300">{{ row.name }}</span>
                  <span v-if="row.isCurrent" class="text-sodium-300 ml-2 text-[10px]">· current</span>
                </th>
                <td class="border-ink-700/40 text-paper-400 border-b px-3 py-1.5 text-left">{{ fmtDate(row.trainedAt) }}</td>
                <td class="border-ink-700/40 border-b px-3 py-1.5 text-right" :class="row.improvement > 0 ? 'text-predictability-high' : 'text-heat-300'">
                  {{ row.improvement >= 0 ? "+" : "" }}{{ fmt1(row.improvement) }}
                </td>
                <td class="border-ink-700/40 text-paper-400 border-b px-3 py-1.5 text-right">{{ row.tuned }}</td>
                <td class="border-ink-700/40 border-b px-3 py-1.5 text-left">
                  <select
                    class="border-ink-600 bg-ink-800 text-paper-100 border px-2 py-1 font-mono text-[11px] tracking-wide"
                    :value="row.radiusKm"
                    @change="onReachChange(row.key, Number(($event.target as HTMLSelectElement).value))"
                  >
                    <option v-for="km in REACH_PRESETS_KM" :key="km" :value="km">{{ reachLabel(km) }}</option>
                  </select>
                </td>
                <td class="border-ink-700/40 border-b px-3 py-1.5 text-right">
                  <button type="button" class="text-paper-400 hover:text-heat-300 transition-colors" @click="removeEntry(row.key)">Clear</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </CollapsibleSection>
    </main>

    <AppFooter>Trained weights <span class="text-sodium-300">·</span> per location, on-device</AppFooter>
  </div>
</template>
