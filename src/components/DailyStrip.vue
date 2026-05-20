<script setup lang="ts">
import { computed } from "vue";

import type { DailyAggregate } from "@/composables/useForecast";

import DayCard from "./DayCard.vue";

const props = defineProps<{ daily: DailyAggregate }>();

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
}

const days = computed<DayRow[]>(() =>
  props.daily.times.map((date, i) => {
    const conf = [props.daily.confidence.temperature_2m_max[i] ?? 0, props.daily.confidence.weather_code[i] ?? 0, props.daily.confidence.precipitation_sum[i] ?? 0];
    return {
      date,
      code: Math.round(props.daily.series.weather_code[i]?.value ?? 0),
      high: props.daily.series.temperature_2m_max[i]?.value ?? NaN,
      low: props.daily.series.temperature_2m_min[i]?.value ?? NaN,
      precipProb: props.daily.series.precipitation_probability_max[i]?.value ?? null,
      precipSum: props.daily.series.precipitation_sum[i]?.value ?? null,
      windSpeed: props.daily.series.wind_speed_10m_max[i]?.value ?? null,
      windDirection: props.daily.series.wind_direction_10m_dominant[i]?.value ?? null,
      confidence: conf.reduce((a, b) => a + b, 0) / conf.length,
    };
  }),
);
</script>

<template>
  <section>
    <h2 class="mb-3 text-sm font-medium tracking-wider text-slate-300 uppercase">10-day outlook</h2>
    <div class="-mx-2 flex snap-x gap-3 overflow-x-auto px-2 py-1">
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
      />
    </div>
  </section>
</template>
