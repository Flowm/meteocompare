<script setup lang="ts">
import type { EChartsOption } from "echarts";
import { computed, ref } from "vue";
import VChart from "vue-echarts";

import type { HourlyAggregate } from "@/composables/useForecast";
import { useUnits } from "@/composables/useUnits";

import { buildNightRanges, findNowIndex } from "./chartHelpers";

const props = defineProps<{
  hourly: HourlyAggregate;
  /** Current local time at the location (open-meteo's `current.time`).
   *  Used to grey out elapsed hours and mark "Now". */
  currentTime: string;
  /** ISO local-time strings of sunrise per daily index (open-meteo's `daily.sunrise`). */
  sunrise?: string[];
  /** ISO local-time strings of sunset per daily index (open-meteo's `daily.sunset`). */
  sunset?: string[];
}>();

const { temp, precip, formatTemp, formatPrecip } = useUnits();

const WINDOW_CHOICES = [
  { hours: 24, label: "24h" },
  { hours: 72, label: "3d" },
  { hours: 168, label: "7d" },
] as const;

const hoursWindow = ref<number>(72);
const n = computed(() => Math.min(hoursWindow.value, props.hourly.times.length));
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

const option = computed<EChartsOption>(() => {
  const times = props.hourly.times.slice(0, n.value);
  const temps = props.hourly.series.temperature_2m.slice(0, n.value);
  const precips = props.hourly.series.precipitation.slice(0, n.value);
  const nowIdx = findNowIndex(times, props.currentTime);

  const tempValues = temps.map((p) => toTempUnit(p.value));
  const tempLower = temps.map((p) => toTempUnit(p.value - p.stdDev));
  const nightRanges = buildNightRanges(times, props.sunrise, props.sunset);
  // ECharts confidence-band trick: a transparent baseline + a stacked filled "delta".
  const tempDelta = temps.map((p) => (Number.isFinite(p.stdDev) ? (temp.value === "f" ? (p.stdDev * 2 * 9) / 5 : p.stdDev * 2) : 0));
  const precipValues = precips.map((p) => toPrecipUnit(p.value));

  const labels = times.map((t) => {
    const d = new Date(t);
    const h = d.getHours();
    const isMidnight = h === 0;
    return isMidnight ? d.toLocaleDateString([], { weekday: "short" }) : `${h.toString().padStart(2, "0")}:00`;
  });

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
        const tempP = temps[idx];
        const precP = precips[idx];
        const timeStr = times[idx];
        if (!tempP || timeStr === undefined) return "";
        const date = new Date(timeStr);
        const header = date.toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" });
        const tempStr =
          `<span style="color:#fda4af">${formatTemp.value(tempP.value, 1)}</span>` +
          ` <span style="color:#94a3b8">± ${formatTemp.value(tempP.stdDev, 1).replace(/°[CF]/, "")} ${tempUnit.value}</span>`;
        const precStr = precP != null && precP.value > 0.05 ? `<br/><span style="color:#7dd3fc">${formatPrecip.value(precP.value, 1)}</span>` : "";
        return `<div style="font-weight:600;margin-bottom:4px">${header}</div>${tempStr}${precStr}`;
      },
    },
    xAxis: {
      type: "category",
      data: labels,
      axisLine: { lineStyle: { color: "#475569" } },
      axisLabel: {
        color: "#94a3b8",
        // 24h → every 3 h, 3d → every 12 h, 7d → every 24 h.
        interval: hoursWindow.value <= 24 ? 2 : hoursWindow.value <= 72 ? 11 : 23,
        hideOverlap: true,
      },
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
      },
    ],
    series: [
      {
        name: "precipitation",
        type: "bar",
        yAxisIndex: 1,
        data: precipValues,
        itemStyle: { color: "rgba(56, 189, 248, 0.7)" },
        barWidth: "60%",
      },
      // Confidence band: invisible bottom + filled "delta" stacked on top.
      {
        name: "band_base",
        type: "line",
        stack: "band",
        symbol: "none",
        lineStyle: { opacity: 0 },
        itemStyle: { opacity: 0 },
        tooltip: { show: false },
        data: tempLower,
        markArea:
          nightRanges.length > 0
            ? {
                silent: true,
                itemStyle: { color: "rgba(56, 78, 130, 0.18)", borderWidth: 0 },
                data: nightRanges.map(([a, b]) => [{ xAxis: a }, { xAxis: b }]),
              }
            : undefined,
      },
      {
        name: "band_range",
        type: "line",
        stack: "band",
        symbol: "none",
        lineStyle: { opacity: 0 },
        areaStyle: { color: "rgba(244, 114, 182, 0.18)" },
        tooltip: { show: false },
        data: tempDelta,
      },
      {
        name: "temperature",
        type: "line",
        data: tempValues,
        smooth: true,
        symbol: "none",
        lineStyle: { width: 2.5, color: "#f472b6" },
        z: 5,
        markLine:
          nowIdx >= 0
            ? {
                silent: true,
                animation: false,
                symbol: ["none", "none"],
                lineStyle: { color: "rgba(248, 250, 252, 0.85)", width: 1.5, type: "solid" },
                label: {
                  formatter: "Now",
                  color: "#f8fafc",
                  fontSize: 11,
                  position: "end",
                  backgroundColor: "rgba(15, 23, 42, 0.85)",
                  borderRadius: 4,
                  padding: [2, 6, 2, 6],
                },
                data: [{ xAxis: nowIdx }],
              }
            : undefined,
      },
    ],
  };
});
</script>

<template>
  <section class="rounded-2xl bg-slate-900/60 p-4 ring-1 ring-slate-800 sm:p-6">
    <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
      <h2 class="text-sm font-medium tracking-wider text-slate-300 uppercase">Hourly forecast</h2>
      <div class="flex items-center gap-3">
        <span class="hidden text-xs text-slate-500 sm:inline">Shaded: model spread (±1σ)</span>
        <div class="flex overflow-hidden rounded-md bg-slate-950 text-xs ring-1 ring-slate-800">
          <button
            v-for="c in WINDOW_CHOICES"
            :key="c.hours"
            class="px-3 py-1.5 transition-colors"
            :class="hoursWindow === c.hours ? 'bg-slate-700 text-slate-100' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'"
            @click="hoursWindow = c.hours"
          >
            {{ c.label }}
          </button>
        </div>
      </div>
    </div>
    <VChart style="height: 18rem" :option="option" autoresize />
  </section>
</template>
