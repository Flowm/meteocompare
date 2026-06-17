<script setup lang="ts">
import { computed } from "vue";

import { dailyOverallConfidence, type DailyAggregate } from "@/composables/useForecast";
import { MODELS } from "@/domain/models";

import DayCard, { type ModelRow } from "./DayCard.vue";

const props = defineProps<{
  daily: DailyAggregate;
}>();

interface DayRow {
  date: string;
  code: number;
  high: number;
  low: number;
  precipProb: number | null;
  precipSum: number | null;
  windSpeed: number | null;
  windDirection: number | null;
  confidence: number;
  models: ModelRow[];
}

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
      code: Math.round(props.daily.series.weather_code[i]?.value ?? 0),
      high: props.daily.series.temperature_2m_max[i]?.value ?? NaN,
      low: props.daily.series.temperature_2m_min[i]?.value ?? NaN,
      precipProb: props.daily.series.precipitation_probability_max[i]?.value ?? null,
      precipSum: props.daily.series.precipitation_sum[i]?.value ?? null,
      windSpeed: props.daily.series.wind_speed_10m_max[i]?.value ?? null,
      windDirection: props.daily.series.wind_direction_10m_dominant[i]?.value ?? null,
      confidence: dailyOverallConfidence(props.daily, i),
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
      :confidence="d.confidence"
      :highlight="i === 0"
      :models="d.models"
    />
  </div>
</template>
