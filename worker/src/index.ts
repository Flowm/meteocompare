// Worker entry. `assets.run_worker_first: ["/api/*"]` in wrangler.jsonc routes
// only API paths here; every other request is served straight from the asset
// store without invoking this script.

import { handleGeo } from "./geo.ts";

export default {
  fetch(request: Request): Response {
    const { pathname } = new URL(request.url);
    if (pathname === "/api/geo") return handleGeo(request);
    // Any other /api/* path: a plain 404 rather than the SPA shell the asset
    // router would answer with, so a typo never masquerades as a 200.
    return new Response("Not found", { status: 404 });
  },
};
