import { ACE, HAND_CATEGORIES, LOW_RANK, SUITS, type Card, type HandValue, type Pot, type PotResult, type Rank, type Suit, type Variant } from "./types.ts";

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

/** The game's deck in suit/rank order: all 52, or 36 (6 to Ace) in Short Deck. */
export function makeDeck(variant: Variant = "holdem"): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) for (let r = LOW_RANK[variant]; r <= ACE; r++) deck.push(makeCard(suit, r));
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

// ---------------------------------------------------------------------------
// Hand order per game. One evaluator; each game maps a category to its strength.
// ---------------------------------------------------------------------------

// Categories, as indexes into HAND_CATEGORIES.
const HIGH_CARD = 0;
const PAIR = 1;
const TWO_PAIR = 2;
const THREE_OF_A_KIND = 3;
const STRAIGHT = 4;
const FLUSH = 5;
const FULL_HOUSE = 6;
const FOUR_OF_A_KIND = 7;
const STRAIGHT_FLUSH = 8;
/** Strength by category (index into HAND_CATEGORIES). Short Deck: a flush beats a full house. */
const STRENGTH: Record<Variant, readonly number[]> = {
  holdem: [0, 1, 2, 3, 4, 5, 6, 7, 8],
  omaha: [0, 1, 2, 3, 4, 5, 6, 7, 8],
  shortdeck: [0, 1, 2, 3, 4, 6, 5, 7, 8],
};

/** How strong a category is in this game: higher beats lower. */
export const categoryStrength = (variant: Variant, category: number): number => STRENGTH[variant][category]!;

/** Category names, best first, for this game. */
export function handOrder(variant: Variant): string[] {
  return HAND_CATEGORIES.map((name, category) => ({ name, s: categoryStrength(variant, category) }))
    .sort((a, b) => b.s - a.s)
    .map((x) => x.name);
}

/**
 * Straight high card in five distinct ranks, or 0. The Ace also plays low,
 * under the deck's lowest four ranks: A-2-3-4-5 (5 high), or A-6-7-8-9 in Short Deck (9 high).
 */
function straightHigh(desc: number[], low: number): number {
  if (new Set(desc).size !== 5) return 0;
  if (desc[0]! - desc[4]! === 4) return desc[0]!;
  if (desc[0] === ACE && desc[1] === low + 3 && desc[4] === low) return low + 3;
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
function evaluate5(five: Card[], variant: Variant): HandValue {
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
  const high = straightHigh(desc, LOW_RANK[variant]);
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

  // A straight reads top down; an Ace playing low goes to the end.
  let cards = ordered;
  if (category === 4 || category === 8 || category === 5 || category === 0) {
    cards = [...five].sort(compareCards);
    if (high && high < ACE && desc[0] === ACE && (category === 4 || category === 8)) cards = [...cards.slice(1), cards[0]!];
  }
  const strength = categoryStrength(variant, category);
  return { category, ranks: [strength, ...tiebreak], cards: cards.map((c) => c.id), label: label(category, tiebreak) };
}

/**
 * The best five of five to seven cards, by this game's order. Brute force:
 * 21 picks at most, and the table only asks a handful of times per hand.
 */
export function bestHand(cards: readonly Card[], variant: Variant = "holdem"): HandValue {
  if (cards.length < 5) throw new Error("bestHand needs at least five cards");
  let best: HandValue | null = null;
  const n = cards.length;
  for (let a = 0; a < n; a++)
    for (let b = a + 1; b < n; b++)
      for (let c = b + 1; c < n; c++)
        for (let d = c + 1; d < n; d++)
          for (let e = d + 1; e < n; e++) {
            const v = evaluate5([cards[a]!, cards[b]!, cards[c]!, cards[d]!, cards[e]!], variant);
            if (!best || compareHands(v, best) > 0) best = v;
          }
  return best!;
}

// ---------------------------------------------------------------------------
// Hand scores: the same order as `bestHand` + `compareHands`, as one number,
// fast enough for a few hundred deals per decision. It must agree with
// `bestHand`: the bot's agreement test in test/bot.test.ts checks it.
// ---------------------------------------------------------------------------

/**
 * Strength, then `lead` deciding ranks (`l0`, `l1`), then the top `kick`
 * ranks of `rest`, packed four bits each into five slots.
 */
function packHand(strength: number, lead: number, l0: number, l1: number, rest: number, kick: number): number {
  let n = strength;
  let slots = 0;
  if (lead > 0) (n = n * 16 + l0), slots++;
  if (lead > 1) (n = n * 16 + l1), slots++;
  for (let r = 14; r >= 2 && kick > 0; r--) {
    if (rest & (1 << r)) (n = n * 16 + r), slots++, kick--;
  }
  for (; slots < 5; slots++) n *= 16;
  return n;
}

/** Highest straight in a rank bitmask (bit r for rank r, the Ace also just under `low`), or 0. */
function straightIn(mask: number, low: number): number {
  const m = mask & (1 << 14) ? mask | (1 << (low - 1)) : mask;
  for (let high = 14; high >= low + 3; high--) {
    const run = 0b11111 << (high - 4);
    if ((m & run) === run) return high;
  }
  return 0;
}

const SUIT_INDEX: Record<Suit, number> = { spades: 0, hearts: 1, clubs: 2, diamonds: 3 };
/** Scratch counts, all zero between calls. The bot calls this thousands of times a decision. */
const rankCount = new Uint8Array(15);
const suitCount = new Uint8Array(4);
const suitMask = new Uint16Array(4);

/** Best five of five to seven cards by this game's order, as a number: higher wins, equal ties. */
export function handScore(cards: readonly Card[], variant: Variant = "holdem"): number {
  const strength = STRENGTH[variant];
  const low = LOW_RANK[variant];
  let mask = 0;
  for (let i = 0; i < cards.length; i++) {
    const c = cards[i]!;
    const bit = 1 << c.rank;
    const si = SUIT_INDEX[c.suit];
    rankCount[c.rank]!++;
    mask |= bit;
    suitMask[si]! |= bit;
    suitCount[si]!++;
  }
  let flushMask = 0;
  for (let si = 0; si < 4; si++) {
    if (suitCount[si]! >= 5) flushMask = suitMask[si]!;
    suitCount[si] = 0;
    suitMask[si] = 0;
  }
  // Groups, high rank first (and the counts back to zero).
  let quad = 0;
  let trip = 0;
  let trip2 = 0;
  let pair = 0;
  let pair2 = 0;
  for (let r = 14; r >= 2; r--) {
    const n = rankCount[r]!;
    if (!n) continue;
    rankCount[r] = 0;
    if (n === 4) quad ||= r;
    else if (n === 3) trip ? (trip2 ||= r) : (trip = r);
    else if (n === 2) pair ? (pair2 ||= r) : (pair = r);
  }
  if (flushMask) {
    const sf = straightIn(flushMask, low);
    if (sf) return packHand(strength[STRAIGHT_FLUSH]!, 1, sf, 0, 0, 0);
  }
  if (quad) return packHand(strength[FOUR_OF_A_KIND]!, 1, quad, 0, mask & ~(1 << quad), 1);
  // Seven cards can't hold both a full house and a flush, so their order here doesn't matter.
  if (trip && (trip2 || pair)) return packHand(strength[FULL_HOUSE]!, 2, trip, Math.max(trip2, pair), 0, 0);
  if (flushMask) return packHand(strength[FLUSH]!, 0, 0, 0, flushMask, 5);
  const straight = straightIn(mask, low);
  if (straight) return packHand(strength[STRAIGHT]!, 1, straight, 0, 0, 0);
  if (trip) return packHand(strength[THREE_OF_A_KIND]!, 1, trip, 0, mask & ~(1 << trip), 2);
  if (pair2) return packHand(strength[TWO_PAIR]!, 2, pair, pair2, mask & ~(1 << pair) & ~(1 << pair2), 1);
  if (pair) return packHand(strength[PAIR]!, 1, pair, 0, mask & ~(1 << pair), 3);
  return packHand(strength[HIGH_CARD]!, 0, 0, 0, mask, 5);
}

// ---------------------------------------------------------------------------
// Variants: which five cards a player may use
// ---------------------------------------------------------------------------

/**
 * Omaha: every hand of exactly 2 private cards and exactly 3 shared ones
 * (60 with 4 private cards and 5 shared). `visit` gets the same array each
 * time: copy it to keep it.
 */
function omahaFives(hole: readonly Card[], board: readonly Card[], visit: (five: Card[]) => void): void {
  const five: Card[] = [];
  for (let a = 0; a < hole.length; a++)
    for (let b = a + 1; b < hole.length; b++)
      for (let c = 0; c < board.length; c++)
        for (let d = c + 1; d < board.length; d++)
          for (let e = d + 1; e < board.length; e++) {
            five[0] = hole[a]!;
            five[1] = hole[b]!;
            five[2] = board[c]!;
            five[3] = board[d]!;
            five[4] = board[e]!;
            visit(five);
          }
}

/**
 * A player's best hand in this game. Hold'em and Short Deck: any five of the
 * seven. Omaha: 2 private + 3 shared.
 */
export function bestHandFor(variant: Variant, hole: readonly Card[], board: readonly Card[]): HandValue {
  if (variant !== "omaha") return bestHand([...hole, ...board], variant);
  let best: HandValue | null = null;
  omahaFives(hole, board, (five) => {
    const v = bestHand(five, variant);
    if (!best || compareHands(v, best) > 0) best = v;
  });
  if (!best) throw new Error("Omaha needs at least 2 private cards and 3 shared cards");
  return best;
}

/** `bestHandFor` as one number: higher wins, equal ties. */
export function handScoreFor(variant: Variant, hole: readonly Card[], board: readonly Card[]): number {
  if (variant !== "omaha") return handScore([...hole, ...board], variant);
  let best = -1;
  omahaFives(hole, board, (five) => {
    const s = handScore(five, variant);
    if (s > best) best = s;
  });
  return best;
}

/** Omaha bets are pot-limit. The other games are no-limit. */
export const isPotLimit = (variant: Variant): boolean => variant === "omaha";

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
