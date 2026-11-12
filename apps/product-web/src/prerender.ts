// What the build writes into each page before it ships. Vite loads this file
// through its module runner (see vite.config.ts); the browser never does.

import { gameCount, galleryHtml, galleryModel } from "./gallery.ts";
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
  const ld = page === "index" ? [...siteLd(), faqLd(out)] : page === "pricing" ? [passLd(onSale), faqLd(out)] : [];
  const script = ldScript(ld);
  return script ? out.replace("</head>", `    ${script}\n  </head>`) : out;
}
