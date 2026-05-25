import { createRouter, createWebHistory } from "vue-router";

import { usePostHog } from "@/composables/usePostHog";
import ForecastView from "@/views/ForecastView.vue";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: "/",
      name: "forecast",
      component: ForecastView,
    },
  ],
});

usePostHog();
