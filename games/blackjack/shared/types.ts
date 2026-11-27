import type { PartyStats } from "@games/game-core";

export type Suit = "clubs" | "diamonds" | "hearts" | "spades";
export const SUITS: readonly Suit[] = ["spades", "hearts", "clubs", "diamonds"];

/** 1 is the Ace; 11, 12, 13 are Jack, Queen, King. */
export type Rank = number;

export interface Card {
  /** "hearts-A", "spades-10". The shoe has 6 of each, so ids repeat. */
  id: string;
  suit: Suit;
  rank: Rank;
}

// ---------------------------------------------------------------------------
// Settings and fixed rules
// ---------------------------------------------------------------------------

export const ROUNDS_OPTIONS = [10, 15, 20] as const;
export const REBUY_OPTIONS = ["off", "one"] as const;
export const TURN_SECONDS_OPTIONS = [15, 20, 30] as const;

export type RebuySetting = (typeof REBUY_OPTIONS)[number];

export interface BlackjackSettings {
  rounds: number;
  /** "one": one rebuy each, for a player who runs out in the first half. */
  rebuys: RebuySetting;
  /** Time to bet, and time to play your hands. */
  turnSeconds: number;
}

export const DEFAULT_SETTINGS: BlackjackSettings = { rounds: 10, rebuys: "off", turnSeconds: 20 };

export const STARTING_CHIPS = 1000;
export const MIN_BET = 10;
export const DECKS = 6;
export const SHOE_CARDS = DECKS * 52;
/** Shuffle again before a round when fewer than this are left: about three quarters used. */
export const RESHUFFLE_AT = SHOE_CARDS / 4;

// ---------------------------------------------------------------------------
// Hands
// ---------------------------------------------------------------------------

export interface HandTotal {
  total: number;
  /** An Ace still counts 11. */
  soft: boolean;
}

export type HandResult = "win" | "blackjack" | "push" | "lose" | "bust";

export interface Hand {
  cards: Card[];
  /** Chips on this hand (doubled included). */
  bet: number;
  doubled: boolean;
  /** One of two hands from a split. Never a Blackjack. */
  split: boolean;
  /** No more moves on it: stood, doubled, bust, 21, a Blackjack or a split Ace. */
  done: boolean;
  /** Set when the round is paid. */
  result: HandResult | null;
  /** What came back to the stack, bet included. Set with `result`. */
  paid: number;
}

// ---------------------------------------------------------------------------
// Server state
// ---------------------------------------------------------------------------

/**
 * betting: everyone bets at once. play: everyone plays their own hands at
 * once. dealer: the dealer takes cards, one per beat. settle: the pause after
 * the pay, before the next round.
 */
export type Step = "betting" | "play" | "dealer" | "settle";

export interface BlackjackPlayerState {
  id: string;
  stack: number;
  /** This round's bet; null before you bet, or if you sat the round out. */
  bet: number | null;
  hands: Hand[];
  /** Sits this round out: missed the bet, or the host skipped them. */
  sitOut: boolean;
  /** Bet timers missed in a row. From 2 the table stops waiting on your bet. */
  missed: number;
  away: boolean;
  removed: boolean;
  /** Ran out with a rebuy still to use: can buy back in at the next betting. */
  pendingRebuy: boolean;
  rebuysUsed: number;
  /** Out of chips for good. */
  out: boolean;
  /** The round you went out in, for the results. */
  outRound: number | null;
}

export interface DealerState {
  cards: Card[];
  /** The second card is still face down. */
  hidden: boolean;
}

export type EndReason = "rounds" | "everyone-out" | "abandoned";

export interface BlackjackServerState {
  phase: "playing" | "over";
  step: Step;
  settings: BlackjackSettings;
  players: BlackjackPlayerState[];
  /** 1-based. */
  round: number;
  dealer: DealerState;
  /** Cards still to draw, top first, as ids. */
  shoe: string[];
  /** The round the shoe was last shuffled for; 0 for the first shoe. */
  shuffledRound: number;
  /** When the bet or play clock runs out; 0 when there's none. */
  deadline: number;
  /** When the current pause ends (a dealer card, the pay). */
  stepEndsAt: number;
  /** Set while the host has the game paused. */
  pausedAt: number | null;
  winnerIds: string[];
  endReason: EndReason | null;
  /** Recap counts. Never in a projection. */
  stats: PartyStats;
}

// ---------------------------------------------------------------------------
// Projections
// ---------------------------------------------------------------------------

export interface PublicHand {
  cards: Card[];
  bet: number;
  doubled: boolean;
  split: boolean;
  done: boolean;
  total: number;
  soft: boolean;
  blackjack: boolean;
  result: HandResult | null;
  paid: number;
}

export interface BlackjackPublicPlayer {
  id: string;
  stack: number;
  bet: number | null;
  hands: PublicHand[];
  /** Index of the hand being played, or -1. */
  active: number;
  /** Missed 2 bets in a row: the table doesn't wait on this seat's bet. */
  sittingOut: boolean;
  away: boolean;
  removed: boolean;
  pendingRebuy: boolean;
  out: boolean;
}

export interface BlackjackPublicState {
  step: Step | "over";
  round: number;
  rounds: number;
  minBet: number;
  startingChips: number;
  players: BlackjackPublicPlayer[];
  /** The face-down card is null. */
  dealer: { cards: (Card | null)[]; total: number | null; soft: boolean; blackjack: boolean };
  shoeLeft: number;
  shoeSize: number;
  /** The shoe was shuffled for this round. */
  shuffled: boolean;
  /** Bet or play clock, while one runs. */
  clock: { endsAt: number; ms: number } | null;
  stepEndsAt: number;
  pausedAt: number | null;
  winnerIds: string[];
  endReason: EndReason | null;
}

export interface LegalMoves {
  /** The hand these moves are for. */
  hand: number;
  /** Cards in that hand now. A move names it, so a second tap on a stale screen is refused. */
  cards: number;
  hit: boolean;
  stand: boolean;
  double: boolean;
  split: boolean;
}

export interface BlackjackPrivateState {
  /** Bet bounds, while you can bet. */
  bet: { min: number; max: number } | null;
  canRebuy: boolean;
  /** You missed 2 bets in a row: "back" makes the next betting wait for you again. */
  canBack: boolean;
  /** Moves for your current hand, while you play. */
  moves: LegalMoves | null;
}

// ---------------------------------------------------------------------------
// Actions and events
// ---------------------------------------------------------------------------

export type BlackjackAction =
  | { type: "bet"; amount: number }
  /** `cards`: how many cards the hand has as you see it (see `LegalMoves.cards`). */
  | { type: MoveKind; hand: number; cards: number }
  | { type: "rebuy" }
  /** Don't rebuy: you are out. */
  | { type: "stay-out" }
  /** Sitting out: play again from the next betting. */
  | { type: "back" };

export type MoveKind = "hit" | "stand" | "double" | "split";
/** Why the game acted for someone. */
export type AutoReason = "timer" | "away" | "skip";

export interface RoundResult {
  playerId: string;
  hand: number;
  result: HandResult;
  bet: number;
  paid: number;
}

export type BlackjackEvent =
  | { type: "round-start"; round: number; shuffled: boolean }
  | { type: "bet"; playerId: string; amount: number }
  | { type: "sit-out"; playerId: string; auto: AutoReason }
  | { type: "deal"; playerIds: string[]; dealerUp: Card }
  /** The dealer looked at the face-down card. */
  | { type: "peek"; blackjack: boolean }
  | { type: "move"; playerId: string; hand: number; kind: MoveKind; auto?: AutoReason }
  | { type: "bust"; playerId: string; hand: number; total: number }
  | { type: "dealer-reveal"; card: Card }
  | { type: "dealer-draw"; card: Card }
  | { type: "settled"; results: RoundResult[]; dealerTotal: number; dealerBust: boolean }
  | { type: "busted"; playerIds: string[]; rebuy: string[] }
  | { type: "rebuy"; playerId: string; chips: number }
  | { type: "stay-out"; playerId: string }
  | { type: "back"; playerId: string }
  | { type: "player-removed"; playerId: string }
  | { type: "game-over"; winnerIds: string[]; reason: EndReason };
