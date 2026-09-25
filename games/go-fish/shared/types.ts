export type Suit = "clubs" | "diamonds" | "hearts" | "spades";

export const SUITS: readonly Suit[] = ["spades", "hearts", "clubs", "diamonds"];

/** 1 (Ace) to 13 (King). Only rank matters here: suits just tell cards apart. */
export type Rank = number;

export const RANKS = 13;
/** Cards drawn when your hand runs dry (or whatever's left in the pond). */
export const REFILL = 5;

export interface Card {
  /** "clubs-8", "hearts-A". */
  id: string;
  suit: Suit;
  rank: Rank;
}

/** Nothing to choose yet. Kept as a type so the contract (and the lobby) have something to hold. */
export type GoFishSettings = Record<string, never>;

export const DEFAULT_SETTINGS: GoFishSettings = {};

export interface GoFishPlayerState {
  id: string;
  hand: Card[];
  /** Ranks this player has booked, in the order they came down. */
  books: Rank[];
  /** Host removed them. Their hand went back into the pond; their books stay down. */
  removed: boolean;
}

/** How an ask ended. "fished": no luck, drew. "caught": no luck, but drew the rank asked for. "dry": no luck and no pond. */
export type AskOutcome = "given" | "fished" | "caught" | "dry";

export interface AskRecord {
  playerId: string;
  targetId: string;
  rank: Rank;
  /** How many the target handed over. 0 means "go fish". */
  got: number;
  outcome: AskOutcome;
}

/** "done": all 13 books are down. "abandoned": fewer than two players left. */
export type EndReason = "done" | "abandoned";

export interface GoFishServerState {
  phase: "playing" | "finished";
  settings: GoFishSettings;
  players: GoFishPlayerState[];
  /** Face down. The last element is the top card. */
  pond: Card[];
  dealerIndex: number;
  turnIndex: number;
  turnNumber: number;
  /** Public by the rules: everyone hears every ask. Newest last, capped. */
  asks: AskRecord[];
  /** The rank of the latest book down, for the table. */
  lastBook: Rank | null;
  winnerIds: string[];
  endReason: EndReason | null;
}

export interface GoFishPublicState {
  players: {
    id: string;
    cardCount: number;
    books: Rank[];
    removed: boolean;
    /** Empty hand, empty pond: sitting out the rest of the game. */
    out: boolean;
  }[];
  currentPlayerId: string | null;
  dealerId: string;
  pondCount: number;
  /** The last few asks, oldest first. The table's memory, for people without one. */
  asks: AskRecord[];
  /** The rank of the latest book down. It's all four suits, so that's the whole book. */
  lastBook: Rank | null;
  booksDown: number;
  winnerIds: string[];
  endReason: EndReason | null;
}

export interface GoFishPrivateState {
  /** Sorted by rank, so a rank's cards sit together. */
  hand: Card[];
  /** Ranks you can ask for right now: yours, and only on your turn. */
  askableRanks: Rank[];
}

export type GoFishAction = { type: "ask"; targetId: string; rank: Rank };

export type GoFishEvent =
  | { type: "dealt"; dealerId: string; handSizes: Record<string, number>; pondCount: number }
  | { type: "asked"; playerId: string; targetId: string; rank: Rank }
  /** Handed over in the open: everyone heard the ask, everyone sees the cards. */
  | { type: "handed"; fromId: string; toId: string; cards: Card[] }
  /** `playerId` had none of what `askerId` asked for. */
  | { type: "go-fish"; playerId: string; askerId: string }
  /**
   * Public: who drew how many. `shown` is the catch they turned up (it was the
   * rank they asked for), else null. What they drew goes to them as `you-drew`.
   */
  | { type: "drew"; playerId: string; count: number; shown: Card | null; refill: boolean }
  | { type: "you-drew"; cards: Card[] }
  | { type: "booked"; playerId: string; rank: Rank; cards: Card[] }
  | { type: "went-out"; playerId: string }
  | { type: "turn-skipped"; playerId: string }
  | { type: "player-removed"; playerId: string; returned: number }
  | { type: "game-over"; winnerIds: string[]; reason: EndReason };
