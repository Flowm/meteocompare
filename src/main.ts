import { createApp } from "vue";

import "./style.css";
import App from "./App.vue";
import { usePWAUpdate } from "./composables/usePWAUpdate";
import { setupECharts } from "./echartsSetup";
import { router } from "./router";

usePWAUpdate({ autoUpdate: true });

setupECharts();

createApp(App).use(router).mount("#app");
