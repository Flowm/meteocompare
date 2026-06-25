import { createRouter, createWebHistory } from "vue-router";

import { usePostHog } from "@/composables/usePostHog";
import ForecastView from "@/views/ForecastView.vue";
import TrainingView from "@/views/TrainingView.vue";
import VerificationView from "@/views/VerificationView.vue";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: "/",
      name: "forecast",
      component: ForecastView,
    },
    {
      path: "/verify",
      name: "verify",
      component: VerificationView,
    },
    {
      path: "/train",
      name: "train",
      component: TrainingView,
    },
  ],
});

usePostHog();
