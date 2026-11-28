import { cardFaces } from "@games/ui/cards";
import { formatRank, rankName } from "../shared/rules.ts";
import type { Rank, Title } from "../shared/types.ts";

// The shared card faces (@games/ui/cards), with President's ranks: the Ace is 1.
export const {
  face: cardFace,
  handCard,
  back: cardBackFull,
  tinyBack: cardBackMini,
  slot: cardSlot,
  label: cardLabel,
  short: cardShort,
} = cardFaces<Rank>({ short: formatRank, name: rankName });

/** The full title, spelled out. Citizens get no tag. */
export const TITLE_TAG: Record<Title, string | null> = {
  President: "President",
  "Vice-President": "Vice-President",
  Citizen: null,
  "Vice-Beggar": "Vice-Beggar",
  Beggar: "Beggar",
};
