import { defineConfig } from "vite";

// In dev, Vite serves the app and forwards room traffic to `wrangler dev`.
// In prod, the worker serves both (see apps/server/wrangler.jsonc).
const WORKER = "http://127.0.0.1:8787";

export default defineConfig({
  build: {
    rolldownOptions: {
      // Keep /*! licence notices in the minified files (the mp3 encoder in sounds/encode.ts has one).
      output: { comments: { legal: true } },
    },
  },
  server: {
    host: true, // reachable from phones on the same Wi-Fi
    allowedHosts: [".trycloudflare.com"], // or through a cloudflared quick tunnel
    proxy: {
      // Keep the Host header: /api/sounds writes check that Origin names this host.
      // The object form, not a bare string: Vite turns a string into { changeOrigin: true }.
      "/api": { target: WORKER },
      "/parties": { target: WORKER, ws: true },
    },
  },
});
