<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";

import { resolveCalibration } from "@/analysis/calibrationStore";
import AppFooter from "@/components/AppFooter.vue";
import { type ChartViewId } from "@/components/chartHelpers";
import CollapsibleSection from "@/components/CollapsibleSection.vue";
import GatherControls from "@/components/GatherControls.vue";
import HourlySeriesChart from "@/components/HourlySeriesChart.vue";
import LoadingVeil from "@/components/LoadingVeil.vue";
import LocationBar from "@/components/LocationBar.vue";
import LocationLabel from "@/components/LocationLabel.vue";
import ModelScorecard from "@/components/ModelScorecard.vue";
import ModelTimingMatrix from "@/components/ModelTimingMatrix.vue";
import MultiRunScorecard from "@/components/MultiRunScorecard.vue";
import RunPicker from "@/components/RunPicker.vue";
import SegmentedToggle from "@/components/SegmentedToggle.vue";
import StateBlock from "@/components/StateBlock.vue";
import VerificationDayCard from "@/components/VerificationDayCard.vue";
import { useLocation } from "@/composables/useLocation";
import { useSampleCollection } from "@/composables/useSampleCollection";
import { useVerification } from "@/composables/useVerification";
import { MODELS } from "@/domain/models";
import { addDaysIso } from "@/utils/date";

// ERA5-Seamless provides truth only for temperature and precipitation
// (ADR 0001). Wind/cloud truth would be a future, data-only addition.
const VERIFY_VARIABLES: ChartViewId[] = ["temperature_2m", "precipitation"];

const route = useRoute();
const router = useRouter();
const { current, label: locationLabel } = useLocation();

// The location's resolved calibration curves (ADR 0008) — the daily breakdown
// shows calibrated per-variable predictability where curves exist, so this page
// stays the standing sanity check of the calibration itself.
const calibration = computed(() => resolveCalibration(current.value.latitude, current.value.longitude));

// Date bounds (see ADR 0001 + grilling notes):
// - max = today − 12 days: ERA5-Seamless ~5-day lag + 7-day forward window
// - min = 2025-09-01: single-runs API retention cutoff for most models
const TRUTH_LAG_DAYS = 12;
const RETENTION_FLOOR = "2025-09-01";
const DEFAULT_OFFSET_DAYS = 14;

function todayIsoUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

const maxRunDate = computed(() => addDaysIso(todayIsoUTC(), -TRUTH_LAG_DAYS));
const defaultRunDate = computed(() => addDaysIso(todayIsoUTC(), -DEFAULT_OFFSET_DAYS));

const runDate = computed<string>(() => {
  const r = route.query.runDate;
  if (typeof r === "string" && r >= RETENTION_FLOOR && r <= maxRunDate.value) return r;
  return defaultRunDate.value;
});

function setRunDate(newDate: string): void {
  void router.replace({ query: { ...route.query, runDate: newDate } });
}

// Run cycle (00 / 06 / 12 / 18 Z). A run is identified by date + cycle; default 00Z.
// Models publish different cycles, so a non-00Z pick naturally prunes the ones
// that don't issue it (the single-runs API reports them missing).
const RUN_CYCLES = [0, 6, 12, 18] as const;
const runCycle = computed<number>(() => {
  const c = Number(route.query.cycle);
  return (RUN_CYCLES as readonly number[]).includes(c) ? c : 0;
});
function setRunCycle(hour: number): void {
  void router.replace({ query: { ...route.query, cycle: String(hour) } });
}
const cycleLabel = computed(() => `${String(runCycle.value).padStart(2, "0")}:00 UTC`);

// Single-run vs multi-run analysis mode (view-local). The single-run date picker
// doubles as the run-date window end when gathering a multi-run sample.
const mode = ref<"single" | "multi">("single");
const durationDays = ref(30);
const cyclesPerDay = ref<1 | 4>(1);

const MODE_OPTIONS = [
  { value: "single", label: "Single run" },
  { value: "multi", label: "Multi-run" },
] as const;

const showModels = ref(false);

const { loading, error, hourly, daily, scorecard, availableModels, solar } = useVerification(current, runDate, runCycle);

const {
  stats: sampleStats,
  runs: sampleRuns,
  gathering,
  progress,
  error: sampleError,
  storedCount,
  gather,
  store,
  cancel,
} = useSampleCollection(current, runDate, RETENTION_FLOOR);

function runGather(): void {
  void gather({ durationDays: durationDays.value, cyclesPerDay: cyclesPerDay.value });
}
function runStore(): void {
  void store();
}

const missingModelCount = computed(() => MODELS.length - availableModels.value.length);
</script>

<template>
  <div class="flex min-h-screen flex-col">
    <LocationBar />

    <main class="mx-auto w-full max-w-5xl flex-1 space-y-8 px-4 py-8 sm:px-6">
      <!-- Header / controls. Collapsible like the forecast Location section —
           the location surfaces in the title bar (summary) while collapsed. -->
      <CollapsibleSection title="Verification" :summary="locationLabel">
        <section class="registration border-ink-700 bg-ink-900/60 relative border p-5 sm:p-6">
          <!-- Single-run vs multi-run mode. -->
          <div class="mb-4 flex items-center gap-3">
            <SegmentedToggle v-model="mode" :options="MODE_OPTIONS" inline divided class="font-mono text-xs tracking-wide" />
          </div>

          <div class="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
            <LocationLabel :name="locationLabel" />
            <RunPicker
              :run-date="runDate"
              :cycle="runCycle"
              :min="RETENTION_FLOOR"
              :max="maxRunDate"
              :cycles="RUN_CYCLES"
              :show-cycle="mode === 'single'"
              :date-label="mode === 'multi' ? 'End date' : 'Run date'"
              @update:run-date="setRunDate"
              @update:cycle="setRunCycle"
            >
              <template #hint>
                <p v-if="mode === 'single' && missingModelCount > 0 && !loading" class="text-paper-400 font-mono text-[11px] tracking-wide">
                  {{ availableModels.length }}/{{ MODELS.length }} models available
                </p>
              </template>
            </RunPicker>
          </div>

          <!-- Multi-run sampling controls: gather a window of runs for this
               location, then store them for training (phase 3). -->
          <GatherControls
            v-if="mode === 'multi'"
            v-model:durationDays="durationDays"
            v-model:cyclesPerDay="cyclesPerDay"
            class="mt-4"
            :gathering="gathering"
            :progress="progress"
            :gathered-count="sampleRuns.length"
            :stored-count="storedCount"
            :error="sampleError"
            @gather="runGather"
            @store="runStore"
            @cancel="cancel"
          />

          <!-- Truth reference (single-run window). -->
          <p v-if="mode === 'single'" class="border-ink-700 text-paper-400 mt-4 border-t pt-3 font-mono text-[11px] tracking-wide">
            Forecast vs ERA5-Seamless <span class="text-paper-500">· 7-day window · {{ cycleLabel }}</span>
          </p>
        </section>
      </CollapsibleSection>

      <!-- Single-run analysis -->
      <template v-if="mode === 'single'">
        <StateBlock v-if="error" kind="error">{{ error }}</StateBlock>

        <StateBlock v-if="loading && !hourly" kind="loading" caption="Loading run…" />

        <LoadingVeil v-if="hourly" :loading="loading">
          <div class="space-y-8">
            <!-- Chart (CollapsibleSection supplies the heading, so the chart's own is off). -->
            <CollapsibleSection title="Hourly verification">
              <HourlySeriesChart
                v-model:showModels="showModels"
                title="Hourly verification"
                :show-title="false"
                :data="hourly"
                :variables="VERIFY_VARIABLES"
                :solar="solar"
                :default-window="168"
              />
            </CollapsibleSection>

            <!-- Per-model scorecard — each model (and the aggregate, ranked inline)
                 scored over the full window, with lead-time bands. -->
            <CollapsibleSection v-if="scorecard && scorecard.length" title="Per-model scorecard">
              <div class="space-y-3">
                <p class="text-paper-500 font-mono text-[11px] tracking-wide">
                  Each model scored over the full run window · 0–100 overall (higher = better) · <span class="text-aggregate-400">Aggregate</span> is the weighted combination of
                  models
                </p>
                <ModelScorecard :rows="scorecard" />
              </div>
            </CollapsibleSection>

            <!-- Precipitation timing — per-hour hit / miss / false-alarm strip per
                 model and aggregate, against ERA5-Seamless truth. -->
            <CollapsibleSection v-if="scorecard && scorecard.length" title="Precipitation timing">
              <div class="space-y-3">
                <p class="text-paper-500 font-mono text-[11px] tracking-wide">Per-hour rain hit / miss / false alarm against truth, per model and aggregate (±1 h tolerance).</p>
                <ModelTimingMatrix :rows="scorecard" />
              </div>
            </CollapsibleSection>

            <!-- Daily breakdown — the aggregate's per-day calibration lens (predictability
                 beside measured error). The per-model lens lives in the scorecard above. -->
            <CollapsibleSection v-if="daily && daily.length" title="Daily breakdown">
              <div class="no-scrollbar -mx-2 flex snap-x gap-2 overflow-x-auto px-2 pt-1 pb-3">
                <VerificationDayCard v-for="d in daily" :key="d.dayIndex" :day="d" :calibration="calibration" />
              </div>
            </CollapsibleSection>
          </div>
        </LoadingVeil>
      </template>

      <!-- Multi-run analysis: per-model performance across the gathered sample. -->
      <template v-else>
        <CollapsibleSection v-if="sampleStats.length" title="Per-model performance" :summary="`${sampleRuns.length} runs`">
          <div class="space-y-3">
            <p class="text-paper-500 font-mono text-[11px] tracking-wide">
              Each model's mean skill across {{ sampleRuns.length }} gathered runs · 0–100 (higher = better) · <span class="text-aggregate-400">Aggregate</span> ranked inline ·
              Range = min–max
            </p>
            <MultiRunScorecard :stats="sampleStats" />
          </div>
        </CollapsibleSection>
        <StateBlock v-else-if="gathering" kind="loading" :caption="`Gathering ${progress.done}/${progress.total} runs…`" />
        <StateBlock v-else kind="empty" text-size="text-[11px]">
          Set a duration and press <span class="text-sodium-200">Gather</span> to sample this location's runs, then <span class="text-paper-200">Store data</span> to keep them for
          training.
        </StateBlock>
      </template>
    </main>

    <AppFooter>Truth <span class="text-sodium-300">·</span> ERA5-Seamless</AppFooter>
  </div>
</template>
