import { createApp } from 'vue'
import App from './App.vue'
import { router } from './router'
import { setupECharts } from './echartsSetup'

setupECharts()

createApp(App).use(router).mount('#app')
