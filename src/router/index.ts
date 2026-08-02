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
    {
      path: "/verify",
      name: "verify",
      // Off the landing path — lazy-load so it lands in its own chunk.
      component: () => import("@/views/VerificationView.vue"),
    },
    {
      path: "/train",
      name: "train",
      component: () => import("@/views/TrainingView.vue"),
    },
    {
      path: "/about",
      name: "about",
      // Static editorial page, rarely on the hot path — keep it out of the main bundle.
      component: () => import("@/views/AboutView.vue"),
    },
  ],
});

usePostHog();
