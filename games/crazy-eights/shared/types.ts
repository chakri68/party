export type Suit = "clubs" | "diamonds" | "hearts" | "spades";

/** Hand sort order. Alternating colours so neighbouring suits don't blur together. */
export const SUITS: readonly Suit[] = ["spades", "hearts", "clubs", "diamonds"];

/** 1 (Ace) to 13 (King). Aces are low here: they're worth 1 point. */
export type Rank = number;

export const EIGHT: Rank = 8;
export const HAND_SIZE = 5;

export interface Card {
  /** "clubs-8", "hearts-A"; the second deck adds a suffix: "clubs-8~1". */
  id: string;
  suit: Suit;
  rank: Rank;
  /** Which deck this copy came from (0-based). Copies are otherwise identical. */
  copy: number;
}

export type DeckSetting = "auto" | 1 | 2;
export const MAX_DECKS = 2;

/**
 * "pass" is Bicycle's rule: once the stock's gone, anyone who can't play just
 * passes. "reshuffle" is the house rule most tables actually play.
 */
export type EmptyStockRule = "pass" | "reshuffle";

export interface CrazyEightsSettings {
  /** "auto" picks by player count (see resolveDecks). */
  decks: DeckSetting;
  emptyStock: EmptyStockRule;
}

export const DEFAULT_SETTINGS: CrazyEightsSettings = {
  decks: "auto",
  emptyStock: "pass",
};

export interface CrazyEightsPlayerState {
  id: string;
  hand: Card[];
  /** Host removed them; their cards went to the bottom of the stock. */
  removed: boolean;
}

/**
 * "out": someone emptied their hand. "blocked": the stock ran dry and nobody
 * could play. "abandoned": everyone else left.
 */
export type EndReason = "out" | "blocked" | "abandoned";

export interface CrazyEightsServerState {
  phase: "playing" | "finished";
  settings: CrazyEightsSettings;
  players: CrazyEightsPlayerState[];
  /** Resolved deck count for this game. */
  decks: number;
  /** Face down. The last element is the top card. */
  stock: Card[];
  /** Face up. The last element is the top card. */
  discard: Card[];
  /** The suit named with the eight on top of the discard, if it is one. */
  calledSuit: Suit | null;
  dealerIndex: number;
  turnIndex: number;
  turnNumber: number;
  winnerIds: string[];
  endReason: EndReason | null;
}

export interface CrazyEightsPublicState {
  players: { id: string; cardCount: number; removed: boolean }[];
  topCard: Card;
  calledSuit: Suit | null;
  /** What the next card has to follow: the called suit, else the top card's. */
  activeSuit: Suit;
  stockCount: number;
  /** Cards a reshuffle could bring back (all but the top), if the rule is on. */
  reshuffleCount: number;
  currentPlayerId: string | null;
  dealerId: string;
  winnerIds: string[];
  endReason: EndReason | null;
}

export interface CrazyEightsPrivateState {
  hand: Card[];
  playableCardIds: string[];
  canDraw: boolean;
}

export type CrazyEightsAction =
  | { type: "play-card"; cardId: string; suit?: Suit }
  | { type: "draw" };

export type CrazyEightsEvent =
  | { type: "dealt"; dealerId: string; handSizes: Record<string, number>; starter: Card; buried: Card[] }
  | { type: "card-played"; playerId: string; card: Card; calledSuit: Suit | null }
  /** Public: someone drew. What they drew only goes to them, as `you-drew`. */
  | { type: "drew"; playerId: string }
  | { type: "you-drew"; card: Card }
  | { type: "reshuffled"; count: number }
  | { type: "passed"; playerId: string }
  | { type: "turn-skipped"; playerId: string }
  | { type: "player-removed"; playerId: string }
  | { type: "game-over"; winnerIds: string[]; reason: EndReason };
