export type Suit = "clubs" | "diamonds" | "hearts" | "spades";

export const SUITS: readonly Suit[] = ["spades", "hearts", "clubs", "diamonds"];

/** 1 (Ace) to 13 (King). The joker is rank 0 and pairs with nothing. */
export type Rank = number;

export const QUEEN: Rank = 12;
export const JOKER_RANK: Rank = 0;

export interface Card {
  /** "clubs-8", "hearts-A", or "joker". */
  id: string;
  suit: Suit | "joker";
  rank: Rank;
}

/**
 * Which card goes unpaired. "queen": pull a queen, so one of the other three
 * is left without a partner, and nobody knows which until the end. "joker":
 * add one, and everyone knows exactly what they're dodging.
 */
export type OldMaidCard = "queen" | "joker";

export interface OldMaidSettings {
  oldMaid: OldMaidCard;
}

export const DEFAULT_SETTINGS: OldMaidSettings = { oldMaid: "queen" };

/** The queen that comes out in "queen" mode. */
export const PULLED_QUEEN = "clubs-Q";

export interface OldMaidPlayerState {
  id: string;
  /**
   * The order is the fan the next taker picks from, so it's secret and gets
   * reshuffled whenever a card comes in. Clients get it sorted.
   */
  hand: Card[];
  /** Host removed them; their cards went to the next player still holding. */
  removed: boolean;
}

/** "done": one player left holding. "abandoned": leavers broke it up first. */
export type EndReason = "done" | "abandoned";

export interface OldMaidServerState {
  phase: "playing" | "finished";
  settings: OldMaidSettings;
  players: OldMaidPlayerState[];
  dealerIndex: number;
  /** Who's taking. They take from the previous player still holding cards. */
  turnIndex: number;
  turnNumber: number;
  /** Face up. Pairs, in the order they came down. */
  discard: Card[];
  /** Player ids in the order they ran out of cards. */
  outOrder: string[];
  /** Left holding the odd card. */
  loserId: string | null;
  endReason: EndReason | null;
}

export interface OldMaidPublicState {
  players: { id: string; cardCount: number; removed: boolean; outPlace: number | null }[];
  currentPlayerId: string | null;
  /** Whose fan the current player picks from. */
  sourceId: string | null;
  dealerId: string;
  discardCount: number;
  /** The pair on top of the discard, if any. */
  lastPair: Card[] | null;
  oldMaid: OldMaidCard;
  loserId: string | null;
  /** The card the loser got stuck with. */
  loserCard: Card | null;
  endReason: EndReason | null;
}

export interface OldMaidPrivateState {
  /** Sorted by rank. */
  hand: Card[];
  canTake: boolean;
}

export type OldMaidAction = { type: "take"; slot: number };

export type OldMaidEvent =
  | { type: "dealt"; dealerId: string; handSizes: Record<string, number> }
  /** Pairs go down face up, so everyone sees them. */
  | { type: "discarded"; playerId: string; pairs: Card[][] }
  /** Public: who took which slot of whose fan. The card itself is private. */
  | { type: "took"; playerId: string; fromId: string; slot: number }
  | { type: "you-took"; card: Card; fromId: string }
  | { type: "taken-from-you"; card: Card; byId: string }
  | { type: "went-out"; playerId: string; place: number }
  | { type: "turn-skipped"; playerId: string }
  | { type: "player-removed"; playerId: string; toId: string | null }
  | { type: "game-over"; loserId: string | null; reason: EndReason };
