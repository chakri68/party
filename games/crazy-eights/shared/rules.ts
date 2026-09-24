import { EIGHT, HAND_SIZE, SUITS, type Card, type DeckSetting, type Rank, type Suit } from "./types.ts";

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

/** "hearts-8" for the first deck, "hearts-8~1" for the second. */
export function formatCardId(suit: Suit, rank: Rank, copy = 0): string {
  return `${suit}-${formatRank(rank)}${copy ? `~${copy}` : ""}`;
}

export function parseCardId(id: string): Card | null {
  const m = /^([a-z]+)-(A|J|Q|K|10|[2-9])(?:~([1-9]))?$/.exec(id);
  if (!m) return null;
  const suit = m[1] as Suit;
  if (!SUITS.includes(suit)) return null;
  const label = m[2]!;
  const rank = label === "A" ? 1 : label === "J" ? 11 : label === "Q" ? 12 : label === "K" ? 13 : Number(label);
  return { id, suit, rank, copy: m[3] ? Number(m[3]) : 0 };
}

export function makeCard(suit: Suit, rank: Rank, copy = 0): Card {
  return { id: formatCardId(suit, rank, copy), suit, rank, copy };
}

/** `decks` × 52 cards, in deck/suit/rank order. */
export function makeDeck(decks = 1): Card[] {
  const deck: Card[] = [];
  for (let copy = 0; copy < decks; copy++) {
    for (const suit of SUITS) for (let r = 1; r <= 13; r++) deck.push(makeCard(suit, r, copy));
  }
  return deck;
}

/** Suit, then rank, with eights parked at the end: they're the ones you save. */
export function compareCards(a: Card, b: Card): number {
  const eight = Number(a.rank === EIGHT) - Number(b.rank === EIGHT);
  return eight || SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit) || a.rank - b.rank || a.copy - b.copy;
}

/**
 * "auto": one deck up to 5 players, two beyond. At 10 players a single deck
 * would leave one card in the stock, which is technically a game.
 */
export function resolveDecks(setting: DeckSetting, players: number): number {
  if (setting !== "auto") return setting;
  return players <= 5 ? 1 : 2;
}

/** Cards left in the stock after the deal and the starter. */
export function stockAfterDeal(decks: number, players: number): number {
  return 52 * decks - HAND_SIZE * players - 1;
}

// ---------------------------------------------------------------------------
// Play
// ---------------------------------------------------------------------------

/**
 * Eights go on anything. Otherwise follow the suit in force (the called one,
 * after an eight) or match the top card's rank. After an eight, "match the
 * rank" means another eight, which the first check already allows.
 */
export function isPlayable(card: Pick<Card, "suit" | "rank">, top: Pick<Card, "suit" | "rank">, calledSuit: Suit | null): boolean {
  return card.rank === EIGHT || card.suit === (calledSuit ?? top.suit) || card.rank === top.rank;
}

export function getPlayableCards(hand: readonly Card[], top: Card, calledSuit: Suit | null): Card[] {
  return hand.filter((c) => isPlayable(c, top, calledSuit));
}

/** Bicycle's settlement values: eights 50, tens and faces 10, aces 1, the rest at face value. */
export function cardPoints(card: Pick<Card, "rank">): number {
  if (card.rank === EIGHT) return 50;
  if (card.rank >= 10) return 10;
  return card.rank;
}

export function handPoints(hand: readonly Pick<Card, "rank">[]): number {
  return hand.reduce((sum, c) => sum + cardPoints(c), 0);
}
