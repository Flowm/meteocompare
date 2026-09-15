import path from "node:path";
import { fileURLToPath } from "node:url";

import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

const emptyAssets = path.join(path.dirname(fileURLToPath(import.meta.url)), "test", "fixtures", "empty-assets");

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        // Point the assets binding at an empty dir so the pool does not depend
        // on (or walk) a real ../dist build.
        assets: { directory: emptyAssets },
      },
    }),
  ],
});
