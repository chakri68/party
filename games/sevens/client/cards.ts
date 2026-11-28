import { cardFaces } from "@games/ui/cards";
import { formatRank, rankName } from "../shared/rules.ts";
import type { Card, Rank } from "../shared/types.ts";

// The shared card faces (@games/ui/cards), with Sevens' ranks: the Ace is 1 or 14.
const faces = cardFaces<Rank>({ short: formatRank, name: rankName });

export const { label: cardLabel, short: cardShort, tinyBack: cardBack } = faces;

/** The board size: rank over suit. No data-card: with two decks, ids repeat on the board. */
export const miniCard = (c: Pick<Card, "suit" | "rank">) => faces.mini({ suit: c.suit, rank: c.rank });

/** A hand card: corners and a pip, and a button so the hand is keyboard-reachable. */
export const fullCard = (c: Card) => faces.handCard(c);
