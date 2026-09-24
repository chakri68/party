import { defineConfig } from "vite";

// In dev, Vite serves the app and forwards room traffic to `wrangler dev`.
// In prod, the worker serves both (see apps/server/wrangler.jsonc).
const WORKER = "http://127.0.0.1:8787";

export default defineConfig({
  server: {
    host: true, // reachable from phones on the same Wi-Fi
    proxy: {
      "/api": WORKER,
      "/parties": { target: WORKER, ws: true },
    },
  },
});
