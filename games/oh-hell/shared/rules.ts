import { ACE, SUITS, type BiggestSetting, type Card, type MissRule, type Rank, type ScheduleShape, type Suit } from "./types.ts";

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

const FACE_LABELS: Record<number, string> = { 11: "J", 12: "Q", 13: "K", 14: "A" };
const FACE_NAMES: Record<number, string> = { 11: "Jack", 12: "Queen", 13: "King", 14: "Ace" };
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
  const rank = label === "A" ? ACE : label === "K" ? 13 : label === "Q" ? 12 : label === "J" ? 11 : Number(label);
  return { id, suit, rank };
}

export function makeCard(suit: Suit, rank: Rank): Card {
  return { id: formatCardId(suit, rank), suit, rank };
}

/** The 52, in suit/rank order. */
export function makeDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) for (let r = 2; r <= ACE; r++) deck.push(makeCard(suit, r));
  return deck;
}

/**
 * Hand order: trump first, then the other suits keeping colours alternating
 * where they can, low to high within a suit.
 */
export function suitOrder(trump: Suit | null): Suit[] {
  if (!trump) return [...SUITS];
  const i = SUITS.indexOf(trump);
  return [...SUITS.slice(i), ...SUITS.slice(0, i)];
}

export function sortHand(hand: readonly Card[], trump: Suit | null): Card[] {
  const order = suitOrder(trump);
  return [...hand].sort((a, b) => order.indexOf(a.suit) - order.indexOf(b.suit) || a.rank - b.rank);
}

// ---------------------------------------------------------------------------
// Schedule
// ---------------------------------------------------------------------------

/** The biggest hand: the setting, capped so one card's always left to turn up for trump. */
export function biggestHand(setting: BiggestSetting, players: number): number {
  const cap = Math.floor(51 / Math.max(players, 1));
  return setting === "max" ? cap : Math.min(setting, cap);
}

/** from, from+1 … to; empty if from > to. */
const up = (from: number, to: number): number[] => Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);
/** from, from-1 … 1; empty if from < 1. */
const downTo1 = (from: number): number[] => up(1, from).reverse();

/** Hand size per round. Up and down with 7: 1 … 7 … 1, thirteen rounds. */
export function buildSchedule(shape: ScheduleShape, biggest: number): number[] {
  if (shape === "up") return up(1, biggest);
  if (shape === "down") return downTo1(biggest);
  return [...up(1, biggest), ...downTo1(biggest - 1)];
}

/**
 * Someone left mid-game, so the biggest hand changes. Rounds already played
 * stay as they were; the round at `index` keeps its size (capped); the rest
 * carries on in the same direction to the new biggest hand.
 *
 * Up and down: a round before the old peak, or at it with room to grow, is
 * still on the way up.
 */
export function rescheduleFrom(schedule: readonly number[], index: number, shape: ScheduleShape, biggest: number): number[] {
  const size = Math.min(schedule[index] ?? 1, biggest);
  const peak = schedule.indexOf(Math.max(...schedule));
  const rising = shape === "up" || (shape === "up-down" && (index < peak || (index === peak && size < biggest)));
  let rest: number[];
  if (!rising) rest = downTo1(size - 1);
  else if (shape === "up") rest = up(size + 1, biggest);
  else rest = [...up(size + 1, biggest), ...downTo1(biggest - 1)];
  return [...schedule.slice(0, index), size, ...rest];
}

// ---------------------------------------------------------------------------
// Bidding and scoring
// ---------------------------------------------------------------------------

/**
 * The bid the dealer can't make: the one that would make the bids add up to
 * the hand size, so somebody has to miss. Null when the rule's off, when it's
 * not the dealer bidding, or when the number's out of reach anyway.
 */
export function forbiddenBid(handSize: number, othersTotal: number, isDealer: boolean, ruleOn: boolean): number | null {
  if (!ruleOn || !isDealer) return null;
  const n = handSize - othersTotal;
  return n >= 0 && n <= handSize ? n : null;
}

/** "Can't bid 2: the bids would add up to 3 tricks". */
export function forbiddenBidMessage(bid: number, handSize: number): string {
  return `You can't bid ${bid}. The total bid would be ${handSize} ${handSize === 1 ? "trick" : "tricks"}`;
}

/** Made it exactly: 10 + bid. Missed: 0, or minus the difference. */
export function scoreRound(bid: number, tricks: number, miss: MissRule): number {
  if (bid === tricks) return 10 + bid;
  return miss === "difference" ? -Math.abs(bid - tricks) : 0;
}
