import { JOKER_RANK, PULLED_QUEEN, SUITS, type Card, type OldMaidCard, type Rank, type Suit } from "./types.ts";

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

export const JOKER: Card = { id: "joker", suit: "joker", rank: JOKER_RANK };

export function formatCardId(suit: Suit, rank: Rank): string {
  return `${suit}-${formatRank(rank)}`;
}

export function parseCardId(id: string): Card | null {
  if (id === JOKER.id) return { ...JOKER };
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

/** 51 cards (a queen out) or 53 (a joker in). Either way, exactly one card can't pair. */
export function makeDeck(oldMaid: OldMaidCard): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) for (let r = 1; r <= 13; r++) deck.push(makeCard(suit, r));
  return oldMaid === "joker" ? [...deck, { ...JOKER }] : deck.filter((c) => c.id !== PULLED_QUEEN);
}

export function deckSize(oldMaid: OldMaidCard): number {
  return oldMaid === "joker" ? 53 : 51;
}

/** Rank, then suit. A hand never holds a pair, so this is one card per rank. */
export function compareCards(a: Card, b: Card): number {
  const suit = (c: Card) => (c.suit === "joker" ? -1 : SUITS.indexOf(c.suit));
  return a.rank - b.rank || suit(a) - suit(b);
}

// ---------------------------------------------------------------------------
// Pairs
// ---------------------------------------------------------------------------

/**
 * Splits a hand into pairs (same rank, any suit) and what's left. Three of a
 * kind is a pair plus a spare; four is two pairs. The joker never pairs.
 */
export function pairOff(hand: readonly Card[]): { pairs: Card[][]; rest: Card[] } {
  const byRank = new Map<Rank, Card[]>();
  for (const c of hand) {
    if (c.rank === JOKER_RANK) continue;
    byRank.set(c.rank, [...(byRank.get(c.rank) ?? []), c]);
  }
  const pairs: Card[][] = [];
  const paired = new Set<string>();
  for (const cards of byRank.values()) {
    for (let i = 0; i + 1 < cards.length; i += 2) {
      pairs.push([cards[i]!, cards[i + 1]!]);
      paired.add(cards[i]!.id).add(cards[i + 1]!.id);
    }
  }
  return { pairs, rest: hand.filter((c) => !paired.has(c.id)) };
}

/** "1st", "2nd", "3rd", "11th"… */
export function ordinal(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teen ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${suffix}`;
}
