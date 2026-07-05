<script setup lang="ts">
// The floating panel shell shared by the dropdowns and the search results
// popover: the `panel-in` entrance animation plus the bordered, shadowed dark
// surface. Positioning (top-full / left-0 / min-w-* / …), open state, triggers
// and roles all stay with the caller — this owns only the look, so it can't
// drift across SettingsMenu / LocationBar / HourlySeriesChart / SearchResults.
// Layout + role/id/aria classes and attrs pass straight through to the root.
</script>

<template>
  <div class="panel-in border-ink-700 bg-ink-900 absolute z-40 mt-1 overflow-hidden border shadow-2xl shadow-black/60">
    <slot />
  </div>
</template>
