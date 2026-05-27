/// <reference types="vitest/config" />
import { execSync } from "child_process";
import { createRequire } from "module";
import path from "path";

import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const buildDate = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
const buildSha = execSync("git rev-parse --short HEAD").toString().trim();

const port = process.env.PORT ? Number(process.env.PORT) : undefined;

// Resolve node_modules wherever it lives so Vite can serve assets from it — in
// a git worktree it sits in the main repo, outside the worktree root.
const require = createRequire(import.meta.url);
const nodeModulesDir = path.join(require.resolve("vue/package.json"), "../..");

export default defineConfig({
  server: {
    port,
    strictPort: port !== undefined,
    fs: { allow: [process.cwd(), nodeModulesDir] },
  },
  preview: { port, strictPort: port !== undefined },
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: "vue", test: /@vue|vue-router|@vueuse/, priority: 60 },
            { name: "analytics", test: /posthog/, priority: 20 },
            { name: "vendor", test: /node_modules/, priority: 10 },
            { name: "app", test: /src/, priority: 1 },
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
          maskable: { sizes: [512], padding: 0 },
          apple: { sizes: [180], padding: 0 },
        },
        image: "public/logo.svg",
      },
      manifest: {
        name: "MeteoCompare",
        short_name: "MeteoCompare",
        description: "Multi-model weather forecast comparison with a weighted aggregate and confidence score.",
        theme_color: "#0f172a",
        background_color: "#0f172a",
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
    globals: true,
    include: ["src/**/*.test.ts"],
  },
});
