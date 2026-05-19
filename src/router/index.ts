import { createRouter, createWebHistory } from 'vue-router'
import ForecastView from '@/views/ForecastView.vue'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'forecast',
      component: ForecastView,
    },
  ],
})
