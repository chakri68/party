// The standard 52-card faces the card games share: the same corners, pips,
// serif face letters, striped backs and seat-sized minis everywhere. The look
// is in cards.css, loaded with this module, so import it from "@games/ui/cards"
// (not the package root): only the card games then load that CSS. A game binds
// its own rank text once (`cardFaces`) and sizes the cards with the custom
// properties listed in cards.css; its own variants (best, dim, selected, fans)
// stay in its styles, under its root class.
import "./cards.css";
import { h } from "./dom.ts";
import { joinList } from "./text.ts";

export type CardSuit = "spades" | "hearts" | "diamonds" | "clubs";

/** U+FE0E asks for text presentation; without it some platforms draw a heart as an emoji. */
export const SUIT_SYMBOL: Record<CardSuit, string> = { spades: "♠︎", hearts: "♥︎", diamonds: "♦︎", clubs: "♣︎" };
export const SUIT_NAME: Record<CardSuit, string> = { spades: "Spades", hearts: "Hearts", diamonds: "Diamonds", clubs: "Clubs" };

export const isRedSuit = (suit: CardSuit) => suit === "hearts" || suit === "diamonds";

/** What a face needs. `rank` is the game's own (an Ace may be 1 or 14). */
export interface FaceCard<R> {
  suit: CardSuit;
  rank: R;
  /** Put on the element as `data-card`, when there is one. */
  id?: string;
}

/** How the game writes its ranks. */
export interface RankText<R> {
  /** The corner text: "A", "10", "K". */
  short(rank: R): string;
  /** The spoken name: "Ace", "Ten", "King". */
  name(rank: R): string;
}

export interface BackOptions {
  /** Names the back for a screen reader; without one it's decorative. */
  label?: string;
}

export interface CardFaces<R> {
  /** "Ace of Spades": every face's accessible name. */
  label(c: FaceCard<R>): string;
  /** "Ace of Spades, Nine of Hearts and Two of Clubs". */
  list(cards: readonly FaceCard<R>[]): string;
  /** "A♠︎", for log lines. */
  short(c: FaceCard<R>): string;
  /** A face you can't press: `span.pcard`, two corners and a pip (a letter on J, Q, K). */
  face(c: FaceCard<R>): HTMLElement;
  /** The same face as a button, for a hand you pick from. */
  handCard(c: FaceCard<R>): HTMLButtonElement;
  /** A seat-sized face, rank over suit: `span.pcard-mini`. */
  mini(c: FaceCard<R>): HTMLElement;
  /** A face-down card. Decorative, unless given a `label` ("Face-down card"). */
  back(opts?: BackOptions): HTMLElement;
  /** A seat-sized face-down card. Decorative. */
  miniBack(): HTMLElement;
  /** An empty spot where a card will go. Decorative. */
  slot(): HTMLElement;
}

const FACE_LETTERS = new Set(["J", "Q", "K"]);

/** The faces for one game's ranks. Every function stands alone, so they can be destructured. */
export function cardFaces<R>(ranks: RankText<R>): CardFaces<R> {
  const label = (c: FaceCard<R>) => `${ranks.name(c.rank)} of ${SUIT_NAME[c.suit]}`;
  const red = (c: FaceCard<R>) => (isRedSuit(c.suit) ? " red" : "");
  const parts = (c: FaceCard<R>): Node[] => {
    const rank = ranks.short(c.rank);
    const symbol = SUIT_SYMBOL[c.suit];
    const corner = (pos: string) => h("span", { class: `corner ${pos}`, "aria-hidden": "true" }, h("b", {}, rank), h("i", {}, symbol));
    const face = FACE_LETTERS.has(rank);
    return [corner("tl"), h("span", { class: face ? "pip face" : "pip", "aria-hidden": "true" }, face ? rank : symbol), corner("br")];
  };
  return {
    label,
    list: (cards) => joinList(cards.map(label)),
    short: (c) => `${ranks.short(c.rank)}${SUIT_SYMBOL[c.suit]}`,
    face: (c) => h("span", { class: `pcard${red(c)}`, role: "img", "aria-label": label(c), "data-card": c.id }, parts(c)),
    handCard: (c) => h("button", { type: "button", class: `pcard${red(c)}`, "aria-label": label(c), "data-card": c.id }, parts(c)),
    mini: (c) =>
      h(
        "span",
        { class: `pcard-mini${red(c)}`, role: "img", "aria-label": label(c), "data-card": c.id },
        h("b", { "aria-hidden": "true" }, ranks.short(c.rank)),
        h("i", { "aria-hidden": "true" }, SUIT_SYMBOL[c.suit]),
      ),
    back: ({ label: name } = {}) =>
      h("span", name ? { class: "pcard back", role: "img", "aria-label": name } : { class: "pcard back", "aria-hidden": "true" }),
    miniBack: () => h("span", { class: "pcard-mini back", "aria-hidden": "true" }),
    slot: () => h("span", { class: "pcard slot", "aria-hidden": "true" }),
  };
}
