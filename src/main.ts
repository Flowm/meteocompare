import { createApp } from "vue";

import App from "./App.vue";
import { setupECharts } from "./echartsSetup";
import { router } from "./router";

setupECharts();

createApp(App).use(router).mount("#app");
