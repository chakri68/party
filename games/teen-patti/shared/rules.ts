import { compareRanks } from "@games/game-core";
import { ACE, HAND_CLASSES, POT_LIMIT_BOOTS, SUITS, type Card, type HandValue, type Rank, type Suit } from "./types.ts";

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

const FACE_LABELS: Record<number, string> = { 11: "J", 12: "Q", 13: "K", 14: "A" };
const FACE_NAMES: Record<number, string> = { 11: "Jack", 12: "Queen", 13: "King", 14: "Ace" };
const NUMBER_NAMES = ["", "Ace", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];

export function formatRank(rank: Rank): string {
  return FACE_LABELS[rank] ?? String(rank);
}

export function rankName(rank: Rank): string {
  return FACE_NAMES[rank] ?? NUMBER_NAMES[rank] ?? String(rank);
}

/** "Nines", "Sixes", "Aces". */
export function rankPlural(rank: Rank): string {
  const name = rankName(rank);
  return name === "Six" ? "Sixes" : `${name}s`;
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
  const rank = label === "A" ? 14 : label === "K" ? 13 : label === "Q" ? 12 : label === "J" ? 11 : Number(label);
  return { id, suit, rank };
}

export function makeCard(suit: Suit, rank: Rank): Card {
  return { id: formatCardId(suit, rank), suit, rank };
}

/** All 52, in suit/rank order. */
export function makeDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) for (let r = 2; r <= ACE; r++) deck.push(makeCard(suit, r));
  return deck;
}

// ---------------------------------------------------------------------------
// Hands
// ---------------------------------------------------------------------------

const HIGH = 0;
const PAIR = 1;
const COLOR = 2;
const SEQUENCE = 3;
const PURE = 4;
const TRAIL = 5;

/** A-K-Q is the best run, then A-2-3, then K-Q-J down to 4-3-2 (by top card). */
const RUN_AKQ = 16;
const RUN_A23 = 15;

/**
 * The run's strength, or 0 when the three ranks (high first, all different)
 * aren't a run. Q-K-A is A-K-Q. The Ace also plays low in A-2-3, but not in K-A-2.
 */
export function runValue(desc: readonly number[]): number {
  const [a, b, c] = desc as [number, number, number];
  if (a === ACE && b === 13 && c === 12) return RUN_AKQ;
  if (a === ACE && b === 3 && c === 2) return RUN_A23;
  if (a - b === 1 && b - c === 1) return a;
  return 0;
}

function runText(desc: readonly number[], value: number): string {
  const ranks = value === RUN_A23 ? [ACE, 2, 3] : desc;
  return ranks.map(formatRank).join("-");
}

/** Exactly three cards. */
export function evaluate(cards: readonly Card[]): HandValue {
  if (cards.length !== 3) throw new Error("A Teen Patti hand is 3 cards");
  const desc = cards.map((c) => c.rank).sort((x, y) => y - x);
  const [a, b, c] = desc as [number, number, number];
  const color = cards[0]!.suit === cards[1]!.suit && cards[1]!.suit === cards[2]!.suit;
  const distinct = a !== b && b !== c;
  const run = distinct ? runValue(desc) : 0;
  if (a === c) return { category: TRAIL, ranks: [TRAIL, a], label: `Trail of ${rankPlural(a)}` };
  if (run && color) return { category: PURE, ranks: [PURE, run], label: `Pure sequence, ${runText(desc, run)}` };
  if (run) return { category: SEQUENCE, ranks: [SEQUENCE, run], label: `Sequence, ${runText(desc, run)}` };
  if (color) return { category: COLOR, ranks: [COLOR, a, b, c], label: `Color, ${rankName(a)} high` };
  if (!distinct) {
    const pair = a === b ? a : b;
    const kicker = a === b ? c : a;
    return { category: PAIR, ranks: [PAIR, pair, kicker], label: `Pair of ${rankPlural(pair)}` };
  }
  return { category: HIGH, ranks: [HIGH, a, b, c], label: `High card, ${rankName(a)}` };
}

/** Positive: `a` wins. Zero: a split. Suits never break a tie. */
export function compareHands(a: readonly Card[], b: readonly Card[]): number {
  return compareRanks(evaluate(a).ranks, evaluate(b).ranks);
}

/** Hand classes, best first. */
export function handOrder(): string[] {
  return [...HAND_CLASSES].reverse();
}

/** The hand as one number, the same order as `compareHands`: higher wins, equal splits. */
export function handScore(cards: readonly Card[]): number {
  const r = evaluate(cards).ranks;
  let n = 0;
  for (let i = 0; i < 4; i++) n = n * 17 + (r[i] ?? 0);
  return n;
}

/** High card first; a pair before its kicker; A-2-3 reads A, 2, 3. */
export function displayOrder(cards: readonly Card[]): Card[] {
  const count = (r: number) => cards.filter((c) => c.rank === r).length;
  const sorted = [...cards].sort((x, y) => count(y.rank) - count(x.rank) || y.rank - x.rank || SUITS.indexOf(x.suit) - SUITS.indexOf(y.suit));
  const desc = sorted.map((c) => c.rank);
  if (new Set(desc).size === 3 && runValue(desc) === RUN_A23) return [sorted[0]!, sorted[2]!, sorted[1]!];
  return sorted;
}

// ---------------------------------------------------------------------------
// Boot, stake, limits
// ---------------------------------------------------------------------------

const BOOTS: readonly number[] = [10, 20, 30, 50, 80, 100, 150, 200, 300, 500];

/** The boot at a level (0-based). Past the table, it doubles each level. */
export function bootFor(level: number): number {
  return BOOTS[level] ?? BOOTS.at(-1)! * 2 ** (level - (BOOTS.length - 1));
}

/** Hand numbers start at 1; a level lasts `handsPerLevel` hands. */
export function levelIndexFor(handNumber: number, handsPerLevel: number): number {
  return Math.floor(Math.max(0, handNumber - 1) / handsPerLevel);
}

/** A normal bet (Chaal): the stake when Blind, twice the stake when Seen. A Show costs the same. */
export const chaalFor = (stake: number, seen: boolean): number => (seen ? 2 * stake : stake);

/** A double bet: twice a normal one. */
export const doubleFor = (stake: number, seen: boolean): number => 2 * chaalFor(stake, seen);

/** The stake after a bet of `amount`: a Blind bet is the stake itself, a Seen bet twice it. */
export const stakeAfter = (amount: number, seen: boolean): number => (seen ? amount / 2 : amount);

/** At this pot, every hand still in is shown. */
export const potLimitFor = (boot: number): number => POT_LIMIT_BOOTS * boot;

/** 1 → "1st", 3 → "3rd", 12 → "12th". */
export function ordinal(n: number): string {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${suffix}`;
}
