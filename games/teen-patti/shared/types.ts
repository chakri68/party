import type { PartyStats, Pot, PotResult } from "@games/game-core";

export type Suit = "clubs" | "diamonds" | "hearts" | "spades";

/** Display order. Alternating colours so neighbouring suits don't blur together. */
export const SUITS: readonly Suit[] = ["spades", "hearts", "clubs", "diamonds"];

/** 2 to 14: the Ace is 14. It also plays low in A-2-3. */
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

export const STARTING_CHIPS_OPTIONS = [500, 1000, 2000] as const;
/** Hands per boot level: slow, normal, fast. */
export const HANDS_PER_LEVEL_OPTIONS = [10, 6, 4] as const;
/** "last": last one standing; a number: a time cap in minutes. */
export const ENDING_OPTIONS = ["last", 20, 30, 45] as const;
export const TURN_SECONDS_OPTIONS = [20, 30, 45] as const;

export type Ending = (typeof ENDING_OPTIONS)[number];

export interface TeenPattiSettings {
  startingChips: number;
  handsPerLevel: number;
  ending: Ending;
  turnSeconds: number;
}

export const DEFAULT_SETTINGS: TeenPattiSettings = {
  startingChips: 1000,
  handsPerLevel: 6,
  ending: "last",
  turnSeconds: 30,
};

/** When the pot reaches this many boots, every hand still in is shown. */
export const POT_LIMIT_BOOTS = 256;
/** Still Blind once the pot is past this many boots: a big bet for the recap. */
export const BIG_BLIND_POT_BOOTS = 20;
/** Time to answer a Sideshow. When it runs out, the answer is no. */
export const SIDESHOW_ANSWER_MS = 15_000;

// ---------------------------------------------------------------------------
// Hands
// ---------------------------------------------------------------------------

/** Worst first: the index is the hand's strength. */
export const HAND_CLASSES = ["High card", "Pair", "Color", "Sequence", "Pure sequence", "Trail"] as const;

export interface HandValue {
  /** Index into HAND_CLASSES. */
  category: number;
  /** Tiebreak tuple, compared left to right: the category, then the deciding ranks. */
  ranks: number[];
  /** "Pair of Kings". */
  label: string;
}

// ---------------------------------------------------------------------------
// Server state
// ---------------------------------------------------------------------------

/**
 * "betting": someone's turn. "sideshow": waiting on the asked player's answer.
 * "showdown": hands are face up and the pot is paid. "awarded": everyone else
 * packed. "between-hands": the pause before the next deal.
 */
export type Step = "betting" | "sideshow" | "showdown" | "awarded" | "between-hands";

export type MoveKind = "chaal" | "double" | "all-in" | "show" | "sideshow";
/** Why the game packed for someone. */
export type PackReason = "move" | "timer" | "skip" | "sitting-out" | "sideshow" | "left";
/** Why every hand still in was turned up. */
export type ShowReason = "show" | "all-in" | "pot-limit";

export interface TeenPattiPlayerState {
  id: string;
  stack: number;
  /** Your 3 cards this hand; empty if you weren't dealt in. */
  cards: Card[];
  inHand: boolean;
  packed: boolean;
  /** Looked at their cards. Everyone starts the hand Blind. */
  seen: boolean;
  allIn: boolean;
  /** Put in over the whole hand, boot included. */
  contributed: number;
  /** Last move this hand, for the seats. */
  lastMove: { kind: MoveKind; amount: number } | null;
  /** Cards face up for everyone (a show). */
  shown: boolean;
  /** Ids whose cards this player saw in a Sideshow this hand. */
  peeks: string[];
  /** Stack when this hand was dealt: breaks same-hand bust ties. */
  startStack: number;
  /** Turn-clock expiries in a row. Two and you're sitting out. */
  timeouts: number;
  sittingOut: boolean;
  /** Connection dropped: auto pack until they're back. */
  away: boolean;
  removed: boolean;
  /** Out of the game for good. */
  out: boolean;
  /** The hand they busted in, and their stack going into it. */
  bustedHand: number | null;
  bustStack: number;
  /** This hand: bet as Seen with only a high card (counted once). */
  lied: boolean;
  /** This hand: counted as still Blind with a big pot. */
  bigBid: boolean;
  /** This hand: their cards were compared in a Sideshow. */
  compared: boolean;
}

export interface HandSummary {
  handNumber: number;
  /** null: everyone else packed. */
  reason: ShowReason | null;
  /** Who asked for the Show (they lose a tie), or null. */
  showBy: string | null;
  pots: PotResult[];
  /** Cards turned face up, by player. */
  shown: Record<string, Card[]>;
  labels: Record<string, string>;
  /** Show order, from the dealer's left. Empty when everyone else packed. */
  order: string[];
  /** Total won per player (chips nobody matched not counted). */
  won: Record<string, number>;
}

export type EndReason = "last-standing" | "time" | "abandoned";

export interface SideshowRequest {
  fromId: string;
  toId: string;
  deadline: number;
}

export interface TeenPattiServerState {
  phase: "playing" | "over";
  step: Step;
  settings: TeenPattiSettings;
  players: TeenPattiPlayerState[];
  startedAt: number;
  handNumber: number;
  dealerIndex: number;
  /** Seat whose turn it is; -1 when nobody's. Stays on the asker during a Sideshow. */
  turnIndex: number;
  deadline: number;
  /** The Blind bet this hand. A Seen bet is twice this. */
  stake: number;
  sideshow: SideshowRequest | null;
  lastHand: HandSummary | null;
  /** When the step timer fires (pauses between hands), for the client. */
  stepEndsAt: number;
  /** Test decks, one per hand, consumed in order. */
  testDecks: string[][] | null;
  winnerIds: string[];
  endReason: EndReason | null;
  /** When the host paused, or null. */
  pausedAt: number | null;
  /** Party recap counts. Never in a projection. */
  stats: PartyStats;
}

// ---------------------------------------------------------------------------
// Projections
// ---------------------------------------------------------------------------

export interface TeenPattiPublicPlayer {
  id: string;
  stack: number;
  inHand: boolean;
  packed: boolean;
  seen: boolean;
  allIn: boolean;
  /** Chips in the pot this hand. */
  inPot: number;
  lastMove: { kind: MoveKind; amount: number } | null;
  sittingOut: boolean;
  away: boolean;
  removed: boolean;
  out: boolean;
  /** Face-up cards, or null. */
  cards: Card[] | null;
}

export interface TeenPattiPublicState {
  step: Step | "over";
  handNumber: number;
  /** 1-based for people. */
  level: number;
  boot: number;
  nextBoot: number;
  handsToNextLevel: number;
  startingChips: number;
  /** The Blind bet now. A Seen bet is twice this. */
  stake: number;
  potLimit: number;
  players: TeenPattiPublicPlayer[];
  dealerId: string | null;
  pot: number;
  /** Main pot then side pots. Empty with just one pot. */
  pots: Pot[];
  currentPlayerId: string | null;
  turn: { endsAt: number; ms: number } | null;
  sideshow: { fromId: string; toId: string; endsAt: number; ms: number } | null;
  stepEndsAt: number;
  lastHand: HandSummary | null;
  capEndsAt: number | null;
  pausedAt: number | null;
  winnerIds: string[];
  endReason: EndReason | null;
}

/** What you can do on your turn, with the price of each. Null means not now. */
export interface LegalMoves {
  /** A normal bet: the stake when Blind, twice the stake when Seen. Null when you are short. */
  chaal: number | null;
  /** Twice a normal bet. It doubles the stake. */
  double: number | null;
  /** All your chips, when you can't pay a normal bet. */
  allIn: number | null;
  /** Only with 2 players left. Costs a normal bet. */
  show: number | null;
  /** Ask the player before you to compare cards. Costs a Seen bet. */
  sideshow: { toId: string; cost: number } | null;
}

export interface TeenPattiPrivateState {
  /** Your cards, once you have seen them. Empty while Blind. */
  cards: Card[];
  label: string | null;
  /** You are in this hand and still Blind: you can look. */
  canSee: boolean;
  legal: LegalMoves | null;
  /** Someone asked you for a Sideshow. */
  answer: { fromId: string } | null;
  /** Hands you saw in a Sideshow this hand. */
  peeks: { playerId: string; cards: Card[]; label: string }[];
  canBack: boolean;
}

// ---------------------------------------------------------------------------
// Actions and events
// ---------------------------------------------------------------------------

export type TeenPattiAction =
  | { type: "see" }
  | { type: "chaal" }
  | { type: "double" }
  | { type: "all-in" }
  | { type: "pack" }
  | { type: "show" }
  | { type: "sideshow" }
  | { type: "accept" }
  | { type: "refuse" }
  | { type: "back" };

export type AutoReason = "timer" | "skip" | "sitting-out";

export type TeenPattiEvent =
  | {
      type: "hand-start";
      handNumber: number;
      level: number;
      boot: number;
      dealerId: string;
      /** In deal order. */
      dealt: string[];
      boots: { playerId: string; amount: number }[];
    }
  | { type: "level-up"; level: number; boot: number }
  /** To you only, when you see your cards. */
  | { type: "your-cards"; cards: Card[] }
  | { type: "saw"; playerId: string }
  | { type: "bet"; playerId: string; kind: MoveKind; amount: number; seen: boolean; stake: number }
  | { type: "pack"; playerId: string; reason: PackReason }
  | { type: "sideshow-ask"; fromId: string; toId: string }
  | { type: "sideshow-answer"; fromId: string; toId: string; accepted: boolean; auto?: AutoReason }
  /** To the two players only: both hands, and who packs. */
  | { type: "sideshow-cards"; hands: Record<string, Card[]>; loserId: string }
  | { type: "pot-limit"; limit: number }
  | { type: "reveal"; hands: Record<string, Card[]> }
  | { type: "awarded"; summary: HandSummary }
  | { type: "sitting-out"; playerId: string }
  | { type: "back"; playerId: string }
  | { type: "busted"; playerIds: string[] }
  | { type: "player-removed"; playerId: string }
  | { type: "game-over"; winnerIds: string[]; reason: EndReason };
