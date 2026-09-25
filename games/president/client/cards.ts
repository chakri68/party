import { h } from "@games/ui";
import { formatRank, rankName } from "../shared/rules.ts";
import type { Card, Suit, Title } from "../shared/types.ts";

// U+FE0E asks for text presentation; without it some platforms draw ♥ as an emoji.
export const SUIT_SYMBOL: Record<Suit, string> = {
  spades: "♠︎",
  hearts: "♥︎",
  diamonds: "♦︎",
  clubs: "♣︎",
};
export const SUIT_NAME: Record<Suit, string> = { spades: "Spades", hearts: "Hearts", diamonds: "Diamonds", clubs: "Clubs" };

/** Short enough for a player chip. The full title rides along as a tooltip. */
export const TITLE_TAG: Record<Title, string | null> = {
  President: "Pres",
  "Vice-President": "VP",
  Citizen: null,
  "Vice-Asshole": "VA",
  Asshole: "A-hole",
};

type Face = Pick<Card, "suit" | "rank">;

export const isRed = (suit: Suit) => suit === "hearts" || suit === "diamonds";
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

/** A card face you can't press: the pile, and animation ghosts. */
export function cardFace(c: Card | Face): HTMLElement {
  const id = "id" in c ? c.id : undefined;
  return h("span", { class: `pr-card${isRed(c.suit) ? " red" : ""}`, role: "img", "aria-label": cardLabel(c), "data-card": id }, faceParts(c));
}

/** A hand card: a button, so the hand is keyboard-reachable. */
export function handCard(c: Card): HTMLButtonElement {
  return h(
    "button",
    { type: "button", class: `pr-card${isRed(c.suit) ? " red" : ""}`, "aria-label": cardLabel(c), "data-card": c.id },
    faceParts(c),
  );
}

/** A full-size card back, for cards in flight between other players. */
export function cardBackFull(): HTMLElement {
  return h("span", { class: "pr-card back", "aria-hidden": "true" });
}

/** A small card back, for opponents' hand sizes. */
export function cardBackMini(): HTMLElement {
  return h("span", { class: "pr-back-mini", "aria-hidden": "true" });
}
