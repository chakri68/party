export type Suit = "clubs" | "diamonds" | "hearts" | "spades";

/** Hand sort order. Alternating colours so neighbouring suits don't blur together. */
export const SUITS: readonly Suit[] = ["spades", "hearts", "clubs", "diamonds"];

/** 1 (Ace) to 13 (King). The claim goes A, 2 … K, then round to A again. */
export type Rank = number;

export const ACE: Rank = 1;
export const KING: Rank = 13;

/** Most cards one play can put down. Four of a kind is the most anyone could honestly have. */
export const MAX_PLAY = 4;

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
 * "strict": every claim is the next rank up. "near": the same rank as the
 * last claim, or one either side, which gives an honest way out more often.
 */
export type ClaimRule = "strict" | "near";

export const WINDOW_SECONDS_OPTIONS = [5, 8, 12] as const;

export interface CheatSettings {
  /** "auto" picks by player count (see resolveDecks). */
  decks: DeckSetting;
  claims: ClaimRule;
  /** How long everyone gets to call "Cheat!" after a play. */
  windowSeconds: number;
}

export const DEFAULT_SETTINGS: CheatSettings = { decks: "auto", claims: "strict", windowSeconds: 8 };

export interface CheatPlayerState {
  id: string;
  hand: Card[];
  /** Host removed them; their cards went under the pile. */
  removed: boolean;
  /** Connection dropped. Can't call, so the window doesn't wait for them. */
  away: boolean;
}

/** The play on top of the pile, face down. Only its owner knows the cards. */
export interface Play {
  playerId: string;
  cards: Card[];
  claim: Rank;
}

/** A call, after the flip. All public: the cards were turned over for everyone. */
export interface Reveal {
  callerId: string;
  playerId: string;
  claim: Rank;
  cards: Card[];
  lied: boolean;
  /** The liar, or the caller who got it wrong. */
  takerId: string;
  /** How many cards they picked up. */
  taken: number;
}

/**
 * "play": waiting on the player whose turn it is. "window": a play is down
 * and anyone else can call it; the room's timer closes it.
 */
export type Step = "play" | "window";

/** "out": someone emptied their hand and it stood. "abandoned": everyone else left. */
export type EndReason = "out" | "abandoned";

export interface CheatServerState {
  phase: "playing" | "finished";
  step: Step;
  settings: CheatSettings;
  players: CheatPlayerState[];
  /** Resolved deck count for this game. */
  decks: number;
  dealerIndex: number;
  /** Whose turn it is to play; during a window, who just played. */
  turnIndex: number;
  turnNumber: number;
  /** Face down, bottom first. The last play is on top. */
  pile: Card[];
  lastPlay: Play | null;
  /** The last claim made, called or not. Null before the first play. */
  lastClaim: Rank | null;
  /** When the window closes (server clock), and how long it was. */
  windowEndsAt: number;
  windowMs: number;
  /** Players who've let this play go. */
  passed: string[];
  /** The most recent call, until the next play. */
  lastReveal: Reveal | null;
  winnerId: string | null;
  endReason: EndReason | null;
}

export interface CheatPublicState {
  players: { id: string; cardCount: number; removed: boolean; passed: boolean }[];
  /** Whose turn to play. Null during a window and once it's over. */
  currentPlayerId: string | null;
  dealerId: string;
  step: Step | "finished";
  /** Ranks the current player may claim. Empty unless it's the play step. */
  claims: Rank[];
  claimRule: ClaimRule;
  pileCount: number;
  /** The play on top, face down: who, how many, and what they say it is. */
  lastPlay: { playerId: string; count: number; claim: Rank } | null;
  /** While a window's open. */
  window: { playerId: string; endsAt: number; ms: number } | null;
  lastReveal: Reveal | null;
  winnerId: string | null;
  endReason: EndReason | null;
}

export interface CheatPrivateState {
  /** Sorted by rank. */
  hand: Card[];
  /** What you put down in the play on top, while it's still there. */
  myPlay: Card[] | null;
  canPlay: boolean;
  canCall: boolean;
}

export type CheatAction =
  /** `claim` can be left out when there's only one rank you could claim. */
  | { type: "play"; cardIds: string[]; claim?: Rank }
  | { type: "call" }
  /** Let the play on top go without calling it. */
  | { type: "pass" };

export type CheatEvent =
  | { type: "dealt"; dealerId: string; decks: number; handSizes: Record<string, number> }
  /** Public: how many, and the claim. The cards themselves stay with the player. */
  | { type: "played"; playerId: string; count: number; claim: Rank }
  | { type: "you-played"; cards: Card[] }
  | { type: "passed"; playerId: string }
  /** The window ran out (or everyone let it go). */
  | { type: "accepted"; playerId: string }
  | ({ type: "called" } & Reveal)
  | { type: "turn-skipped"; playerId: string }
  | { type: "player-removed"; playerId: string }
  | { type: "game-over"; winnerId: string | null; reason: EndReason };
