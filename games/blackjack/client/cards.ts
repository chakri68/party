import { h } from "@games/ui";
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
