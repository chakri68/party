// The trick engine: follow suit, trump, who takes it. Pure and card-agnostic,
// so anything with a suit and a number (aces high) fits. Hearts or Spades
// would reuse this as-is; only bidding and scoring are Oh Hell's.

export interface TrickCard<S extends string = string> {
  suit: S;
  /** Higher beats lower within a suit. */
  rank: number;
}

/**
 * What you may play. Leading (no led suit), anything. Otherwise the led suit
 * if you hold any; if you don't, anything, trump included.
 */
export function legalPlays<C extends TrickCard>(hand: readonly C[], ledSuit: string | null): C[] {
  if (ledSuit === null) return [...hand];
  const follow = hand.filter((c) => c.suit === ledSuit);
  return follow.length ? follow : [...hand];
}

export function isLegalPlay<C extends TrickCard>(hand: readonly C[], card: C, ledSuit: string | null): boolean {
  return legalPlays(hand, ledSuit).includes(card);
}

/**
 * Index into `plays` (in play order) of the card that takes the trick: the
 * highest trump, or if none was played, the highest card of the suit led.
 * `trump` null plays it straight (no-trump rounds, Hearts).
 */
export function trickWinnerIndex(plays: readonly TrickCard[], trump: string | null): number {
  if (!plays.length) throw new Error("trickWinnerIndex: empty trick");
  const led = plays[0]!.suit;
  let best = 0;
  for (let i = 1; i < plays.length; i++) {
    if (beats(plays[i]!, plays[best]!, led, trump)) best = i;
  }
  return best;
}

/** Does `a` beat the card currently winning, `b`? */
export function beats(a: TrickCard, b: TrickCard, led: string, trump: string | null): boolean {
  const power = (c: TrickCard) => (c.suit === trump ? 2 : c.suit === led ? 1 : 0);
  return power(a) > power(b) || (power(a) === power(b) && power(a) > 0 && a.rank > b.rank);
}
