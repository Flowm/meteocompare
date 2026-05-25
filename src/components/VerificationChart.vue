<script setup lang="ts">
import type { EChartsOption, LineSeriesOption } from "echarts";
import { computed } from "vue";
import VChart from "vue-echarts";

import { useUnits } from "@/composables/useUnits";
import type { VerificationHourly } from "@/composables/useVerification";
import type { ModelDef } from "@/domain/models";

const props = defineProps<{
  hourly: VerificationHourly;
  availableModels: ModelDef[];
  /** Page-level toggle — when true, overlay per-model spaghetti lines on top of
   *  the aggregate + truth pair (temperature only; precipitation per-model would
   *  produce indistinguishable line clutter). */
  showModels: boolean;
  /** Independent variable visibility toggles. */
  showTemp: boolean;
  showPrecip: boolean;
}>();

const { temp, precip, formatTemp, formatPrecip } = useUnits();

const tempUnit = computed(() => (temp.value === "f" ? "°F" : "°C"));
const precipUnit = computed(() => (precip.value === "in" ? "in" : "mm"));

function toTempUnit(v: number | null | undefined): number | null {
  if (v == null || Number.isNaN(v)) return null;
  return temp.value === "f" ? (v * 9) / 5 + 32 : v;
}
function toPrecipUnit(v: number | null | undefined): number | null {
  if (v == null || Number.isNaN(v)) return null;
  return precip.value === "in" ? v / 25.4 : v;
}

const FORECAST_COLOR = "#f472b6"; // pink — aggregate forecast
const TRUTH_COLOR = "#facc15"; // amber — ERA5-Seamless truth
const PRECIP_FORECAST_COLOR = "rgba(56, 189, 248, 0.55)"; // sky bars, semi-transparent
const MODEL_PALETTE = ["#60a5fa", "#34d399", "#a78bfa", "#fb7185", "#22d3ee", "#f87171", "#facc15", "#4ade80", "#c084fc", "#fcd34d", "#86efac"];

const option = computed<EChartsOption>(() => {
  const times = props.hourly.times;
  const labels = times.map((t) => {
    const d = new Date(t);
    const h = d.getHours();
    return h === 0 ? d.toLocaleDateString([], { weekday: "short" }) : `${h.toString().padStart(2, "0")}:00`;
  });

  const tempForecast = props.hourly.aggregateTemp.map((p) => toTempUnit(p.value));
  const tempStd = props.hourly.aggregateTemp.map((p) => (Number.isFinite(p.stdDev) ? p.stdDev : 0));
  const tempLower = props.hourly.aggregateTemp.map((p, i) => toTempUnit(p.value - tempStd[i]!));
  const tempDelta = tempStd.map((s) => (temp.value === "f" ? (s * 2 * 9) / 5 : s * 2));
  const tempTruth = props.hourly.truthTemp.map(toTempUnit);

  const precipForecast = props.hourly.aggregatePrecip.map((p) => toPrecipUnit(p.value));
  const precipTruth = props.hourly.truthPrecip.map(toPrecipUnit);

  const series: NonNullable<EChartsOption["series"]> = [];

  // -- Precipitation layer (yAxisIndex 1, right axis) --
  if (props.showPrecip) {
    series.push({
      name: "Forecast precip",
      type: "bar",
      yAxisIndex: 1,
      data: precipForecast,
      itemStyle: { color: PRECIP_FORECAST_COLOR },
      barWidth: "60%",
      z: 1,
    });
    series.push({
      name: "Truth precip",
      type: "line",
      yAxisIndex: 1,
      data: precipTruth,
      step: "middle",
      symbol: "none",
      lineStyle: { width: 2, color: TRUTH_COLOR, type: "solid" },
      areaStyle: { color: "rgba(250, 204, 21, 0.12)" },
      z: 2,
    });
    if (props.showModels) {
      for (const [i, m] of props.availableModels.entries()) {
        const arr = props.hourly.perModelPrecip[m.id];
        if (!arr) continue;
        series.push({
          name: m.label + " precip",
          type: "line",
          yAxisIndex: 1,
          data: arr.map(toPrecipUnit),
          smooth: false,
          symbol: "none",
          lineStyle: { width: 1, color: MODEL_PALETTE[i % MODEL_PALETTE.length], opacity: 0.5 },
          z: 3,
        } satisfies LineSeriesOption);
      }
    }
  }

  // -- Temperature layer (yAxisIndex 0, left axis) --
  if (props.showTemp) {
    // Confidence band (transparent bottom + stacked filled delta on top).
    series.push({
      name: "band_base",
      type: "line",
      stack: "tempband",
      symbol: "none",
      lineStyle: { opacity: 0 },
      itemStyle: { opacity: 0 },
      tooltip: { show: false },
      data: tempLower,
    });
    series.push({
      name: "band_range",
      type: "line",
      stack: "tempband",
      symbol: "none",
      lineStyle: { opacity: 0 },
      areaStyle: { color: "rgba(244, 114, 182, 0.16)" },
      tooltip: { show: false },
      data: tempDelta,
    });
    series.push({
      name: "Aggregate temp",
      type: "line",
      data: tempForecast,
      smooth: true,
      symbol: "none",
      lineStyle: { width: 2.5, color: FORECAST_COLOR },
      z: 5,
    });
    series.push({
      name: "Truth temp",
      type: "line",
      data: tempTruth,
      smooth: false,
      symbol: "none",
      lineStyle: { width: 3, color: TRUTH_COLOR, type: "solid" },
      z: 6,
    });
    if (props.showModels) {
      for (const [i, m] of props.availableModels.entries()) {
        const arr = props.hourly.perModelTemp[m.id];
        if (!arr) continue;
        series.push({
          name: m.label,
          type: "line",
          data: arr.map(toTempUnit),
          smooth: true,
          symbol: "none",
          lineStyle: { width: 1, color: MODEL_PALETTE[i % MODEL_PALETTE.length], opacity: 0.55 },
          z: 4,
        } satisfies LineSeriesOption);
      }
    }
  }

  return {
    backgroundColor: "transparent",
    textStyle: { color: "#cbd5e1" },
    grid: { left: 48, right: 48, top: 32, bottom: 36 },
    tooltip: {
      trigger: "axis",
      backgroundColor: "rgba(15, 23, 42, 0.95)",
      borderColor: "#334155",
      textStyle: { color: "#e2e8f0" },
      formatter: (params: unknown) => {
        const arr = params as Array<{ axisValue: string; seriesName: string; value: number; color: string }>;
        const t = arr[0]?.axisValue ?? "";
        const idx = labels.indexOf(t);
        const timeStr = times[idx];
        if (timeStr === undefined) return "";
        const header = new Date(timeStr).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" });
        const lines: string[] = [];
        const aggT = tempForecast[idx];
        const truT = tempTruth[idx];
        if (props.showTemp && aggT != null) lines.push(`<span style="color:${FORECAST_COLOR}">forecast</span> ${formatTemp.value(aggT, 1)}`);
        if (props.showTemp && truT != null) lines.push(`<span style="color:${TRUTH_COLOR}">truth</span> ${formatTemp.value(truT, 1)}`);
        const aggP = precipForecast[idx];
        const truP = precipTruth[idx];
        if (props.showPrecip && aggP != null && aggP > 0.05) lines.push(`<span style="color:#7dd3fc">forecast precip</span> ${formatPrecip.value(aggP, 1)}`);
        if (props.showPrecip && truP != null && truP > 0.05) lines.push(`<span style="color:${TRUTH_COLOR}">truth precip</span> ${formatPrecip.value(truP, 1)}`);
        return `<div style="font-weight:600;margin-bottom:4px">${header}</div>${lines.join("<br/>")}`;
      },
    },
    xAxis: {
      type: "category",
      data: labels,
      axisLine: { lineStyle: { color: "#475569" } },
      // 7-day view → label every 24 h.
      axisLabel: { color: "#94a3b8", interval: 23, hideOverlap: true },
      axisTick: { show: false },
    },
    yAxis: [
      {
        type: "value",
        name: tempUnit.value,
        nameTextStyle: { color: "#94a3b8" },
        axisLine: { show: false },
        axisLabel: { color: "#94a3b8" },
        splitLine: { lineStyle: { color: "#1e293b" } },
        show: props.showTemp,
      },
      {
        type: "value",
        name: precipUnit.value,
        nameTextStyle: { color: "#94a3b8" },
        position: "right",
        min: 0,
        axisLine: { show: false },
        axisLabel: { color: "#94a3b8" },
        splitLine: { show: false },
        show: props.showPrecip,
      },
    ],
    series,
  };
});
</script>

<template>
  <section class="rounded-2xl bg-slate-900/60 p-4 ring-1 ring-slate-800 sm:p-6">
    <div class="mb-3 flex flex-wrap items-center gap-3 text-xs text-slate-400">
      <span class="font-medium tracking-wider text-slate-300 uppercase">Hourly verification</span>
      <span class="hidden text-slate-500 sm:inline">
        <span class="inline-block size-2 rounded-full" :style="{ backgroundColor: FORECAST_COLOR }" />
        forecast
        <span class="ml-2 inline-block size-2 rounded-full" :style="{ backgroundColor: TRUTH_COLOR }" />
        truth
      </span>
    </div>
    <VChart style="height: 22rem" :option="option" autoresize />
  </section>
</template>
