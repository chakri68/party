// Search-engine extras the build adds to the pages: JSON-LD and the sitemap.
// Pure string work, so vite.config.ts and the tests can both run it.

import { PLANS, plansFor } from "@games/product-server/billing-plans";

export const ORIGIN = "https://couchpartygames.com";

const strip = (html: string) =>
  html
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

/** Question/answer pairs from a page's `<details><summary>Q</summary><p>A</p>` FAQ. */
export function faqPairs(html: string): Array<{ q: string; a: string }> {
  return [...html.matchAll(/<details>\s*<summary>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/g)].map((m) => ({ q: strip(m[1]!), a: strip(m[2]!) }));
}

export function faqLd(html: string): object | null {
  const pairs = faqPairs(html);
  if (pairs.length === 0) return null;
  return {
    "@type": "FAQPage",
    mainEntity: pairs.map(({ q, a }) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })),
  };
}

/** Who we are, for the home page. Google uses this for the brand name and logo. */
export function siteLd(): object[] {
  return [
    { "@type": "WebSite", "@id": `${ORIGIN}/#website`, name: "CouchParty", url: `${ORIGIN}/`, publisher: { "@id": `${ORIGIN}/#org` } },
    {
      "@type": "Organization",
      "@id": `${ORIGIN}/#org`,
      name: "CouchParty",
      url: `${ORIGIN}/`,
      logo: `${ORIGIN}/icon-512.png`,
      email: "hello@couchpartygames.com",
    },
  ];
}

/**
 * Host Pass with one offer per plan and currency. While buying is off, the
 * offers say PreOrder, so search results never promise a Buy button we hide.
 */
export function passLd(onSale: boolean): object {
  const availability = `https://schema.org/${onSale ? "InStock" : "PreOrder"}`;
  const offer = (currency: string, minor: number, length: string) => ({
    "@type": "Offer",
    name: `Host Pass, ${length}`,
    price: (minor / 100).toFixed(2),
    priceCurrency: currency,
    availability,
    url: `${ORIGIN}/pricing`,
  });
  return {
    "@type": "Product",
    name: "Host Pass",
    description: "Opens every CouchParty game and bigger rooms for everyone in the host's room. One payment, nothing renews.",
    brand: { "@id": `${ORIGIN}/#org` },
    image: `${ORIGIN}/og-image.png`,
    offers: [
      ...plansFor("razorpay").map((p) => offer("INR", PLANS[p].inr, PLANS[p].length)),
      ...plansFor("paddle").map((p) => offer("USD", PLANS[p].usd!, PLANS[p].length)),
    ],
  };
}

/** One `<script type="application/ld+json">` holding every node, or "" for none. */
export function ldScript(nodes: Array<object | null>): string {
  const graph = nodes.filter((n): n is object => n !== null);
  if (graph.length === 0) return "";
  // "<" escaped so text in the data can never close the script tag.
  const json = JSON.stringify({ "@context": "https://schema.org", "@graph": graph }).replace(/</g, "\\u003c");
  return `<script type="application/ld+json">${json}</script>`;
}

export function sitemapXml(pages: Array<{ path: string; lastmod: string | null }>): string {
  const urls = pages.map(({ path, lastmod }) => `  <url><loc>${ORIGIN}${path}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}</url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
}
