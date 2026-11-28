import { chipIcon } from "@games/ui";
import { cardFaces } from "@games/ui/cards";
import { formatRank, rankName } from "../shared/rules.ts";
import type { Rank } from "../shared/types.ts";

// The shared card faces (@games/ui), with Hold'em's ranks: the Ace is 14.
export const {
  face: cardFace,
  mini: cardMini,
  miniBack,
  slot: cardSlot,
  label: cardLabel,
  list: cardList,
  short: cardShort,
} = cardFaces<Rank>({ short: formatRank, name: rankName });

/** One play chip, drawn. Decorative. */
export const chip = (className = "") => chipIcon(`he-chip ${className}`.trim());
