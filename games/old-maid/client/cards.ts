import { h } from "@games/ui";
import { cardFaces } from "@games/ui/cards";
import { formatRank, rankName } from "../shared/rules.ts";
import type { Card, Rank, Suit } from "../shared/types.ts";

// The shared card faces (@games/ui/cards), with Old Maid's ranks: the Ace is 1.
// The joker is Old Maid's own, so it branches off before the shared face.
const faces = cardFaces<Rank>({ short: formatRank, name: rankName });

type Face = { suit: Suit | "joker"; rank: Rank; id?: string };
const standard = (c: Face) => ({ suit: c.suit as Suit, rank: c.rank, id: c.id });

export const cardLabel = (c: Face) => (c.suit === "joker" ? "Joker" : faces.label(standard(c)));
export const cardShort = (c: Face) => (c.suit === "joker" ? "the joker" : faces.short(standard(c)));
export const { back: cardBackFull, tinyBack: cardBackTiny, slot: cardSlot } = faces;

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

/** The joker: "JOKER" stacked down the corners, a jester's cap in the middle. */
function jokerFace(id: string | undefined): HTMLElement {
  const corner = (pos: string) => h("span", { class: `corner word ${pos}`, "aria-hidden": "true" }, [..."JOKER"].map((l) => h("span", {}, l)));
  const pip = h("span", { class: "pip joker", "aria-hidden": "true" });
  pip.innerHTML = JESTER_CAP;
  return h("span", { class: "pcard om-joker", role: "img", "aria-label": "Joker", "data-card": id }, corner("tl"), pip, corner("br"));
}

/** A card face: hand cards, the pile, and animation ghosts. Nothing in Old Maid is pressed face up. */
export function cardFace(c: Card | Face): HTMLElement {
  return c.suit === "joker" ? jokerFace(c.id) : faces.face(standard(c));
}
