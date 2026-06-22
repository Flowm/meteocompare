<script setup lang="ts">
import { RouterView } from "vue-router";

import PullToRefresh from "@/components/PullToRefresh.vue";
</script>

<template>
  <PullToRefresh />
  <RouterView />
</template>
