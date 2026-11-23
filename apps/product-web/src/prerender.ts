// What the build writes into each page before it ships. Vite loads this file
// through its module runner (see vite.config.ts); the browser never does.

import { FREE_MAX_PLAYERS } from "@games/product-server/catalog-data";
import { gameCount, galleryHtml, galleryModel, listWords, passGameNames } from "./gallery.ts";
import { faqLd, ldScript, passLd, siteLd } from "./seo.ts";

export { sitemapXml } from "./seo.ts";

/** `page` is the HTML file's name without .html: "index", "pricing", … */
export function prerender(html: string, page: string, onSale: boolean): string {
  let out = html;
  if (out.includes("<div data-gallery>")) {
    const model = galleryModel();
    out = out
      .replace(/<div data-gallery>[\s\S]*?<\/div>/, `<div data-gallery>\n${galleryHtml(model)}\n</div>`)
      .replace(/<span data-game-count>\d*<\/span>/g, `<span data-game-count>${gameCount(model)}</span>`);
  }
  // The Host Pass card names the paid games from PREMIUM_GAME_IDS, so it can't fall behind the list.
  // A page that should have the slots but lost them fails the build instead of shipping a stale list.
  if (page === "index" || page === "pricing") {
    for (const marker of ["<li data-pass-games>", "<span data-free-cap>"]) {
      if (!out.includes(marker)) throw new Error(`${page}.html has no ${marker}`);
    }
  }
  out = out
    .replace(/<li data-pass-games>[^<]*<\/li>/g, `<li data-pass-games>${listWords(passGameNames())}</li>`)
    .replace(/<span data-free-cap>\d*<\/span>/g, `<span data-free-cap>${FREE_MAX_PLAYERS}</span>`);
  const ld = page === "index" ? [...siteLd(), faqLd(out)] : page === "pricing" ? [passLd(onSale), faqLd(out)] : [];
  const script = ldScript(ld);
  return script ? out.replace("</head>", `    ${script}\n  </head>`) : out;
}
