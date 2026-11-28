import { cardFaces } from "@games/ui/cards";
import { formatRank, rankName } from "../shared/rules.ts";
import type { Rank } from "../shared/types.ts";

// The shared card faces (@games/ui/cards), with Oh Hell's ranks: the Ace is 14.
export const {
  face: cardFace,
  handCard,
  tinyBack: cardBackTiny,
  slot: cardSlot,
  label: cardLabel,
  short: cardShort,
} = cardFaces<Rank>({ short: formatRank, name: rankName });
