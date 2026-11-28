import { chipIcon } from "@games/ui";
import { cardFaces } from "@games/ui/cards";
import { formatRank, rankName } from "../shared/rules.ts";
import type { Card, Rank } from "../shared/types.ts";

// The shared card faces (@games/ui), with Blackjack's ranks: the Ace is 1.
const faces = cardFaces<Rank>({ short: formatRank, name: rankName });
export const cardLabel = faces.label;

/** `flip`: the card was just dealt, so it turns over as it lands. */
function flipped(el: HTMLElement, flip: boolean): HTMLElement {
  if (flip) el.classList.add("flip");
  return el;
}

// No data-card: ids repeat across a shoe of several decks, and nothing looks cards up by id.
/** A full card face: the dealer's cards and yours. */
export const cardFace = (c: Card, flip = false) => flipped(faces.face({ suit: c.suit, rank: c.rank }), flip);
/** A seat-sized face: rank over suit, nothing else fits. */
export const cardMini = (c: Card, flip = false) => flipped(faces.mini({ suit: c.suit, rank: c.rank }), flip);
export const cardBack = () => faces.back({ label: "Face-down card" });
export const cardSlot = faces.slot;

/** One play chip, drawn. Decorative. */
export const chip = () => chipIcon("bj-chip");
