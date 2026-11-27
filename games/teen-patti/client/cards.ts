// The card faces and chips, drawn like Hold'em's (tp- classes, see styles.css).
import { h } from "@games/ui";
import { formatRank, rankName } from "../shared/rules.ts";
import type { Card, Suit } from "../shared/types.ts";

// U+FE0E asks for text presentation; without it some platforms draw ♥ as an emoji.
export const SUIT_SYMBOL: Record<Suit, string> = {
  spades: "♠︎",
  hearts: "♥︎",
  diamonds: "♦︎",
  clubs: "♣︎",
};
export const SUIT_NAME: Record<Suit, string> = { spades: "Spades", hearts: "Hearts", diamonds: "Diamonds", clubs: "Clubs" };

export const isRed = (suit: Suit) => suit === "hearts" || suit === "diamonds";
export const cardLabel = (c: Pick<Card, "suit" | "rank">) => `${rankName(c.rank)} of ${SUIT_NAME[c.suit]}`;
/** "A, B and C". */
export function joinList(items: readonly string[]): string {
  return items.length < 2 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}
/** "Ace of Spades, Nine of Hearts and Two of Clubs". */
export const cardList = (cards: readonly Pick<Card, "suit" | "rank">[]) => joinList(cards.map(cardLabel));
export const cardShort = (c: Pick<Card, "suit" | "rank">) => `${formatRank(c.rank)}${SUIT_SYMBOL[c.suit]}`;

const isFace = (rank: number) => rank > 10 && rank < 14;

function faceParts(c: Pick<Card, "suit" | "rank">): Node[] {
  const corner = (pos: string) =>
    h("span", { class: `corner ${pos}`, "aria-hidden": "true" }, h("b", {}, formatRank(c.rank)), h("i", {}, SUIT_SYMBOL[c.suit]));
  return [
    corner("tl"),
    h("span", { class: `pip${isFace(c.rank) ? " face" : ""}`, "aria-hidden": "true" }, isFace(c.rank) ? formatRank(c.rank) : SUIT_SYMBOL[c.suit]),
    corner("br"),
  ];
}

/** A full card face: your cards, the show. */
export function cardFace(c: Card): HTMLElement {
  return h("span", { class: `tp-card${isRed(c.suit) ? " red" : ""}`, role: "img", "aria-label": cardLabel(c), "data-card": c.id }, faceParts(c));
}

/** A seat-sized face: rank over suit, nothing else fits. */
export function cardMini(c: Card): HTMLElement {
  return h(
    "span",
    { class: `tp-mini${isRed(c.suit) ? " red" : ""}`, role: "img", "aria-label": cardLabel(c), "data-card": c.id },
    h("b", { "aria-hidden": "true" }, formatRank(c.rank)),
    h("i", { "aria-hidden": "true" }, SUIT_SYMBOL[c.suit]),
  );
}

export function cardBack(): HTMLElement {
  return h("span", { class: "tp-card back", "aria-hidden": "true" });
}

export function miniBack(): HTMLElement {
  return h("span", { class: "tp-mini back", "aria-hidden": "true" });
}

/** One play chip, drawn: a disc with a notched rim. Decorative. */
export function chip(className = ""): HTMLElement {
  const el = h("span", { class: `tp-chip ${className}`.trim(), "aria-hidden": "true" });
  el.innerHTML =
    '<svg viewBox="0 0 20 20" width="100%" height="100%" focusable="false">' +
    '<circle cx="10" cy="10" r="9" fill="currentColor"/>' +
    '<circle cx="10" cy="10" r="6.6" fill="none" stroke="var(--bg)" stroke-width="2.2" stroke-dasharray="3.2 2.7"/>' +
    '<circle cx="10" cy="10" r="3.6" fill="var(--bg)" opacity=".35"/>' +
    "</svg>";
  return el;
}
