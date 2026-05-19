<script setup lang="ts">
import { useUnits } from '@/composables/useUnits'

const { temp, precip } = useUnits()
</script>

<template>
  <div class="flex items-center gap-1 text-xs">
    <button
      class="px-2 py-1 rounded-md border border-slate-800 hover:border-slate-600 tabular-nums"
      :title="`Switch to ${temp === 'c' ? 'Fahrenheit' : 'Celsius'}`"
      @click="temp = temp === 'c' ? 'f' : 'c'"
    >°{{ temp === 'c' ? 'C' : 'F' }}</button>
    <button
      class="px-2 py-1 rounded-md border border-slate-800 hover:border-slate-600"
      :title="`Switch to ${precip === 'mm' ? 'inches' : 'millimetres'}`"
      @click="precip = precip === 'mm' ? 'in' : 'mm'"
    >{{ precip }}</button>
  </div>
</template>
