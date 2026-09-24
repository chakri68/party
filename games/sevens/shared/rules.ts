import { SUITS, type AcePosition, type Card, type Rank, type SevensBoardState, type Suit } from "./types.ts";

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

const FACE_LABELS: Record<number, string> = { 1: "A", 11: "J", 12: "Q", 13: "K", 14: "A" };
const FACE_NAMES: Record<number, string> = { 1: "Ace", 11: "Jack", 12: "Queen", 13: "King", 14: "Ace" };
const NUMBER_NAMES = ["", "", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];

export function aceRank(acePosition: AcePosition): Rank {
  return acePosition === "high" ? 14 : 1;
}

/** Lowest and highest rank in a row, inclusive. */
export function rowBounds(acePosition: AcePosition): { min: Rank; max: Rank } {
  return acePosition === "high" ? { min: 2, max: 14 } : { min: 1, max: 13 };
}

export function formatRank(rank: Rank): string {
  return FACE_LABELS[rank] ?? String(rank);
}

export function rankName(rank: Rank): string {
  return FACE_NAMES[rank] ?? NUMBER_NAMES[rank] ?? String(rank);
}

export function formatCardId(suit: Suit, rank: Rank): string {
  return `${suit}-${formatRank(rank)}`;
}

export function parseCardId(id: string, acePosition: AcePosition): Card | null {
  const dash = id.indexOf("-");
  if (dash < 0) return null;
  const suit = id.slice(0, dash) as Suit;
  const label = id.slice(dash + 1);
  if (!SUITS.includes(suit)) return null;
  let rank: number;
  if (label === "A") rank = aceRank(acePosition);
  else if (label === "J") rank = 11;
  else if (label === "Q") rank = 12;
  else if (label === "K") rank = 13;
  else if (/^(?:[2-9]|10)$/.test(label)) rank = Number(label);
  else return null;
  return { id, suit, rank };
}

export function makeCard(suit: Suit, rank: Rank): Card {
  return { id: formatCardId(suit, rank), suit, rank };
}

/** All 52 cards, in suit/rank order. */
export function makeDeck(acePosition: AcePosition): Card[] {
  const { min, max } = rowBounds(acePosition);
  const deck: Card[] = [];
  for (const suit of SUITS) for (let r = min; r <= max; r++) deck.push(makeCard(suit, r));
  return deck;
}

export function compareCards(a: Card, b: Card): number {
  return SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit) || a.rank - b.rank;
}

// ---------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------

export const SEVEN: Rank = 7;
export const SEVEN_OF_DIAMONDS = "diamonds-7";

export function emptyBoard(): SevensBoardState {
  return { spades: null, hearts: null, diamonds: null, clubs: null };
}

export function isBoardEmpty(board: SevensBoardState): boolean {
  return SUITS.every((s) => board[s] === null);
}

/**
 * A Seven opens its suit; anything else must sit directly next to an exposed end.
 * Cards outside the row bounds don't exist, so no bounds check is needed.
 */
export function isPlayable(card: Card, board: SevensBoardState): boolean {
  const row = board[card.suit];
  if (!row) return card.rank === SEVEN;
  return card.rank === row.low - 1 || card.rank === row.high + 1;
}

/**
 * Playable cards in a hand. With "seven-of-diamonds", the opening play of the
 * game must be exactly that card.
 */
export function getPlayableCards(
  hand: readonly Card[],
  board: SevensBoardState,
  startingRule: "dealer-left" | "seven-of-diamonds" = "dealer-left",
): Card[] {
  if (startingRule === "seven-of-diamonds" && isBoardEmpty(board)) {
    return hand.filter((c) => c.id === SEVEN_OF_DIAMONDS);
  }
  return hand.filter((c) => isPlayable(c, board));
}

/** Returns a new board with `card` placed. Caller must have checked `isPlayable`. */
export function placeCard(board: SevensBoardState, card: Card): SevensBoardState {
  const row = board[card.suit];
  const next = row
    ? { low: Math.min(row.low, card.rank), high: Math.max(row.high, card.rank) }
    : { low: card.rank, high: card.rank };
  return { ...board, [card.suit]: next };
}

/** Ranks currently on the board for a suit, low → high. */
export function playedRanks(board: SevensBoardState, suit: Suit): Rank[] {
  const row = board[suit];
  if (!row) return [];
  const out: Rank[] = [];
  for (let r = row.low; r <= row.high; r++) out.push(r);
  return out;
}
