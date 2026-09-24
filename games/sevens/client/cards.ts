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
export const cardShort = (c: Pick<Card, "suit" | "rank">) => `${formatRank(c.rank)}${SUIT_SYMBOL[c.suit]}`;

/**
 * A card face. `mini` is the board size: rank + suit only. `full` has corner
 * indices and a centre pip, and is a button so the hand is keyboard-reachable.
 */
export function miniCard(c: Pick<Card, "suit" | "rank">): HTMLElement {
  return h(
    "span",
    { class: `card mini${isRed(c.suit) ? " red" : ""}`, role: "img", "aria-label": cardLabel(c) },
    h("b", {}, formatRank(c.rank)),
    h("i", {}, SUIT_SYMBOL[c.suit]),
  );
}

export function fullCard(c: Card): HTMLButtonElement {
  const corner = (pos: string) =>
    h("span", { class: `corner ${pos}`, "aria-hidden": "true" }, h("b", {}, formatRank(c.rank)), h("i", {}, SUIT_SYMBOL[c.suit]));
  const btn = h(
    "button",
    { type: "button", class: `card full${isRed(c.suit) ? " red" : ""}`, "aria-label": cardLabel(c), "data-card": c.id },
    corner("tl"),
    h("span", { class: `pip${c.rank > 10 && c.rank < 14 ? " face" : ""}`, "aria-hidden": "true" }, c.rank > 10 && c.rank < 14 ? formatRank(c.rank) : SUIT_SYMBOL[c.suit]),
    corner("br"),
  );
  return btn;
}

/** A small card back, for opponents' hand sizes. */
export function cardBack(): HTMLElement {
  return h("span", { class: "card-back", "aria-hidden": "true" });
}
