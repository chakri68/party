import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { prerender } from "../src/prerender.ts";
import { faqPairs, ldScript, passLd, sitemapXml } from "../src/seo.ts";

const page = (name: string) => readFileSync(resolve(import.meta.dirname, `../${name}.html`), "utf8");
const ld = (html: string) => JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1]!)["@graph"];

describe("prerender", () => {
  it("writes every game and the count into the landing page", () => {
    const out = prerender(page("index"), "index", false);
    expect(out).not.toContain("<noscript><p>Turn on JavaScript");
    expect(out).toContain('<span class="game-name">Doodle Dash</span>');
    const cards = out.match(/<li class="game/g)!.length;
    expect(out).toContain(`<span data-game-count>${cards}</span>`);
  });

  it("gives the home page who we are plus its FAQ", () => {
    const graph = ld(prerender(page("index"), "index", false));
    expect(graph.map((n: { "@type": string }) => n["@type"])).toEqual(["WebSite", "Organization", "FAQPage"]);
    expect(graph[2].mainEntity[0]).toMatchObject({ name: "Do my friends need an account?" });
  });

  it("gives pricing Host Pass offers and its FAQ, and nothing to legal pages", () => {
    const graph = ld(prerender(page("pricing"), "pricing", false));
    expect(graph.map((n: { "@type": string }) => n["@type"])).toEqual(["Product", "FAQPage"]);
    expect(prerender(page("terms"), "terms", false)).not.toContain("ld+json");
  });
});

describe("seo", () => {
  it("reads FAQ text without tags", () => {
    expect(faqPairs("<details><summary>How many?</summary><p>Up to <span data-free-cap>8</span>.</p></details>")).toEqual([{ q: "How many?", a: "Up to 8." }]);
  });

  it("prices each plan, PreOrder until buying is on", () => {
    const offers = (passLd(false) as { offers: Array<{ price: string; priceCurrency: string; availability: string }> }).offers;
    expect(offers.map((o) => `${o.priceCurrency} ${o.price}`)).toEqual(["INR 49.00", "INR 149.00", "INR 999.00", "USD 4.99", "USD 39.00"]);
    expect(offers.every((o) => o.availability.endsWith("PreOrder"))).toBe(true);
    expect((passLd(true) as { offers: Array<{ availability: string }> }).offers[0]!.availability).toBe("https://schema.org/InStock");
  });

  it("can't be closed early by text in the data", () => {
    expect(ldScript([{ name: "</script><b>" }])).not.toContain("</script><b>");
  });

  it("writes lastmod only when known", () => {
    const xml = sitemapXml([{ path: "/", lastmod: "2026-11-12" }, { path: "/terms", lastmod: null }]);
    expect(xml).toContain("<loc>https://couchpartygames.com/</loc><lastmod>2026-11-12</lastmod>");
    expect(xml).toContain("<loc>https://couchpartygames.com/terms</loc></url>");
  });
});
