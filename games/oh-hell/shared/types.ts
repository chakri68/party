export type Suit = "clubs" | "diamonds" | "hearts" | "spades";

/** Default hand order. Alternating colours so neighbouring suits don't blur together. */
export const SUITS: readonly Suit[] = ["spades", "hearts", "clubs", "diamonds"];

/** 2 to 14. Aces are high, so the Ace is 14, not 1. */
export type Rank = number;

export const ACE: Rank = 14;

export interface Card {
  /** "clubs-8", "hearts-A", "spades-10". */
  id: string;
  suit: Suit;
  rank: Rank;
}

/** "up-down": 1 → max → 1. "down": max → 1. "up": 1 → max. */
export type ScheduleShape = "up-down" | "down" | "up";
/** The biggest hand the host asked for; the player count caps it anyway. */
export type BiggestSetting = 7 | 10 | "max";
/** "zero": a missed bid scores nothing. "difference": it costs a point per trick off. */
export type MissRule = "zero" | "difference";

export interface OhHellSettings {
  schedule: ScheduleShape;
  biggest: BiggestSetting;
  /** The dealer can't bid the number that makes the bids add up to the hand size. */
  dealerRule: boolean;
  missing: MissRule;
}

export const DEFAULT_SETTINGS: OhHellSettings = { schedule: "up-down", biggest: 7, dealerRule: true, missing: "zero" };

/** How long a finished trick stays on the table, and the round summary waits. */
export const TRICK_HOLD_MS = 1500;
export const SUMMARY_MS = 5000;

export interface OhHellPlayerState {
  id: string;
  hand: Card[];
  /** Null until they've bid this round. */
  bid: number | null;
  tricks: number;
  score: number;
  /** Host removed them. Their score stays on the record; they're out of the deal. */
  removed: boolean;
}

/** One card on the table, and whose it is. */
export interface TrickPlay {
  playerId: string;
  card: Card;
}

export interface FinishedTrick {
  plays: TrickPlay[];
  winnerId: string;
}

export interface RoundResult {
  playerId: string;
  bid: number;
  tricks: number;
  points: number;
  /** Running total after this round. */
  total: number;
}

export type Phase = "bidding" | "playing" | "round-summary" | "over";

export interface OhHellServerState {
  phase: Phase;
  settings: OhHellSettings;
  players: OhHellPlayerState[];
  /** Hand size per round. Rebuilt from where play stands if someone's removed. */
  schedule: number[];
  /** 0-based into `schedule`. */
  roundIndex: number;
  dealerIndex: number;
  /** The card turned up after the deal. Its suit is trump. */
  trump: Card;
  /** Whose bid or play it is. */
  turnIndex: number;
  /** Who led the current trick. */
  leaderIndex: number;
  trick: TrickPlay[];
  /** A full trick is being shown before it's collected; nobody plays meanwhile. */
  held: FinishedTrick | null;
  lastTrick: FinishedTrick | null;
  /** How many tricks have been played this round. */
  tricksPlayed: number;
  /** Set when a round's scored; kept through the summary. */
  results: RoundResult[] | null;
  /** Who's tapped "ready" on the summary. */
  ready: string[];
  summaryEndsAt: number;
  winnerIds: string[];
  /** "done": the last round finished. "abandoned": too few players left. */
  endReason: "done" | "abandoned" | null;
}

export interface OhHellPublicPlayer {
  id: string;
  bid: number | null;
  tricks: number;
  score: number;
  cardCount: number;
  removed: boolean;
  ready: boolean;
}

export interface OhHellPublicState {
  phase: Phase;
  players: OhHellPublicPlayer[];
  /** 1-based. */
  round: number;
  schedule: number[];
  handSize: number;
  dealerId: string;
  trump: Card;
  /** Whose bid or play it is. Null while a trick is held, between rounds, and at the end. */
  currentPlayerId: string | null;
  /** Bids made so far this round, and their sum. */
  bidsMade: number;
  bidsTotal: number;
  /** The one number the current bidder can't say (the dealer, with the rule on). */
  forbiddenBid: number | null;
  dealerRule: boolean;
  missing: MissRule;
  /** On the table now, in play order. While held, the full trick. */
  trick: TrickPlay[];
  /** Set while a full trick is held: who took it. */
  trickWinnerId: string | null;
  lastTrick: FinishedTrick | null;
  /** 1-based number of the trick in play (or just won). */
  trickNumber: number;
  results: RoundResult[] | null;
  summaryEndsAt: number | null;
  summaryMs: number;
  winnerIds: string[];
  endReason: "done" | "abandoned" | null;
}

export interface OhHellPrivateState {
  /** Sorted by suit, trump first, then rank. */
  hand: Card[];
  /** Ids you may play right now. Empty unless it's your turn to play. */
  legal: string[];
  canBid: boolean;
  canReady: boolean;
}

export type OhHellAction =
  | { type: "bid"; tricks: number }
  | { type: "play"; card: string }
  | { type: "ready" };

export type OhHellEvent =
  | { type: "dealt"; round: number; handSize: number; dealerId: string; trump: Card; redeal: boolean }
  | { type: "bid"; playerId: string; tricks: number }
  | { type: "played"; playerId: string; card: Card }
  /** The last card of a trick went down; the trick stays up until collected. */
  | { type: "trick-won"; winnerId: string; plays: TrickPlay[] }
  | { type: "trick-collected"; winnerId: string }
  | { type: "round-scored"; round: number; results: RoundResult[] }
  | { type: "ready"; playerId: string }
  | { type: "turn-skipped"; playerId: string }
  | { type: "player-removed"; playerId: string }
  | { type: "game-over"; winnerIds: string[]; reason: "done" | "abandoned" };
