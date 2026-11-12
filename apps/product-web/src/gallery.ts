// The landing page's game list. Vite runs this at build time (see vite.config.ts)
// and writes the list into index.html, so crawlers and link previews see every
// game without running any JS. The browser never loads this file.

import { PREMIUM_GAME_IDS, PRODUCT_NAMES } from "@games/product-server/catalog-data";
import { GAME_SECTIONS, games, overrideGameNames } from "@games/web/games";

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

// Small line drawings, one per section. Same stroke style as the shell's icons.
const SECTION_ICONS: Record<string, string> = {
  cards: `<rect x="3" y="5" width="11" height="15" rx="2" transform="rotate(-10 8.5 12.5)"/><rect x="10" y="4" width="11" height="15" rx="2" transform="rotate(8 15.5 11.5)"/>`,
  dice: `<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><circle cx="8.5" cy="8.5" r="1.3" fill="currentColor"/><circle cx="15.5" cy="15.5" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/>`,
  words: `<path d="M20.5 11.5a8 8 0 0 1-11.9 7L4 19.5l1.1-4.3a8 8 0 1 1 15.4-3.7z"/><path d="M8.5 12h7"/>`,
  roles: `<path d="M3 9c3-3 15-3 18 0-1 6-4 9-9 9s-8-3-9-9z"/><path d="M8 11.5h2M14 11.5h2"/>`,
  racing: `<path d="M5 21V4"/><path d="M5 4h13l-2.5 4L18 12H5"/>`,
  strategy: `<path d="M12 3 20 7.5v9L12 21l-8-4.5v-9z"/><path d="M12 12 20 7.5M12 12v9M12 12 4 7.5"/>`,
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function sectionIcon(id: string): string {
  const body = SECTION_ICONS[id] ?? SECTION_ICONS.cards;
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

/** The list as HTML. `data-reveal` lets each shelf scroll in, see revealOnScroll. */
export function galleryHtml(model: GallerySection[]): string {
  return model
    .map((s) => {
      const items = s.games
        .map((g) => {
          const tag = g.pass ? `<span class="tag-pass">Host Pass</span>` : "";
          return `<li class="${g.pass ? "game game-pass" : "game"}"><div class="game-top"><span class="game-name">${esc(g.name)}</span>${tag}</div><p class="game-desc">${esc(g.description)}</p><p class="game-players">${esc(g.players)}</p></li>`;
        })
        .join("");
      return `<section class="shelf" data-reveal aria-labelledby="shelf-${s.id}"><h3 class="shelf-head" id="shelf-${s.id}"><span class="shelf-icon">${sectionIcon(s.id)}</span><span>${esc(s.section)}</span></h3><ul class="shelf-games">${items}</ul></section>`;
    })
    .join("\n");
}

export function gameCount(model: GallerySection[]): number {
  return model.reduce((n, s) => n + s.games.length, 0);
}
