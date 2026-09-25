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

type Face = Pick<Card, "suit" | "rank">;

export const isRed = (c: Face) => c.suit === "hearts" || c.suit === "diamonds";
export const cardLabel = (c: Face) => `${rankName(c.rank)} of ${SUIT_NAME[c.suit]}`;
export const cardShort = (c: Face) => `${formatRank(c.rank)}${SUIT_SYMBOL[c.suit]}`;

const isFace = (rank: number) => rank > 10;

function faceParts(c: Face): Node[] {
  const corner = (pos: string) =>
    h("span", { class: `corner ${pos}`, "aria-hidden": "true" }, h("b", {}, formatRank(c.rank)), h("i", {}, SUIT_SYMBOL[c.suit]));
  return [
    corner("tl"),
    h("span", { class: `pip${isFace(c.rank) ? " face" : ""}`, "aria-hidden": "true" }, isFace(c.rank) ? formatRank(c.rank) : SUIT_SYMBOL[c.suit]),
    corner("br"),
  ];
}

/** A card face you can't press: books on the table, and animation ghosts. */
export function cardFace(c: Face): HTMLElement {
  return h("span", { class: `gf-card${isRed(c) ? " red" : ""}`, role: "img", "aria-label": cardLabel(c) }, faceParts(c));
}

/** A hand card: a button, since tapping one picks its rank to ask for. */
export function handCard(c: Card): HTMLButtonElement {
  return h(
    "button",
    { type: "button", class: `gf-card${isRed(c) ? " red" : ""}`, "aria-label": cardLabel(c), "data-card": c.id },
    faceParts(c),
  );
}

/** A full-size card back, for the pond and for cards in flight. */
export function cardBackFull(): HTMLElement {
  return h("span", { class: "gf-card back", "aria-hidden": "true" });
}

/** A small card back, for opponents' hand sizes. */
export function cardBackMini(): HTMLElement {
  return h("span", { class: "gf-back-mini", "aria-hidden": "true" });
}
