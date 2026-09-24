export type Suit = "clubs" | "diamonds" | "hearts" | "spades";

/** Board row order, top to bottom. Hands sort the same way so they line up. */
export const SUITS: readonly Suit[] = ["spades", "hearts", "diamonds", "clubs"];

/**
 * Internal numeric rank; adjacency is rank ± 1.
 * acePosition "high": 2..13 are 2..K and Ace = 14, so the row spans 2–14.
 * acePosition "low": Ace = 1, so the row spans 1–13.
 */
export type Rank = number;

export interface Card {
  id: string; // "clubs-7", "hearts-A"
  suit: Suit;
  rank: Rank;
}

export type AcePosition = "high" | "low";

export interface SevensSettings {
  startingRule: "dealer-left" | "seven-of-diamonds";
  acePosition: AcePosition;
  forcedPlay: boolean;
  scoring: "winner-only" | "remaining-cards";
}

export const DEFAULT_SETTINGS: SevensSettings = {
  startingRule: "dealer-left",
  acePosition: "high",
  forcedPlay: true,
  scoring: "winner-only",
};

/** A suit is started when its range is non-null. low/high are the exposed ends. */
export type SevensBoardState = Record<Suit, { low: Rank; high: Rank } | null>;

export interface SevensPlayerState {
  id: string;
  hand: Card[];
  /** Host removed them; `hand` now holds ghost cards (§12.1). */
  removed: boolean;
}

export interface SevensServerState {
  phase: "playing" | "finished";
  settings: SevensSettings;
  players: SevensPlayerState[];
  board: SevensBoardState;
  dealerIndex: number;
  turnIndex: number;
  winnerId: string | null;
  turnNumber: number;
}

export interface SevensPublicState {
  players: { id: string; cardCount: number; removed: boolean }[];
  board: SevensBoardState;
  currentPlayerId: string | null;
  dealerId: string;
  winnerId: string | null;
  acePosition: AcePosition;
}

export interface SevensPrivateState {
  hand: Card[];
  playableCardIds: string[];
  canPass: boolean;
}

export type SevensAction = { type: "play-card"; cardId: string } | { type: "pass" };

export type SevensEvent =
  | { type: "dealt"; dealerId: string; handSizes: Record<string, number> }
  | { type: "card-played"; playerId: string; card: Card }
  | { type: "ghost-card-placed"; playerId: string; card: Card }
  | { type: "passed"; playerId: string; auto: boolean }
  | { type: "turn-skipped"; playerId: string }
  | { type: "player-removed"; playerId: string }
  | { type: "game-over"; winnerId: string | null };
