import {
  SUITS,
  type AcePosition,
  type Card,
  type DeckSetting,
  type Rank,
  type SevensBoardState,
  type Suit,
} from "./types.ts";

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

/** "hearts-8" for the first deck, "hearts-8~1" for the second, and so on. */
export function formatCardId(suit: Suit, rank: Rank, copy = 0): string {
  return `${suit}-${formatRank(rank)}${copy ? `~${copy}` : ""}`;
}

export function parseCardId(id: string, acePosition: AcePosition): Card | null {
  const m = /^([a-z]+)-(A|J|Q|K|10|[2-9])(?:~([1-9]))?$/.exec(id);
  if (!m) return null;
  const suit = m[1] as Suit;
  if (!SUITS.includes(suit)) return null;
  const label = m[2]!;
  const rank =
    label === "A" ? aceRank(acePosition) : label === "J" ? 11 : label === "Q" ? 12 : label === "K" ? 13 : Number(label);
  return { id, suit, rank, copy: m[3] ? Number(m[3]) : 0 };
}

export function makeCard(suit: Suit, rank: Rank, copy = 0): Card {
  return { id: formatCardId(suit, rank, copy), suit, rank, copy };
}

/** `decks` × 52 cards, in deck/suit/rank order. */
export function makeDeck(acePosition: AcePosition, decks = 1): Card[] {
  const { min, max } = rowBounds(acePosition);
  const deck: Card[] = [];
  for (let copy = 0; copy < decks; copy++) {
    for (const suit of SUITS) for (let r = min; r <= max; r++) deck.push(makeCard(suit, r, copy));
  }
  return deck;
}

export function compareCards(a: Card, b: Card): number {
  return SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit) || a.rank - b.rank || a.copy - b.copy;
}

/**
 * "auto" keeps hands a sensible size: one deck up to 6 players (≥8 cards
 * each), two up to 12, three beyond.
 */
export function resolveDecks(setting: DeckSetting, players: number): number {
  if (setting !== "auto") return setting;
  return players <= 6 ? 1 : players <= 12 ? 2 : 3;
}

// ---------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------

export const SEVEN: Rank = 7;

export const isSevenOfDiamonds = (c: Pick<Card, "suit" | "rank">) => c.suit === "diamonds" && c.rank === SEVEN;

export function emptyBoard(decks = 1): SevensBoardState {
  const rows = () => Array.from({ length: decks }, () => null);
  return { spades: rows(), hearts: rows(), diamonds: rows(), clubs: rows() };
}

export function isBoardEmpty(board: SevensBoardState): boolean {
  return SUITS.every((s) => board[s].every((row) => row === null));
}

/**
 * Where `card` would go, or -1. A Seven opens the first unstarted row of its
 * suit; anything else extends the first row it sits directly next to. With
 * several decks the copies are identical, so first-fit is as good as any.
 * Cards outside the row bounds don't exist, so no bounds check is needed.
 */
export function findRow(card: Pick<Card, "suit" | "rank">, board: SevensBoardState): number {
  const rows = board[card.suit];
  if (card.rank === SEVEN) return rows.findIndex((row) => row === null);
  return rows.findIndex((row) => row !== null && (card.rank === row.low - 1 || card.rank === row.high + 1));
}

export function isPlayable(card: Pick<Card, "suit" | "rank">, board: SevensBoardState): boolean {
  return findRow(card, board) >= 0;
}

/**
 * Playable cards in a hand. With "seven-of-diamonds", the opening play of the
 * game must be a seven of diamonds (any copy).
 */
export function getPlayableCards(
  hand: readonly Card[],
  board: SevensBoardState,
  startingRule: "dealer-left" | "seven-of-diamonds" = "dealer-left",
): Card[] {
  if (startingRule === "seven-of-diamonds" && isBoardEmpty(board)) return hand.filter(isSevenOfDiamonds);
  return hand.filter((c) => isPlayable(c, board));
}

/** Places `card` (caller checked it's playable) and says which row it went to. */
export function placeCard(board: SevensBoardState, card: Pick<Card, "suit" | "rank">): { board: SevensBoardState; row: number } {
  const row = findRow(card, board);
  if (row < 0) throw new Error(`sevens: ${card.suit} ${card.rank} doesn't fit`);
  const rows = [...board[card.suit]];
  const cur = rows[row];
  rows[row] = cur
    ? { low: Math.min(cur.low, card.rank), high: Math.max(cur.high, card.rank) }
    : { low: card.rank, high: card.rank };
  return { board: { ...board, [card.suit]: rows }, row };
}
