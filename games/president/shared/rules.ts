import { SUITS, type Card, type Play, type Rank, type Suit, type Title } from "./types.ts";

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

export function makeDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) for (let r = 1; r <= 13; r++) deck.push(makeCard(suit, r));
  return deck;
}

/** What beats what: 3 is 0, up through K (10), A (11), and 2 on top (12). */
export function power(rank: Rank): number {
  return rank === 1 ? 11 : rank === 2 ? 12 : rank - 3;
}

/** 3♣ first, 2♠ last. Suits only break ties. */
export function compareCards(a: Card, b: Card): number {
  return power(a.rank) - power(b.rank) || SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit);
}

/** The top `count` cards of a hand: the tribute. */
export function bestCards(hand: readonly Card[], count: number): Card[] {
  return [...hand].sort(compareCards).slice(-count);
}

/** The bottom `count`: what a host skip gives back. */
export function worstCards(hand: readonly Card[], count: number): Card[] {
  return [...hand].sort(compareCards).slice(0, count);
}

// ---------------------------------------------------------------------------
// Play
// ---------------------------------------------------------------------------

const SET_WORDS = ["", "single", "pair", "triple", "quad"];

/** "a single 7", "a pair of Kings", "three 2s". For the log and rejections. */
export function setName(count: number, rank: Rank): string {
  const plural = rank === 6 ? "Sixes" : `${rankName(rank)}s`;
  if (count === 1) return `a single ${rankName(rank)}`;
  if (count === 2) return `a pair of ${plural}`;
  return `${count === 3 ? "three" : "four"} ${plural}`;
}

/**
 * Null when `cards` can go on `top` (null: a lead), else why not. A set is
 * one to four cards of one rank; following means the same count, higher,
 * or (with the house rule) equal.
 */
export function checkPlay(cards: readonly Card[], top: Play | null, matchSkips: boolean): string | null {
  if (cards.length < 1 || cards.length > 4) return "Play one to four cards.";
  const rank = cards[0]!.rank;
  if (cards.some((c) => c.rank !== rank)) return "A set has to be all one rank.";
  if (!top) return null;
  const need = top.cards.length;
  const their = top.cards[0]!.rank;
  if (cards.length !== need) return `It's ${SET_WORDS[need]}s this trick: play ${need} of a kind, or pass.`;
  const diff = power(rank) - power(their);
  if (diff > 0 || (diff === 0 && matchSkips)) return null;
  return `That doesn't beat ${setName(need, their)}.`;
}

/** Ranks in `hand` that could go down on `top` right now. */
export function playableRanks(hand: readonly Card[], top: Play | null, matchSkips: boolean): Rank[] {
  const byRank = new Map<Rank, Card[]>();
  for (const c of hand) byRank.set(c.rank, [...(byRank.get(c.rank) ?? []), c]);
  const need = top?.cards.length ?? 1;
  return [...byRank.entries()]
    .filter(([, cards]) => cards.length >= need && !checkPlay(cards.slice(0, need), top, matchSkips))
    .map(([rank]) => rank)
    .sort((a, b) => power(a) - power(b));
}

// ---------------------------------------------------------------------------
// Standing
// ---------------------------------------------------------------------------

/**
 * What finishing `place` (1-based) out of `n` makes you. The vice titles
 * only exist from four players: with three, it's top, middle, bottom.
 */
export function titleFor(place: number, n: number): Title {
  if (place === 1) return "President";
  if (place === n) return "Asshole";
  if (n >= 4 && place === 2) return "Vice-President";
  if (n >= 4 && place === n - 1) return "Vice-Asshole";
  return "Citizen";
}

/** One point per player you finished ahead of. */
export function pointsFor(place: number, n: number): number {
  return n - place;
}

/**
 * Tributes for a finish order: the bottom's best two go to the top, and
 * from four players, the second-bottom's best one to the second. Each is
 * answered by a return of the same size.
 */
export function tributes(order: readonly string[]): { fromId: string; toId: string; count: number }[] {
  const n = order.length;
  if (n < 2) return [];
  const out = [{ fromId: order[n - 1]!, toId: order[0]!, count: 2 }];
  if (n >= 4) out.push({ fromId: order[n - 2]!, toId: order[1]!, count: 1 });
  return out;
}

/** "1st", "2nd", "3rd", "11th"… */
export function ordinal(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teen ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${suffix}`;
}
