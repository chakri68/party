import { ACE, HAND_CATEGORIES, SUITS, type Card, type HandValue, type Pot, type PotResult, type Rank, type Suit } from "./types.ts";

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

/** High rank first, for showing a hand. */
export function compareCards(a: Card, b: Card): number {
  return b.rank - a.rank || SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit);
}

// ---------------------------------------------------------------------------
// Hand evaluator
// ---------------------------------------------------------------------------

/** Lexicographic on the tiebreak tuples. Positive: `a` wins. */
export function compareRanks(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? -1) - (b[i] ?? -1);
    if (d) return d;
  }
  return 0;
}

export function compareHands(a: HandValue, b: HandValue): number {
  return compareRanks(a.ranks, b.ranks);
}

/** Straight high card in five distinct ranks, or 0. The wheel is 5-high. */
function straightHigh(desc: number[]): number {
  if (new Set(desc).size !== 5) return 0;
  if (desc[0]! - desc[4]! === 4) return desc[0]!;
  if (desc[0] === ACE && desc[1] === 5 && desc[4] === 2) return 5;
  return 0;
}

function label(category: number, r: number[]): string {
  switch (category) {
    case 0: return `High card, ${rankName(r[0]!)}`;
    case 1: return `Pair of ${rankPlural(r[0]!)}`;
    case 2: return `Two pair, ${rankPlural(r[0]!)} and ${rankPlural(r[1]!)}`;
    case 3: return `Three of a kind, ${rankPlural(r[0]!)}`;
    case 4: return `Straight, ${rankName(r[0]!)} high`;
    case 5: return `Flush, ${rankName(r[0]!)} high`;
    case 6: return `Full house, ${rankPlural(r[0]!)} over ${rankPlural(r[1]!)}`;
    case 7: return `Four of a kind, ${rankPlural(r[0]!)}`;
    default: return r[0] === ACE ? "Royal flush" : `Straight flush, ${rankName(r[0]!)} high`;
  }
}

/** Exactly five cards. */
function evaluate5(five: Card[]): HandValue {
  // Biggest groups first, then higher rank: pairs before kickers, trips before pairs.
  const counts = new Map<number, number>();
  for (const c of five) counts.set(c.rank, (counts.get(c.rank) ?? 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const ordered = [...five].sort((a, b) => {
    const ga = groups.findIndex(([r]) => r === a.rank);
    const gb = groups.findIndex(([r]) => r === b.rank);
    return ga - gb;
  });
  const desc = [...five].map((c) => c.rank).sort((a, b) => b - a);
  const flush = five.every((c) => c.suit === five[0]!.suit);
  const high = straightHigh(desc);
  const shape = groups.map(([, n]) => n).join("");
  const byGroup = groups.map(([r]) => r);

  let category: number;
  let tiebreak: number[];
  if (high && flush) [category, tiebreak] = [8, [high]];
  else if (shape === "41") [category, tiebreak] = [7, byGroup];
  else if (shape === "32") [category, tiebreak] = [6, byGroup];
  else if (flush) [category, tiebreak] = [5, desc];
  else if (high) [category, tiebreak] = [4, [high]];
  else if (shape === "311") [category, tiebreak] = [3, byGroup];
  else if (shape === "221") [category, tiebreak] = [2, byGroup];
  else if (shape === "2111") [category, tiebreak] = [1, byGroup];
  else [category, tiebreak] = [0, desc];

  // A straight reads top down; the wheel's Ace goes to the end.
  let cards = ordered;
  if (category === 4 || category === 8 || category === 5 || category === 0) {
    cards = [...five].sort(compareCards);
    if (high === 5 && (category === 4 || category === 8)) cards = [...cards.slice(1), cards[0]!];
  }
  return { category, ranks: [category, ...tiebreak], cards: cards.map((c) => c.id), label: label(category, tiebreak) };
}

/**
 * The best five of five to seven cards. Brute force: 21 picks at most, and
 * the table only asks a handful of times per hand.
 */
export function bestHand(cards: readonly Card[]): HandValue {
  if (cards.length < 5) throw new Error("bestHand needs at least five cards");
  let best: HandValue | null = null;
  const n = cards.length;
  for (let a = 0; a < n; a++)
    for (let b = a + 1; b < n; b++)
      for (let c = b + 1; c < n; c++)
        for (let d = c + 1; d < n; d++)
          for (let e = d + 1; e < n; e++) {
            const v = evaluate5([cards[a]!, cards[b]!, cards[c]!, cards[d]!, cards[e]!]);
            if (!best || compareHands(v, best) > 0) best = v;
          }
  return best!;
}

/** Category name for a list: "Two pair". */
export function categoryName(category: number): string {
  return HAND_CATEGORIES[category] ?? "";
}

// ---------------------------------------------------------------------------
// Pots
// ---------------------------------------------------------------------------

/**
 * Main pot and side pots from each player's total for the hand. Pure on
 * purpose: this is where poker bugs live.
 *
 * Levels are the distinct totals of players still in (all-in or not). Each
 * band takes everyone's chips between the previous level and this one, folded
 * players' included, and can be won by anyone still in who reached it. Chips
 * nobody else matched come back as an `uncalled` pot for the one who bet them.
 */
export function buildPots(contributions: Record<string, number>, folded: Iterable<string>): Pot[] {
  const out = new Set(folded);
  const ids = Object.keys(contributions).filter((id) => (contributions[id] ?? 0) > 0);
  const live = ids.filter((id) => !out.has(id));
  const levels = [...new Set(live.map((id) => contributions[id]!))].sort((a, b) => a - b);
  const pots: Pot[] = [];
  let prev = 0;
  for (const level of levels) {
    let amount = 0;
    for (const id of ids) amount += Math.max(0, Math.min(contributions[id]!, level) - prev);
    pots.push({ amount, eligible: live.filter((id) => contributions[id]! >= level) });
    prev = level;
  }
  // Folded chips beyond every live player's total (someone left mid-bet): into the top pot.
  const beyond = ids.reduce((sum, id) => sum + Math.max(0, contributions[id]! - prev), 0);
  if (beyond && pots.length) pots.at(-1)!.amount += beyond;

  // The top bettor's chips above everyone else's total were never called.
  const top = pots.at(-1);
  if (top && top.eligible.length === 1) {
    const bettor = top.eligible[0]!;
    const others = ids.filter((id) => id !== bettor).map((id) => contributions[id]!);
    const below = levels.length > 1 ? levels.at(-2)! : 0;
    const matched = Math.max(below, ...others, 0);
    const uncalled = contributions[bettor]! - matched;
    if (uncalled > 0) {
      top.amount -= uncalled;
      if (!top.amount) pots.pop();
      pots.push({ amount: uncalled, eligible: [bettor], uncalled: true });
    }
  }
  return pots;
}

/**
 * Who takes each pot. `strength` is each contender's tiebreak tuple; `order`
 * is the seats from the button's left, which settles odd chips: the remainder
 * of a split goes to the first tied winner in that order.
 */
export function awardPots(
  pots: readonly Pot[],
  strength: Record<string, readonly number[]>,
  order: readonly string[],
): { won: Record<string, number>; returned: Record<string, number>; results: PotResult[] } {
  const won: Record<string, number> = {};
  const returned: Record<string, number> = {};
  const results: PotResult[] = [];
  const seat = (id: string) => {
    const i = order.indexOf(id);
    return i < 0 ? order.length : i;
  };
  for (const pot of pots) {
    if (pot.uncalled) {
      const id = pot.eligible[0]!;
      returned[id] = (returned[id] ?? 0) + pot.amount;
      results.push({ amount: pot.amount, winners: [id], label: null, uncalled: true });
      continue;
    }
    let winners: string[] = [];
    for (const id of pot.eligible) {
      if (!winners.length) winners = [id];
      else {
        const d = compareRanks(strength[id] ?? [], strength[winners[0]!] ?? []);
        if (d > 0) winners = [id];
        else if (d === 0) winners.push(id);
      }
    }
    winners.sort((a, b) => seat(a) - seat(b));
    const share = Math.floor(pot.amount / winners.length);
    const odd = pot.amount - share * winners.length;
    winners.forEach((id, i) => {
      won[id] = (won[id] ?? 0) + share + (i === 0 ? odd : 0);
    });
    results.push({ amount: pot.amount, winners, label: null });
  }
  return { won, returned, results };
}

// ---------------------------------------------------------------------------
// Blinds
// ---------------------------------------------------------------------------

const LEVELS: readonly [number, number][] = [
  [10, 20], [15, 30], [25, 50], [50, 100], [75, 150],
  [100, 200], [150, 300], [200, 400], [300, 600], [500, 1000],
];

/** Small and big blind at a level (0-based). Past the table, the big blind doubles. */
export function blindsFor(level: number): { sb: number; bb: number } {
  const row = LEVELS[level];
  if (row) return { sb: row[0], bb: row[1] };
  const bb = 1000 * 2 ** (level - (LEVELS.length - 1));
  return { sb: bb / 2, bb };
}

/** Hand numbers start at 1; a level lasts `handsPerLevel` hands. */
export function levelIndexFor(handNumber: number, handsPerLevel: number): number {
  return Math.floor(Math.max(0, handNumber - 1) / handsPerLevel);
}

/** 4200 → "4,200". Fixed separator so server labels don't depend on locale. */
export function formatChips(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** 1 → "1st", 3 → "3rd", 12 → "12th". */
export function ordinal(n: number): string {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${suffix}`;
}
