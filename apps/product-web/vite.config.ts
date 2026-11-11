import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";

// In dev, Vite serves the pages and forwards API and room traffic to `wrangler dev`.
// In prod, the product Worker serves both (see apps/product-server/wrangler.jsonc).
const WORKER = "http://127.0.0.1:8788";

/** The Worker serves /play and /room/:code from play.html. Dev does the same. */
function playRewrite(): Plugin {
  return {
    name: "play-rewrite",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const path = (req.url ?? "").split("?")[0]!;
        if (path === "/play" || path.startsWith("/room/")) req.url = "/play.html" + (req.url!.slice(path.length));
        next();
      });
    },
  };
}

const page = (name: string) => resolve(import.meta.dirname, `${name}.html`);

export default defineConfig({
  plugins: [playRewrite()],
  server: {
    host: true,
    allowedHosts: [".trycloudflare.com"],
    proxy: {
      "/api": WORKER,
      "/parties": { target: WORKER, ws: true },
    },
  },
  build: {
    rollupOptions: {
      input: Object.fromEntries(["index", "pricing", "account", "terms", "privacy", "play", "404"].map((n) => [n, page(n)])),
    },
  },
});
