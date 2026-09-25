export type Suit = "clubs" | "diamonds" | "hearts" | "spades";

/** Low to high, bridge order. Only breaks ties: which of two equal cards is "best". */
export const SUITS: readonly Suit[] = ["clubs", "diamonds", "hearts", "spades"];

/** 1 (Ace) to 13 (King), as printed. What beats what is `power` (3 low, 2 high). */
export type Rank = number;

export interface Card {
  /** "clubs-3", "hearts-A". */
  id: string;
  suit: Suit;
  rank: Rank;
}

/** Round 1's opening lead goes to whoever holds this. */
export const OPENING_CARD = "clubs-3";

export const ROUND_CHOICES = [1, 2, 3, 4, 5] as const;

export interface PresidentSettings {
  rounds: number;
  /**
   * A common house rule: you may also play the same rank as the top set, and
   * doing so skips the next player.
   */
  matchSkips: boolean;
}

export const DEFAULT_SETTINGS: PresidentSettings = { rounds: 3, matchSkips: false };

export type Title = "President" | "Vice-President" | "Citizen" | "Vice-Asshole" | "Asshole";

/** One set on the pile: a single, pair, triple or quad of one rank. */
export interface Play {
  playerId: string;
  cards: Card[];
}

/**
 * One card swap between rounds. Tributes (the bottom's best cards, up to
 * the top) happen at the deal; returns wait on the top player's pick, and
 * `cards` stays null until then.
 */
export interface Swap {
  kind: "tribute" | "return";
  fromId: string;
  toId: string;
  count: number;
  cards: Card[] | null;
}

export interface PresidentPlayerState {
  id: string;
  hand: Card[];
  /** Host removed them; their cards went out of play. */
  removed: boolean;
  /** Passed on the current trick: out of it until it clears. */
  passed: boolean;
  points: number;
}

/** "done": every round played. "abandoned": too few players left to go on. */
export type EndReason = "done" | "abandoned";

export interface PresidentServerState {
  phase: "exchange" | "playing" | "finished";
  settings: PresidentSettings;
  players: PresidentPlayerState[];
  /** 1-based. */
  round: number;
  dealerIndex: number;
  /** During the exchange, whoever will lead once it's done. */
  turnIndex: number;
  turnNumber: number;
  /** Sets played on the current trick, oldest first. Empty: someone's leading. */
  trick: Play[];
  /** Seat of the last set on the trick; -1 while leading. */
  lastIndex: number;
  /** Cleared tricks and leavers' hands. Out of play until the next deal. */
  discard: Card[];
  /** This round: player ids in the order they went out. */
  finishOrder: string[];
  /** Earlier rounds' finish orders, oldest first. */
  history: string[][];
  /** This round's swaps (none in round 1). */
  exchange: Swap[];
  winnerIds: string[];
  endReason: EndReason | null;
}

export interface PresidentPublicState {
  phase: PresidentServerState["phase"];
  round: number;
  rounds: number;
  matchSkips: boolean;
  players: {
    id: string;
    cardCount: number;
    removed: boolean;
    passed: boolean;
    points: number;
    /** Where they went out this round, 1-based. */
    place: number | null;
    /** What last round made them. Null in round 1. */
    title: Title | null;
  }[];
  currentPlayerId: string | null;
  /** The set to beat. Null: whoever's up is leading. */
  top: Play | null;
  /** Sets on the pile this trick, the top one included. */
  trickSize: number;
  dealerId: string;
  /** Who owes whom. Cards stay private to the two involved. */
  exchange: { kind: Swap["kind"]; fromId: string; toId: string; count: number; done: boolean }[];
  /** Last round's finish order, for the between-rounds recap. */
  lastRound: string[] | null;
  winnerIds: string[];
  endReason: EndReason | null;
}

export interface PresidentPrivateState {
  /** Sorted 3 low to 2 high. */
  hand: Card[];
  /** Ranks you could put down right now. Empty when it isn't your turn. */
  playableRanks: Rank[];
  canPass: boolean;
  /** Cards you still have to give back this exchange. */
  mustGive: number;
  /** What went and came in this round's exchange, for your eyes only. */
  gave: Card[];
  got: Card[];
}

export type PresidentAction =
  | { type: "play"; cardIds: string[] }
  | { type: "pass" }
  | { type: "give"; cardIds: string[] };

export type PresidentEvent =
  | { type: "dealt"; round: number; dealerId: string; handSizes: Record<string, number> }
  /** Public: who handed how many to whom. The cards go to those two as `swap-cards`. */
  | { type: "swapped"; kind: Swap["kind"]; fromId: string; toId: string; count: number }
  | { type: "swap-cards"; kind: Swap["kind"]; fromId: string; toId: string; cards: Card[] }
  | { type: "played"; playerId: string; cards: Card[] }
  /** `auto`: nothing in their hand beats it, so they didn't get asked. */
  | { type: "passed"; playerId: string; auto: boolean }
  /** Matched the rank (house rule): the next player misses their go. */
  | { type: "skipped"; playerId: string }
  | { type: "cleared"; leaderId: string }
  | { type: "went-out"; playerId: string; place: number; title: Title }
  | { type: "round-over"; round: number; order: string[]; points: Record<string, number> }
  | { type: "turn-skipped"; playerId: string }
  | { type: "player-removed"; playerId: string }
  | { type: "game-over"; winnerIds: string[]; reason: EndReason };
