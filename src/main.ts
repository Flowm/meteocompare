import { createApp } from "vue";

import "./style.css";
import App from "./App.vue";
import { usePWAUpdate } from "./composables/usePWAUpdate";
import { setupECharts } from "./echartsSetup";
import { router } from "./router";

usePWAUpdate({ autoUpdate: true });

setupECharts();

// Disable mobile Safari's pinch-to-zoom. The viewport meta (`user-scalable=no`)
// already covers Android and installed PWAs, but iOS Safari ignores it for
// manual pinch, so we cancel WebKit's gesture events directly. They only fire
// for multi-finger pinch/rotate, so ordinary scrolling is untouched.
document.addEventListener("gesturestart", (e) => e.preventDefault());

createApp(App).use(router).mount("#app");
