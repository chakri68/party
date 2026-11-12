import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, loadEnv, type Plugin } from "vite";

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

/**
 * The static pages share a head, header and footer. Each page marks the spot
 * with `<!--site:head-->` etc. and this swaps in partials/<name>.html. Every
 * page, /play too, gets the Cloudflare Web Analytics beacon when a token is set.
 */
function sitePartials(beacon: string | undefined): Plugin {
  const partial = (name: string) => readFileSync(resolve(import.meta.dirname, "partials", `${name}.html`), "utf8").trim();
  return {
    name: "site-partials",
    // "pre", so Vite still bundles the stylesheet the head partial links.
    transformIndexHtml: {
      order: "pre",
      handler(html) {
        let out = html.replace(/<!--site:(\w+)-->/g, (_, name: string) => partial(name));
        if (beacon) {
          const tag = `<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='${JSON.stringify({ token: beacon })}'></script>`;
          out = out.replace("</body>", `${tag}\n</body>`);
        }
        return out;
      },
    },
  };
}

const page = (name: string) => resolve(import.meta.dirname, `${name}.html`);

export default defineConfig(({ mode }) => ({
  plugins: [playRewrite(), sitePartials(loadEnv(mode, import.meta.dirname).VITE_CF_BEACON)],
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
      input: Object.fromEntries(["index", "pricing", "account", "terms", "privacy", "refunds", "play", "404"].map((n) => [n, page(n)])),
    },
  },
}));
