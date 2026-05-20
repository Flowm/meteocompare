<script setup lang="ts">
import { computed } from 'vue'
import { confidenceTier } from '@/domain/confidence'

const props = withDefaults(
  defineProps<{
    /** 0..1 */
    value: number
    label?: string
    size?: 'sm' | 'md'
  }>(),
  { size: 'md' },
)

const tier = computed(() => confidenceTier(props.value))

const TONE_BY_TIER = {
  high: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30',
  mid: 'bg-amber-500/15 text-amber-200 ring-amber-500/30',
  low: 'bg-rose-500/15 text-rose-200 ring-rose-500/30',
} as const

const tone = computed(() => TONE_BY_TIER[tier.value])

const percent = computed(() => Math.round(props.value * 100))
const sizing = computed(() => (props.size === 'sm' ? 'text-xs px-2 py-0.5' : 'text-sm px-2.5 py-1'))
</script>

<template>
  <span
    class="inline-flex items-center gap-1 rounded-full ring-1 font-medium tabular-nums"
    :class="[tone, sizing]"
    :title="`Model agreement: ${percent}%`"
  >
    <span class="size-1.5 rounded-full" :class="{
      'bg-emerald-400': tier === 'high',
      'bg-amber-400': tier === 'mid',
      'bg-rose-400': tier === 'low',
    }" />
    {{ label ?? `${percent}% confidence` }}
  </span>
</template>
