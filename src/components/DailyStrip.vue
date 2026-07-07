<script setup lang="ts">
import { computed } from "vue";

import { dailyOverallPredictability, type DailyAggregate } from "@/analysis/forecastEvaluation";
import { MODELS } from "@/domain/models";

import DayCard, { type ModelRow } from "./DayCard.vue";

const props = defineProps<{
  daily: DailyAggregate;
}>();

interface DayRow {
  date: string;
  /** null when no model contributed a weather code → fallback icon. */
  code: number | null;
  high: number;
  low: number;
  precipProb: number | null;
  precipSum: number | null;
  windSpeed: number | null;
  windDirection: number | null;
  predictability: number;
  models: ModelRow[];
}

/** Round a nullable aggregate weather code, preserving null (no contributing
 *  models) so the day card can show the fallback icon rather than "clear". */
const roundOrNull = (v: number | null | undefined): number | null => (v == null ? null : Math.round(v));

const days = computed<DayRow[]>(() =>
  props.daily.times.map((date, i) => {
    const models: ModelRow[] = MODELS.map((m) => ({
      id: m.id,
      label: m.label,
      high: props.daily.perModel.temperature_2m_max[m.id]?.[i] ?? null,
      low: props.daily.perModel.temperature_2m_min[m.id]?.[i] ?? null,
      precipProb: props.daily.perModel.precipitation_probability_max[m.id]?.[i] ?? null,
    }));
    return {
      date,
      code: roundOrNull(props.daily.aggregate.weather_code[i]?.value),
      high: props.daily.aggregate.temperature_2m_max[i]?.value ?? NaN,
      low: props.daily.aggregate.temperature_2m_min[i]?.value ?? NaN,
      precipProb: props.daily.aggregate.precipitation_probability_max[i]?.value ?? null,
      precipSum: props.daily.aggregate.precipitation_sum[i]?.value ?? null,
      windSpeed: props.daily.aggregate.wind_speed_10m_max[i]?.value ?? null,
      windDirection: props.daily.aggregate.wind_direction_10m_dominant[i]?.value ?? null,
      predictability: dailyOverallPredictability(props.daily, i),
      models,
    };
  }),
);
</script>

<template>
  <!-- Horizontal snap-scroll rail of day cards. The scrollbar is hidden on
       mobile (no-scrollbar) where it only steals vertical space. -->
  <div class="no-scrollbar flex snap-x gap-2 overflow-x-auto pt-0 pb-1 sm:pt-1 sm:pb-3">
    <DayCard
      v-for="(d, i) in days"
      :key="d.date"
      class="snap-start"
      :date="d.date"
      :code="d.code"
      :high="d.high"
      :low="d.low"
      :precip-prob="d.precipProb"
      :precip-sum="d.precipSum"
      :wind-speed="d.windSpeed"
      :wind-direction="d.windDirection"
      :predictability="d.predictability"
      :highlight="i === 0"
      :models="d.models"
    />
  </div>
</template>
