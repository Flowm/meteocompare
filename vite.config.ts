/// <reference types="vitest/config" />
import { execSync } from "node:child_process";

import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const buildDate = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
let buildSha = "dev";
try {
  buildSha = execSync("git rev-parse --short HEAD").toString().trim();
} catch {
  // not a git checkout (e.g. tarball build)
}

const port = process.env.PORT ? Number(process.env.PORT) : undefined;

export default defineConfig({
  server: {
    port,
    strictPort: port !== undefined,
  },
  preview: { port, strictPort: port !== undefined },
  build: {
    // echarts is a large charting library that legitimately lands ~550 kB in its
    // own dedicated chunk; raise the warning limit so that expected chunk doesn't
    // trip the default 500 kB advisory.
    chunkSizeWarningLimit: 600,
    rolldownOptions: {
      output: {
        codeSplitting: {
          // Group heavy vendor deps into stable chunks. Deliberately no `src`
          // catch-all group: a `{ test: /src/ }` group would fold every app
          // module — including the lazy route views — into one chunk, defeating
          // the router's dynamic import()s. Leaving src ungrouped lets Rolldown's
          // default splitting honour those dynamic-import boundaries, so the
          // off-landing views each get their own lazy chunk.
          groups: [
            { name: "vue", test: /@vue|vue-router|@vueuse/, priority: 60 },
            { name: "echarts", test: /echarts|vue-echarts|zrender/, priority: 40 },
            { name: "analytics", test: /posthog/, priority: 20 },
            { name: "vendor", test: /node_modules/, priority: 10 },
          ],
        },
      },
    },
  },
  define: {
    __BUILD_DATE__: JSON.stringify(buildDate),
    __BUILD_SHA__: JSON.stringify(buildSha),
  },
  plugins: [
    vue(),
    tailwindcss(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      registerType: "prompt",
      pwaAssets: {
        htmlPreset: "2023",
        preset: {
          transparent: { sizes: [64, 192, 512], favicons: [[48, "favicon.ico"]] },
          maskable: { sizes: [512], padding: 0.15, resizeOptions: { background: "#050810" } },
          apple: { sizes: [180], padding: 0.15, resizeOptions: { background: "#050810" } },
        },
        image: "public/logo.svg",
      },
      manifest: {
        name: "MeteoCompare",
        short_name: "MeteoCompare",
        description: "Multi-model weather forecast comparison with a weighted aggregate and a predictability signal.",
        theme_color: "#050810",
        background_color: "#050810",
        display: "standalone",
        start_url: "/",
        scope: "/",
        id: "meteocompare",
        orientation: "natural",
      },
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico,woff,woff2}"],
      },
      devOptions: {
        // enabled: true,
        type: "module",
      },
    }),
  ],
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts"],
  },
});
