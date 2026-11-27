import { cardFaces, h } from "@games/ui";
import { formatRank, rankName } from "../shared/rules.ts";
import type { Rank } from "../shared/types.ts";

// The shared card faces (@games/ui), with Teen Patti's ranks: the Ace is 14.
export const {
  face: cardFace,
  mini: cardMini,
  back: cardBack,
  miniBack,
  label: cardLabel,
  list: cardList,
} = cardFaces<Rank>({ short: formatRank, name: rankName });

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
