import { cardFaces } from "@games/ui/cards";
import { formatRank, rankName } from "../shared/rules.ts";
import type { Rank } from "../shared/types.ts";

// The shared card faces (@games/ui/cards), with Cheat's ranks: the Ace is 1.
export const {
  face: cardFace,
  handCard,
  back: cardBackFull,
  tinyBack: cardBackTiny,
  slot: cardSlot,
  label: cardLabel,
  short: cardShort,
} = cardFaces<Rank>({ short: formatRank, name: rankName });
