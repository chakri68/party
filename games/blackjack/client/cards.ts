import { h } from "@games/ui";
import { formatRank, rankName } from "../shared/rules.ts";
import type { Card, Suit } from "../shared/types.ts";

// The same 52-card faces as Hold'em: corners, a big pip, serif letters on faces.
// U+FE0E asks for text presentation; without it some platforms draw a heart as an emoji.
export const SUIT_SYMBOL: Record<Suit, string> = { spades: "♠︎", hearts: "♥︎", diamonds: "♦︎", clubs: "♣︎" };
const SUIT_NAME: Record<Suit, string> = { spades: "Spades", hearts: "Hearts", diamonds: "Diamonds", clubs: "Clubs" };

const isRed = (suit: Suit) => suit === "hearts" || suit === "diamonds";
const isFace = (rank: number) => rank > 10;
export const cardLabel = (c: Pick<Card, "suit" | "rank">) => `${rankName(c.rank)} of ${SUIT_NAME[c.suit]}`;

/** A full card face: the dealer's cards and yours. */
export function cardFace(c: Card, flip = false): HTMLElement {
  const corner = (pos: string) =>
    h("span", { class: `corner ${pos}`, "aria-hidden": "true" }, h("b", {}, formatRank(c.rank)), h("i", {}, SUIT_SYMBOL[c.suit]));
  return h(
    "span",
    { class: `bj-card${isRed(c.suit) ? " red" : ""}${flip ? " flip" : ""}`, role: "img", "aria-label": cardLabel(c) },
    corner("tl"),
    h("span", { class: `pip${isFace(c.rank) ? " face" : ""}`, "aria-hidden": "true" }, isFace(c.rank) ? formatRank(c.rank) : SUIT_SYMBOL[c.suit]),
    corner("br"),
  );
}

/** A seat-sized face: rank over suit, nothing else fits. */
export function cardMini(c: Card, flip = false): HTMLElement {
  return h(
    "span",
    { class: `bj-mini${isRed(c.suit) ? " red" : ""}${flip ? " flip" : ""}`, role: "img", "aria-label": cardLabel(c) },
    h("b", { "aria-hidden": "true" }, formatRank(c.rank)),
    h("i", { "aria-hidden": "true" }, SUIT_SYMBOL[c.suit]),
  );
}

export function cardBack(): HTMLElement {
  return h("span", { class: "bj-card back", role: "img", "aria-label": "Face-down card" });
}

/** One play chip, drawn: a disc with a notched rim. Decorative. */
export function chip(): HTMLElement {
  const el = h("span", { class: "bj-chip", "aria-hidden": "true" });
  el.innerHTML =
    '<svg viewBox="0 0 20 20" width="100%" height="100%" focusable="false">' +
    '<circle cx="10" cy="10" r="9" fill="currentColor"/>' +
    '<circle cx="10" cy="10" r="6.6" fill="none" stroke="var(--bg)" stroke-width="2.2" stroke-dasharray="3.2 2.7"/>' +
    '<circle cx="10" cy="10" r="3.6" fill="var(--bg)" opacity=".35"/>' +
    "</svg>";
  return el;
}
