import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { defineConfig, loadEnv, runnerImport, type Plugin } from "vite";

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

type Prerender = typeof import("./src/prerender.ts");

/**
 * Writes the game list and JSON-LD into the pages (src/prerender.ts), so
 * crawlers see them without running JS, and emits sitemap.xml with each
 * page's last commit date. Runs after sitePartials, so the head is whole.
 */
function prerender(): Plugin {
  const root = import.meta.dirname;
  const entry = resolve(root, "src/prerender.ts");
  let built: Promise<Prerender> | null = null;
  // Prices show as on sale only once the Worker sells them.
  const onSale = /"BILLING"\s*:\s*"1"/.test(readFileSync(resolve(root, "../product-server/wrangler.jsonc"), "utf8"));
  return {
    name: "prerender",
    transformIndexHtml: {
      order: "pre",
      async handler(html, ctx) {
        // Dev reloads the module on change; a build loads it once.
        const mod = ctx.server
          ? ((await ctx.server.ssrLoadModule(entry)) as Prerender)
          : await (built ??= runnerImport<Prerender>(entry, { root, configFile: false }).then((r) => r.module));
        return mod.prerender(html, basename(ctx.filename, ".html"), onSale);
      },
    },
    async generateBundle() {
      const mod = await (built ??= runnerImport<Prerender>(entry, { root, configFile: false }).then((r) => r.module));
      const repo = resolve(root, "../..");
      // Newest commit touching any file the page is made from. No git: no lastmod.
      const lastmod = (files: string[]) => {
        try {
          return execFileSync("git", ["log", "-1", "--format=%cs", "--", ...files], { cwd: repo, encoding: "utf8" }).trim() || null;
        } catch {
          return null;
        }
      };
      const web = "apps/product-web";
      const pages = [
        { path: "/", files: [`${web}/index.html`, `${web}/src/gallery.ts`, "apps/web/src/games.ts", "apps/product-server/src/catalog-data.ts"] },
        { path: "/pricing", files: [`${web}/pricing.html`, "apps/product-server/src/billing/plans.ts"] },
        { path: "/terms", files: [`${web}/terms.html`] },
        { path: "/privacy", files: [`${web}/privacy.html`] },
        { path: "/refunds", files: [`${web}/refunds.html`] },
      ];
      this.emitFile({ type: "asset", fileName: "sitemap.xml", source: mod.sitemapXml(pages.map((p) => ({ path: p.path, lastmod: lastmod(p.files) }))) });
    },
  };
}

const page = (name: string) => resolve(import.meta.dirname, `${name}.html`);

export default defineConfig(({ mode }) => ({
  plugins: [playRewrite(), sitePartials(loadEnv(mode, import.meta.dirname).VITE_CF_BEACON), prerender()],
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
