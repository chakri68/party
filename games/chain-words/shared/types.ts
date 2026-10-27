// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export interface ChainWordsSettings {
  /** Seconds on the clock each turn. */
  turnSeconds: number;
  lives: number;
}

export const TURN_OPTIONS: readonly number[] = [5, 8, 12];
export const LIVES_OPTIONS: readonly number[] = [1, 2, 3];

export const DEFAULT_SETTINGS: ChainWordsSettings = { turnSeconds: 8, lives: 3 };

/** How much of the chain goes out to the table. The server keeps all of it. */
export const CHAIN_SHOWN = 12;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export type ChainPhase = "live" | "finished";

export interface ChainWordsPlayerState {
  id: string;
  lives: number;
  /** Host removed them. Out, but not timed out. */
  removed: boolean;
  /** Socket's down. Passed over when the turn moves, if anyone else can take it. */
  away: boolean;
  /** Words they've added to the chain. */
  words: number;
}

/** One link. The opener has no player. */
export interface Link {
  playerId: string | null;
  word: string;
}

export interface ChainWordsServerState {
  phase: ChainPhase;
  settings: ChainWordsSettings;
  players: ChainWordsPlayerState[];
  /** Bumps every time the turn changes hands; pins typing to a holder. */
  turn: number;
  holderId: string;
  /** What the next word has to start with. */
  letter: string;
  /** When the holder's clock runs out, in server ms. */
  deadline: number;
  /** Every word played this game, opener first. Doubles as the used list. */
  chain: Link[];
  /** Eliminated, first out first. Leavers aren't in it. */
  outOrder: string[];
  /** What the holder has typed so far. */
  typing: string;
}

export interface ChainWordsPublicState {
  phase: ChainPhase;
  turn: number;
  holderId: string;
  letter: string;
  deadline: number;
  turnMs: number;
  /** The last CHAIN_SHOWN links. */
  chain: Link[];
  chainLength: number;
  maxLives: number;
  players: { id: string; lives: number; removed: boolean; words: number }[];
  outOrder: string[];
}

export interface ChainWordsPrivateState {
  /** Your go: type a word. */
  holding: boolean;
}

export type ChainWordsAction = { type: "word"; text: string };

export type ChainWordsEvent =
  | { type: "opened"; word: string; holderId: string }
  | { type: "played"; playerId: string; word: string; to: string }
  | { type: "rescued"; from: string; to: string }
  | { type: "timeout"; playerId: string; lives: number; to: string | null }
  | { type: "skipped"; from: string; to: string }
  | { type: "left"; playerId: string; to: string | null }
  | { type: "game-over"; winnerId: string | null };
