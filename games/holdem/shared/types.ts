export type Suit = "clubs" | "diamonds" | "hearts" | "spades";

/** Display order. Alternating colours so neighbouring suits don't blur together. */
export const SUITS: readonly Suit[] = ["spades", "hearts", "clubs", "diamonds"];

/** 2 to 14: Aces are high (the wheel treats them as 1, see `bestHand`). */
export type Rank = number;
export const ACE: Rank = 14;

export interface Card {
  /** "clubs-8", "hearts-A", "spades-10". */
  id: string;
  suit: Suit;
  rank: Rank;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export const STARTING_CHIPS_OPTIONS = [1000, 1500, 3000] as const;
/** Hands per blind level: slow, normal, turbo. */
export const HANDS_PER_LEVEL_OPTIONS = [10, 6, 4] as const;
/** "last": last one standing; a number: a time cap in minutes. */
export const ENDING_OPTIONS = ["last", 20, 30, 45] as const;
export const REBUY_OPTIONS = ["off", "early"] as const;
export const TURN_SECONDS_OPTIONS = [20, 30, 45] as const;

export type Ending = (typeof ENDING_OPTIONS)[number];
export type RebuySetting = (typeof REBUY_OPTIONS)[number];

export interface HoldemSettings {
  startingChips: number;
  handsPerLevel: number;
  ending: Ending;
  /** "early": one rebuy each, while the blinds are in their first three levels. */
  rebuys: RebuySetting;
  turnSeconds: number;
}

export const DEFAULT_SETTINGS: HoldemSettings = {
  startingChips: 1500,
  handsPerLevel: 6,
  ending: "last",
  rebuys: "off",
  turnSeconds: 30,
};

/** Rebuys are open while the blinds are in levels 0–2. */
export const REBUY_LEVELS = 3;

// ---------------------------------------------------------------------------
// Pots and hands
// ---------------------------------------------------------------------------

export interface Pot {
  amount: number;
  /** Who can win it: still in, and in at least this deep. */
  eligible: string[];
  /** Chips nobody matched. They go straight back to whoever bet them. */
  uncalled?: boolean;
}

export const HAND_CATEGORIES = [
  "High card",
  "Pair",
  "Two pair",
  "Three of a kind",
  "Straight",
  "Flush",
  "Full house",
  "Four of a kind",
  "Straight flush",
] as const;

export interface HandValue {
  /** Index into HAND_CATEGORIES. */
  category: number;
  /** Tiebreak tuple, compared left to right: category, deciding ranks, kickers. */
  ranks: number[];
  /** The five cards that make it, deciding cards first. */
  cards: string[];
  /** "Two pair, Kings and Fives". */
  label: string;
}

// ---------------------------------------------------------------------------
// Server state
// ---------------------------------------------------------------------------

export type Street = "preflop" | "flop" | "turn" | "river";
export type Step = Street | "showdown" | "awarded" | "between-hands";
export const STREETS: readonly Street[] = ["preflop", "flop", "turn", "river"];

export interface HoldemPlayerState {
  id: string;
  stack: number;
  /** Your two cards this hand; empty if you weren't dealt in. */
  hole: Card[];
  /** Dealt into the hand in progress (or the one just finished). */
  inHand: boolean;
  folded: boolean;
  allIn: boolean;
  /** Put in on this betting round. */
  bet: number;
  /** Put in over the whole hand, blinds included. */
  contributed: number;
  /** Acted since the last full raise. A short all-in doesn't clear it. */
  acted: boolean;
  /** Cards face up for everyone (showdown, run-out, or a Show). */
  shown: boolean;
  /** Stack when this hand was dealt: breaks same-hand bust ties. */
  startStack: number;
  /** Turn-clock expiries in a row. Two and you're sitting out. */
  timeouts: number;
  sittingOut: boolean;
  /** Connection dropped: auto check/fold until they're back. */
  away: boolean;
  removed: boolean;
  /** Busted and waiting on the rebuy window. */
  pendingRebuy: boolean;
  /** Out of the tournament for good. */
  out: boolean;
  /** The hand they busted in, and their stack going into it. */
  bustedHand: number | null;
  bustStack: number;
  rebuysUsed: number;
}

export interface PotResult {
  amount: number;
  winners: string[];
  /** The winning hand, or null when nobody had to show (fold-out, uncalled). */
  label: string | null;
  uncalled?: boolean;
}

/** What happened last hand, for the table's summary line and the showdown highlight. */
export interface HandSummary {
  handNumber: number;
  byFold: boolean;
  board: Card[];
  pots: PotResult[];
  /** Hole cards turned face up, by player. */
  shown: Record<string, Card[]>;
  /** The five that won, per winner who showed (board cards included). */
  bestCards: Record<string, string[]>;
  /** Each shown hand's best five, winners or not: what the showdown lights up per player. */
  fives: Record<string, string[]>;
  /** Showdown order, clockwise from the button's left. Empty after a fold-out. */
  order: string[];
  /** Each shown hand's label. */
  labels: Record<string, string>;
  /** Total won per player (uncalled chips not counted). */
  won: Record<string, number>;
}

export type EndReason = "last-standing" | "time" | "abandoned";

export interface HoldemServerState {
  phase: "playing" | "over";
  step: Step;
  settings: HoldemSettings;
  players: HoldemPlayerState[];
  startedAt: number;
  handNumber: number;
  buttonIndex: number;
  sbIndex: number;
  bbIndex: number;
  /** Seat whose decision it is; -1 when nobody's. */
  turnIndex: number;
  deadline: number;
  board: Card[];
  /** The rest of this hand's deck, top first. */
  deck: Card[];
  /** Highest bet this round (the full big blind pre-flop, even if it was posted short). */
  currentBet: number;
  /** Size of the last full raise this round. */
  minRaise: number;
  /** Betting's done: shared cards are coming out one by one. */
  runout: boolean;
  lastHand: HandSummary | null;
  /** When the step timer fires (pauses between cards and hands), for the client. */
  stepEndsAt: number;
  /** Test decks, one per hand, consumed in order. */
  testDecks: string[][] | null;
  winnerIds: string[];
  endReason: EndReason | null;
}

// ---------------------------------------------------------------------------
// Projections
// ---------------------------------------------------------------------------

export interface HoldemPublicPlayer {
  id: string;
  stack: number;
  bet: number;
  inHand: boolean;
  folded: boolean;
  allIn: boolean;
  sittingOut: boolean;
  away: boolean;
  removed: boolean;
  out: boolean;
  /** Busted, rebuy still possible. */
  pendingRebuy: boolean;
  /** Face-up hole cards, or null. */
  cards: Card[] | null;
}

export interface HoldemPublicState {
  step: Step | "over";
  handNumber: number;
  /** 1-based for people. */
  level: number;
  sb: number;
  bb: number;
  next: { sb: number; bb: number };
  handsToNextLevel: number;
  /** Also what a rebuy brings. */
  startingChips: number;
  players: HoldemPublicPlayer[];
  buttonId: string | null;
  sbId: string | null;
  bbId: string | null;
  board: Card[];
  /** Everything in the middle, bets in front of players included. */
  pot: number;
  /** Main pot then side pots, from chips already collected. Empty with just one pot. */
  pots: Pot[];
  currentBet: number;
  currentPlayerId: string | null;
  turn: { endsAt: number; ms: number } | null;
  runout: boolean;
  /** When the current pause ends (between cards, showdown, between hands). */
  stepEndsAt: number;
  lastHand: HandSummary | null;
  /** Time-capped games: when the last hand starts finishing. */
  capEndsAt: number | null;
  winnerIds: string[];
  endReason: EndReason | null;
}

export interface LegalActions {
  check: boolean;
  /** Chips to call (capped at your stack); 0 when there's nothing to call. */
  call: number;
  /** Raise-to bounds for this round. Null when you can't raise. */
  minRaiseTo: number | null;
  maxRaiseTo: number | null;
  /** True when the first bet of the round would be a bet, not a raise. */
  opening: boolean;
}

export interface HoldemPrivateState {
  hole: Card[];
  /** Your best five so far, once there are shared cards. */
  best: { label: string; cards: string[] } | null;
  /** Your options, when it's your decision. */
  legal: LegalActions | null;
  canShow: boolean;
  canBack: boolean;
  canRebuy: boolean;
}

// ---------------------------------------------------------------------------
// Actions and events
// ---------------------------------------------------------------------------

export type HoldemAction =
  | { type: "fold" }
  | { type: "check" }
  | { type: "call" }
  /** Also the opening bet. `to` is your total for this round. */
  | { type: "raise"; to: number }
  | { type: "all-in" }
  | { type: "show" }
  | { type: "back" }
  | { type: "rebuy" };

export type BetKind = "fold" | "check" | "call" | "bet" | "raise" | "all-in";
/** Why the game acted for someone. */
export type AutoReason = "timer" | "sitting-out" | "skip";

export type HoldemEvent =
  | {
      type: "hand-start";
      handNumber: number;
      level: number;
      sb: number;
      bb: number;
      buttonId: string;
      sbId: string;
      bbId: string;
      /** In deal order. */
      dealt: string[];
      blinds: { playerId: string; amount: number }[];
    }
  | { type: "level-up"; level: number; sb: number; bb: number }
  | { type: "your-cards"; cards: Card[] }
  | { type: "bet"; playerId: string; kind: BetKind; amount: number; to: number; auto?: AutoReason }
  | { type: "board"; street: Street; cards: Card[] }
  /** Chips nobody matched, back to whoever bet them as the round closes. */
  | { type: "returned"; playerId: string; amount: number }
  /** Cards turned up: a run-out, a showdown, or a Show. */
  | { type: "reveal"; hands: Record<string, Card[]> }
  | { type: "awarded"; summary: HandSummary }
  | { type: "sitting-out"; playerId: string }
  | { type: "back"; playerId: string }
  | { type: "busted"; playerIds: string[]; rebuy: string[] }
  | { type: "rebuy"; playerId: string; chips: number }
  | { type: "player-removed"; playerId: string }
  | { type: "game-over"; winnerIds: string[]; reason: EndReason };
