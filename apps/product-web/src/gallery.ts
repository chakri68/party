// The landing page's game list. Vite runs this at build time (see vite.config.ts)
// and writes the list into index.html, so crawlers and link previews see every
// game without running any JS. The browser never loads this file.

import { FREE_MAX_PLAYERS, PREMIUM_GAME_IDS, PRODUCT_NAMES } from "@games/product-server/catalog-data";
import { GAME_SECTIONS, games, overrideGameNames } from "@games/web/games";

overrideGameNames(PRODUCT_NAMES);

export interface GalleryGame {
  id: string;
  name: string;
  description: string;
  /** What the room this game needs allows: a free room stops at FREE_MAX_PLAYERS, a Host Pass room uses the game's own max. */
  players: string;
  /** Only for a free game that takes more players than a free room: its max with Host Pass. */
  passPlayers?: string;
  pass: boolean;
  /** Has computer players, and a free room can use it: the card links to a room with them. */
  computers: boolean;
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
        const pass = PREMIUM_GAME_IDS.includes(gid);
        return { id: gid, name, description, ...playerCounts(lo, hi, pass), pass, computers: e.manifest.computers === true && !pass };
      }),
  })).filter((s) => s.games.length > 0);
}

const count = (lo: number, hi: number) => (lo === hi ? `${lo} players` : `${lo} to ${hi} players`);

/**
 * The counts a card shows. A Host Pass game is played in a pass room, so it
 * gets its own range. A free game is capped at what a free room takes, with
 * the bigger pass room noted when there is one. No game needs more than a
 * free room holds (gallery.test.ts checks), so the range is never empty.
 */
export function playerCounts(lo: number, hi: number, pass: boolean, cap = FREE_MAX_PLAYERS): Pick<GalleryGame, "players" | "passPlayers"> {
  if (pass || hi <= cap) return { players: count(lo, hi) };
  return { players: count(lo, cap), passPlayers: `Up to ${hi} with Host Pass` };
}

/** The Host Pass games' names, in PREMIUM_GAME_IDS order, for the Host Pass card. Games not built are left out. */
export function passGameNames(): string[] {
  return PREMIUM_GAME_IDS.filter((id) => Object.hasOwn(games, id)).map((id) => games[id]!.manifest.name);
}

/** "A, B and C". */
export function listWords(words: string[]): string {
  return words.length < 2 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
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
          const link = g.computers ? `<a class="game-try" href="/play?game=${encodeURIComponent(g.id)}">Play with computers</a>` : "";
          return `<li class="${g.pass ? "game game-pass" : "game"}"><div class="game-top"><span class="game-name">${esc(g.name)}</span>${tag}</div><p class="game-desc">${esc(g.description)}</p><p class="game-players">${esc(g.players)}${g.passPlayers ? `<span class="game-more">${esc(g.passPlayers)}</span>` : ""}</p>${link}</li>`;
        })
        .join("");
      return `<section class="shelf" data-reveal aria-labelledby="shelf-${s.id}"><h3 class="shelf-head" id="shelf-${s.id}"><span class="shelf-icon">${sectionIcon(s.id)}</span><span>${esc(s.section)}</span></h3><ul class="shelf-games">${items}</ul></section>`;
    })
    .join("\n");
}

export function gameCount(model: GallerySection[]): number {
  return model.reduce((n, s) => n + s.games.length, 0);
}
