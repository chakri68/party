import { SUITS, type Card, type Rank, type Suit } from "./types.ts";

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

const FACE_LABELS: Record<number, string> = { 1: "A", 11: "J", 12: "Q", 13: "K" };
const FACE_NAMES: Record<number, string> = { 1: "Ace", 11: "Jack", 12: "Queen", 13: "King" };
const NUMBER_NAMES = ["", "", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];

export function formatRank(rank: Rank): string {
  return FACE_LABELS[rank] ?? String(rank);
}

export function rankName(rank: Rank): string {
  return FACE_NAMES[rank] ?? NUMBER_NAMES[rank] ?? String(rank);
}

/** "Sevens", "Sixes", "Aces". What you'd say out loud when asking. */
export function rankPlural(rank: Rank): string {
  const name = rankName(rank);
  return name.endsWith("x") ? `${name}es` : `${name}s`;
}

export function formatCardId(suit: Suit, rank: Rank): string {
  return `${suit}-${formatRank(rank)}`;
}

export function parseCardId(id: string): Card | null {
  const m = /^([a-z]+)-(A|J|Q|K|10|[2-9])$/.exec(id);
  if (!m) return null;
  const suit = m[1] as Suit;
  if (!SUITS.includes(suit)) return null;
  const label = m[2]!;
  const rank = label === "A" ? 1 : label === "J" ? 11 : label === "Q" ? 12 : label === "K" ? 13 : Number(label);
  return { id, suit, rank };
}

export function makeCard(suit: Suit, rank: Rank): Card {
  return { id: formatCardId(suit, rank), suit, rank };
}

/** The 52, in suit/rank order. */
export function makeDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) for (let r = 1; r <= 13; r++) deck.push(makeCard(suit, r));
  return deck;
}

/** Rank, then suit: a rank's cards sit together, which is the whole game. */
export function compareCards(a: Card, b: Card): number {
  return a.rank - b.rank || SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit);
}

/** Seven each for two or three players, five for more (Bicycle). */
export function handSize(players: number): number {
  return players <= 3 ? 7 : 5;
}

export function pondAfterDeal(players: number): number {
  return 52 - handSize(players) * players;
}

// ---------------------------------------------------------------------------
// Books
// ---------------------------------------------------------------------------

/** Splits a hand into books (all four of a rank) and what's left. */
export function takeBooks(hand: readonly Card[]): { books: Card[][]; rest: Card[] } {
  const byRank = new Map<Rank, Card[]>();
  for (const c of hand) byRank.set(c.rank, [...(byRank.get(c.rank) ?? []), c]);
  const books = [...byRank.values()].filter((cards) => cards.length === 4).sort((a, b) => a[0]!.rank - b[0]!.rank);
  const booked = new Set(books.flat().map((c) => c.id));
  return { books, rest: hand.filter((c) => !booked.has(c.id)) };
}

/** The distinct ranks in a hand, low to high. You can only ask for these. */
export function ranksHeld(hand: readonly Card[]): Rank[] {
  return [...new Set(hand.map((c) => c.rank))].sort((a, b) => a - b);
}
