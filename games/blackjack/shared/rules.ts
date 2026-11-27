import { DECKS, SUITS, type Card, type HandResult, type HandTotal, type Rank, type Suit } from "./types.ts";

const LABELS: Record<number, string> = { 1: "A", 11: "J", 12: "Q", 13: "K" };
const NAMES: Record<number, string> = {
  1: "Ace", 2: "Two", 3: "Three", 4: "Four", 5: "Five", 6: "Six", 7: "Seven",
  8: "Eight", 9: "Nine", 10: "Ten", 11: "Jack", 12: "Queen", 13: "King",
};

export const formatRank = (rank: Rank): string => LABELS[rank] ?? String(rank);
export const rankName = (rank: Rank): string => NAMES[rank] ?? String(rank);

export function parseCardId(id: string): Card | null {
  const m = /^([a-z]+)-(A|J|Q|K|10|[2-9])$/.exec(id);
  if (!m || !SUITS.includes(m[1] as Suit)) return null;
  const label = m[2]!;
  const rank = label === "A" ? 1 : label === "J" ? 11 : label === "Q" ? 12 : label === "K" ? 13 : Number(label);
  return { id, suit: m[1] as Suit, rank };
}

export const cardId = (suit: Suit, rank: Rank): string => `${suit}-${formatRank(rank)}`;

/** Six decks, in order. Shuffle before use. */
export function makeShoe(): string[] {
  const out: string[] = [];
  for (let d = 0; d < DECKS; d++) for (const suit of SUITS) for (let r = 1; r <= 13; r++) out.push(cardId(suit, r));
  return out;
}

/** What a card counts: Aces 1 here (see `handTotal`), faces 10. */
export const cardValue = (c: Pick<Card, "rank">): number => Math.min(10, c.rank);

/** Best total under 22 if there is one. One Ace counts 11 when that doesn't go over. */
export function handTotal(cards: Pick<Card, "rank">[]): HandTotal {
  let total = 0;
  let aces = false;
  for (const c of cards) {
    total += cardValue(c);
    if (c.rank === 1) aces = true;
  }
  if (aces && total + 10 <= 21) return { total: total + 10, soft: true };
  return { total, soft: false };
}

/** Ace and a 10-value card as the first two cards. A split hand never counts. */
export function isBlackjack(cards: Pick<Card, "rank">[], split = false): boolean {
  return !split && cards.length === 2 && handTotal(cards).total === 21;
}

/** The dealer could have Blackjack, so looks at the face-down card. */
export const dealerPeeks = (up: Pick<Card, "rank">): boolean => up.rank === 1 || cardValue(up) === 10;

/** The dealer takes cards below 17 and stands on every 17, soft ones too. */
export const dealerDraws = (cards: Pick<Card, "rank">[]): boolean => handTotal(cards).total < 17;

/** Two cards of the same rank (a King and a Queen are not a pair). */
export const isPair = (cards: Pick<Card, "rank">[]): boolean => cards.length === 2 && cards[0]!.rank === cards[1]!.rank;

/**
 * How a finished hand did against the dealer. `dealer` is the dealer's full
 * hand. A bust always loses, even when the dealer busts too.
 */
export function handResult(hand: { cards: Pick<Card, "rank">[]; split: boolean }, dealer: Pick<Card, "rank">[]): HandResult {
  const me = handTotal(hand.cards).total;
  if (me > 21) return "bust";
  const bj = isBlackjack(hand.cards, hand.split);
  const dealerBj = isBlackjack(dealer);
  if (bj) return dealerBj ? "push" : "blackjack";
  if (dealerBj) return "lose";
  const d = handTotal(dealer).total;
  if (d > 21 || me > d) return "win";
  return me === d ? "push" : "lose";
}

/** What comes back to the stack, bet included. Blackjack pays 3 to 2, rounded down. */
export function payout(result: HandResult, bet: number): number {
  switch (result) {
    case "win":
      return bet * 2;
    case "blackjack":
      return bet + Math.floor((bet * 3) / 2);
    case "push":
      return bet;
    default:
      return 0;
  }
}

/** The first half: a player who runs out in one of these rounds can rebuy. */
export const rebuyRounds = (rounds: number): number => Math.floor(rounds / 2);

export function formatChips(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
