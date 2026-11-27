// Play chips for the betting games (Hold'em, Teen Patti): pots, side pots,
// who wins them, and how a number of chips reads.

export interface Pot {
  amount: number;
  /** Who can win it: still in, and in at least this deep. */
  eligible: string[];
  /** Chips nobody matched. They go straight back to whoever bet them. */
  uncalled?: boolean;
}

export interface PotResult {
  amount: number;
  winners: string[];
  /** The winning hand, or null when nobody had to show (fold-out, uncalled). */
  label: string | null;
  uncalled?: boolean;
}

/** Lexicographic on tiebreak tuples. Positive: `a` wins. A missing entry loses to any present one. */
export function compareRanks(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? -1) - (b[i] ?? -1);
    if (d) return d;
  }
  return 0;
}

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
 * is the seats from the dealer's left, which settles odd chips: the remainder
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

/** 4200 → "4,200". Fixed separator so server labels don't depend on locale. */
export function formatChips(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** 1 → "1st", 3 → "3rd", 12 → "12th", 21 → "21st". */
export function ordinal(n: number): string {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${suffix}`;
}
