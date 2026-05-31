<script setup lang="ts">
import { computed } from "vue";

import type { ForecastResponse } from "@/api/omForecast";
import type { DailyAggregate } from "@/composables/useForecast";
import { overallConfidence } from "@/domain/confidence";
import { MODELS } from "@/domain/models";

import CurrentCard from "./CurrentCard.vue";
import DayCard, { type ModelRow } from "./DayCard.vue";

const props = defineProps<{
  daily: DailyAggregate;
  raw: ForecastResponse;
  solar: { sunrise: string[]; sunset: string[] } | null;
  locationName: string;
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
      confidence: overallConfidence([props.daily.confidence.temperature_2m_max[i], props.daily.confidence.precipitation_sum[i], props.daily.confidence.weather_code[i]]),
      models,
    };
  }),
);
</script>

<template>
  <section>
    <h2 class="eyebrow mb-3">Conditions &amp; outlook</h2>
    <div class="flex snap-x gap-2 overflow-x-auto pt-1 pb-3">
      <CurrentCard class="snap-start" :raw="raw" :daily="daily" :solar="solar" :location-name="locationName" />
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
  </section>
</template>
