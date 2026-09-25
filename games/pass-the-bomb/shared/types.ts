// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export type FuseLength = "short" | "normal" | "long";

export interface PassTheBombSettings {
  lives: number;
  fuse: FuseLength;
}

export const LIVES_OPTIONS: readonly number[] = [1, 2, 3];
export const FUSE_OPTIONS: readonly FuseLength[] = ["short", "normal", "long"];

/** Each round's fuse is drawn from this range (ms), and nobody's told what it came out as. */
export const FUSE_MS: Record<FuseLength, readonly [number, number]> = {
  short: [6_000, 18_000],
  normal: [10_000, 30_000],
  long: [18_000, 45_000],
};

export const DEFAULT_SETTINGS: PassTheBombSettings = { lives: 2, fuse: "normal" };

// ---------------------------------------------------------------------------
// Timing and words
// ---------------------------------------------------------------------------

/** The smoke clearing between a bang and the next round. */
export const BOOM_MS = 4_000;
export const MIN_WORD = 3;
/** Nothing in the dictionary is longer; anything past it is a cat on the keyboard. */
export const MAX_WORD = 30;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** live: fuse burning. boom: it just went off, next round shortly. */
export type BombPhase = "live" | "boom";

export interface PassTheBombPlayerState {
  id: string;
  lives: number;
  /** Host removed them. Out, but not blown up. */
  removed: boolean;
  /** Socket's down. Passed over when the bomb moves, if anyone else can take it. */
  away: boolean;
}

export interface PassTheBombServerState {
  phase: BombPhase | "finished";
  settings: PassTheBombSettings;
  players: PassTheBombPlayerState[];
  round: number;
  /** Bumps every time the bomb changes hands; pins typing to a holder. */
  turn: number;
  holderId: string;
  cluster: string;
  /** Who it went off on, from the bang until the next round starts. */
  blownId: string | null;
  lastWord: PlayedWord | null;
  /** Every word played this game, so none gets played twice. */
  used: string[];
  /** Eliminated, first out first. Leavers aren't in it. */
  outOrder: string[];
  /** Where clusters come from. */
  clusters: string[];
  /** What the holder has typed so far (§35 stream). */
  typing: string;
}

export interface PlayedWord {
  playerId: string;
  word: string;
}

export interface PassTheBombPublicState {
  phase: BombPhase | "finished";
  round: number;
  turn: number;
  holderId: string;
  cluster: string;
  blownId: string | null;
  lastWord: PlayedWord | null;
  usedCount: number;
  maxLives: number;
  players: { id: string; lives: number; removed: boolean }[];
  outOrder: string[];
}

export interface PassTheBombPrivateState {
  /** Your go: type a word. */
  holding: boolean;
}

export type PassTheBombAction = { type: "word"; text: string };

/** The holder's typing, relayed as-is. `wrong`: a word just bounced. */
export interface TypingData {
  turn: number;
  text: string;
  wrong?: boolean;
}

export type PassTheBombEvent =
  | { type: "round-started"; round: number; holderId: string }
  | { type: "passed"; from: string; to: string; word: string }
  | { type: "skipped"; from: string; to: string }
  | { type: "left"; playerId: string; to: string | null }
  | { type: "boom"; playerId: string; lives: number }
  | { type: "game-over"; winnerId: string | null };
