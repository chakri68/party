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
export const cardLabel = (c: Face) => (c.suit === "joker" ? "Joker" : `${rankName(c.rank)} of ${SUIT_NAME[c.suit]}`);
export const cardShort = (c: Face) => (c.suit === "joker" ? "the joker" : `${formatRank(c.rank)}${SUIT_SYMBOL[c.suit]}`);

const isFace = (rank: number) => rank > 10;

/**
 * A jester's cap: three floppy points with a bell on each, over a band. The
 * gaps between points are card-coloured strokes, so it reads at pip size.
 */
const JESTER_CAP = `<svg viewBox="-2 0 104 92" aria-hidden="true">
  <g fill="currentColor" stroke="var(--card)" stroke-width="2.5" stroke-linejoin="round">
    <path d="M26 71 C24 54 16 44 6 42 C3 36 10 31 18 32 C33 34 43 50 47 69 Z"/>
    <path d="M74 71 C76 54 84 44 94 42 C97 36 90 31 82 32 C67 34 57 50 53 69 Z"/>
    <path d="M64 70 C67 45 60 22 41 12 C36 10 33 15 38 18 C47 27 43 47 36 70 Z"/>
    <path d="M20 70 Q50 81 80 70 L82 81 Q50 93 18 81 Z"/>
  </g>
  <g fill="currentColor">
    <circle cx="6" cy="50" r="5.5"/>
    <circle cx="94" cy="50" r="5.5"/>
    <circle cx="35" cy="11" r="5.5"/>
  </g>
</svg>`;

function faceParts(c: Face): Node[] {
  if (c.suit === "joker") {
    const corner = (pos: string) =>
      h("span", { class: `corner word ${pos}`, "aria-hidden": "true" }, [..."JOKER"].map((l) => h("span", {}, l)));
    const pip = h("span", { class: "pip joker", "aria-hidden": "true" });
    pip.innerHTML = JESTER_CAP;
    return [corner("tl"), pip, corner("br")];
  }
  const suit = c.suit;
  const corner = (pos: string) =>
    h("span", { class: `corner ${pos}`, "aria-hidden": "true" }, h("b", {}, formatRank(c.rank)), h("i", {}, SUIT_SYMBOL[suit]));
  return [
    corner("tl"),
    h("span", { class: `pip${isFace(c.rank) ? " face" : ""}`, "aria-hidden": "true" }, isFace(c.rank) ? formatRank(c.rank) : SUIT_SYMBOL[suit]),
    corner("br"),
  ];
}

/** A card face: hand cards, the pile, and animation ghosts. Nothing in Old Maid is pressed face up. */
export function cardFace(c: Card | Face): HTMLElement {
  const id = "id" in c ? c.id : undefined;
  return h(
    "span",
    { class: `om-card${isRed(c) ? " red" : ""}${c.suit === "joker" ? " joker" : ""}`, role: "img", "aria-label": cardLabel(c), "data-card": id },
    faceParts(c),
  );
}

/** A full-size card back, for the fan you pick from and cards in flight. */
export function cardBackFull(): HTMLElement {
  return h("span", { class: "om-card back", "aria-hidden": "true" });
}

/** A small card back, for opponents' hand sizes. */
export function cardBackMini(): HTMLElement {
  return h("span", { class: "om-back-mini", "aria-hidden": "true" });
}
