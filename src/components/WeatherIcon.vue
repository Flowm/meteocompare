<script setup lang="ts">
import { computed } from 'vue'
import { severitySlug, type SeveritySlug } from '@/domain/weatherCodes'

const props = defineProps<{
  code: number
  size?: number | string
  isDay?: boolean
}>()

const slug = computed<SeveritySlug>(() => severitySlug(props.code))

const emoji = computed(() => {
  switch (slug.value) {
    case 'clear':
      return props.isDay === false ? '🌙' : '☀️'
    case 'mostly_clear':
      return props.isDay === false ? '☁️' : '🌤️'
    case 'cloudy':
      return '☁️'
    case 'fog':
      return '🌫️'
    case 'drizzle':
      return '🌦️'
    case 'rain':
      return '🌧️'
    case 'snow':
      return '❄️'
    case 'storm':
      return '⛈️'
  }
})

const sizeStyle = computed(() => {
  const s = props.size ?? '2rem'
  return typeof s === 'number' ? `${s}px` : s
})
</script>

<template>
  <span
    class="inline-block leading-none select-none"
    :style="{ fontSize: sizeStyle }"
    :aria-label="slug"
    role="img"
  >{{ emoji }}</span>
</template>
