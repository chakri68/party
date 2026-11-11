// The public pages: landing (/) and pricing. The HTML carries the words; this
// file fills in the parts that come from data (the game list, the prices).

import { FREE_MAX_PLAYERS, PREMIUM_GAME_IDS, PRODUCT_NAMES } from "@games/product-server/catalog-data";
import { GAME_SECTIONS, games, overrideGameNames } from "@games/web/games";
import { loadConfig } from "./api.ts";

overrideGameNames(PRODUCT_NAMES);

export interface GalleryGame {
  id: string;
  name: string;
  description: string;
  players: string;
  pass: boolean;
}

export interface GallerySection {
  id: string;
  section: string;
  games: GalleryGame[];
}

/** Every built game, grouped under the shell's section headings. Empty sections drop out. */
export function galleryModel(): GallerySection[] {
  return GAME_SECTIONS.map(({ id, label }) => ({
    id,
    section: label as string,
    games: Object.entries(games)
      .filter(([, e]) => e.section === id)
      .map(([gid, e]) => {
        const { name, description, minPlayers: lo, maxPlayers: hi } = e.manifest;
        return { id: gid, name, description, players: lo === hi ? `${lo} players` : `${lo}–${hi} players`, pass: PREMIUM_GAME_IDS.includes(gid) };
      }),
  })).filter((s) => s.games.length > 0);
}

/** Spec §2 placeholder prices. India pays in rupees, everyone else in dollars. */
export function priceTable(country: string | null): Array<{ plan: string; length: string; price: string }> {
  const inr = country === "IN";
  return [
    { plan: "Day", length: "24 hours", price: inr ? "₹49" : "$1.99" },
    { plan: "Month", length: "30 days", price: inr ? "₹149" : "$4.99" },
    { plan: "Year", length: "365 days", price: inr ? "₹999" : "$39" },
  ];
}

// Small line drawings, one per section. Same stroke style as the shell's icons.
const SECTION_ICONS: Record<string, string> = {
  cards: `<rect x="3" y="5" width="11" height="15" rx="2" transform="rotate(-10 8.5 12.5)"/><rect x="10" y="4" width="11" height="15" rx="2" transform="rotate(8 15.5 11.5)"/>`,
  dice: `<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><circle cx="8.5" cy="8.5" r="1.3" fill="currentColor"/><circle cx="15.5" cy="15.5" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/>`,
  words: `<path d="M20.5 11.5a8 8 0 0 1-11.9 7L4 19.5l1.1-4.3a8 8 0 1 1 15.4-3.7z"/><path d="M8.5 12h7"/>`,
  roles: `<path d="M3 9c3-3 15-3 18 0-1 6-4 9-9 9s-8-3-9-9z"/><path d="M8 11.5h2M14 11.5h2"/>`,
  racing: `<path d="M5 21V4"/><path d="M5 4h13l-2.5 4L18 12H5"/>`,
  strategy: `<path d="M12 3 20 7.5v9L12 21l-8-4.5v-9z"/><path d="M12 12 20 7.5M12 12v9M12 12 4 7.5"/>`,
};

function sectionIcon(id: string): string {
  const body = SECTION_ICONS[id] ?? SECTION_ICONS.cards;
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderGallery(root: HTMLElement): void {
  const model = galleryModel();
  const count = model.reduce((n, s) => n + s.games.length, 0);
  for (const c of document.querySelectorAll("[data-game-count]")) c.textContent = String(count);
  root.replaceChildren(
    ...model.map((s) => {
      const section = el("section", "shelf");
      section.setAttribute("aria-labelledby", `shelf-${s.id}`);
      const head = el("h3", "shelf-head");
      head.id = `shelf-${s.id}`;
      const ic = el("span", "shelf-icon");
      ic.innerHTML = sectionIcon(s.id);
      head.append(ic, el("span", "", s.section));
      const list = el("ul", "shelf-games");
      for (const g of s.games) {
        const li = el("li", g.pass ? "game game-pass" : "game");
        const top = el("div", "game-top");
        top.append(el("span", "game-name", g.name));
        if (g.pass) top.append(el("span", "tag-pass", "Host Pass"));
        li.append(top, el("p", "game-desc", g.description), el("p", "game-players", g.players));
        list.append(li);
      }
      section.append(head, list);
      return section;
    }),
  );
}

function renderPrices(country: string | null): void {
  for (const root of document.querySelectorAll<HTMLElement>("[data-prices]")) {
    root.replaceChildren(
      ...priceTable(country).map((p) => {
        const li = el("li", "price");
        li.append(el("span", "price-plan", p.plan), el("span", "price-amount", p.price), el("span", "price-length", p.length));
        return li;
      }),
    );
  }
}

function fillFreeCap(): void {
  for (const c of document.querySelectorAll("[data-free-cap]")) c.textContent = String(FREE_MAX_PLAYERS);
}

/** Wire up whatever data slots this page has. */
export function boot(): void {
  fillFreeCap();
  const gallery = document.querySelector<HTMLElement>("[data-gallery]");
  if (gallery) renderGallery(gallery);
  // The HTML ships the rupee table, so a slow or failed config call still shows prices.
  if (document.querySelector("[data-prices]")) {
    loadConfig()
      .then((c) => renderPrices(c.country ?? null))
      .catch(() => {});
  }
}
