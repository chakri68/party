import type { Ballot } from "@games/game-core";

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export type FuseLength = "short" | "normal" | "long";

/** What happens to a word that fits but the game doesn't know. */
export type UnknownWords = "strict" | "vote" | "allow";

/** The four toggles, each independent. Any combination that has prompts is allowed. */
export interface BombModes {
  /** The letters must end the word. */
  ending: boolean;
  /** The bomb shows the letters backwards (shared/rules.ts: effectiveCluster). */
  reverse: boolean;
  /** LENGTH_MIN to LENGTH_MAX letters. */
  length: boolean;
  /** The word must be on the current category's list. */
  category: boolean;
}

export interface PassTheBombSettings extends BombModes {
  lives: number;
  fuse: FuseLength;
  unknown: UnknownWords;
}

export const LIVES_OPTIONS: readonly number[] = [1, 2, 3];
export const FUSE_OPTIONS: readonly FuseLength[] = ["short", "normal", "long"];
export const UNKNOWN_OPTIONS: readonly UnknownWords[] = ["vote", "strict", "allow"];
export const MODE_KEYS: readonly (keyof BombModes)[] = ["ending", "reverse", "length", "category"];
export const NO_MODES: BombModes = { ending: false, reverse: false, length: false, category: false };

/** Each round's fuse is drawn from this range (ms), and nobody's told what it came out as. */
export const FUSE_MS: Record<FuseLength, readonly [number, number]> = {
  short: [6_000, 18_000],
  normal: [10_000, 30_000],
  long: [18_000, 45_000],
};

export const DEFAULT_SETTINGS: PassTheBombSettings = { lives: 2, fuse: "normal", ...NO_MODES, unknown: "vote" };

/** The categories, in lobby order. The lists themselves are server/categories.ts. */
export const CATEGORIES = ["animals", "food", "body", "home", "nature", "jobs"] as const;
export type Category = (typeof CATEGORIES)[number];
export const CATEGORY_LABELS: Record<Category, string> = {
  animals: "Animals",
  food: "Food",
  body: "Body",
  home: "Home",
  nature: "Nature",
  jobs: "Jobs",
};

// ---------------------------------------------------------------------------
// Timing and words
// ---------------------------------------------------------------------------

/** The smoke clearing between a bang and the next round. */
export const BOOM_MS = 4_000;
export const MIN_WORD = 3;
/** Nothing in the dictionary is longer; anything past it is a cat on the keyboard. */
export const MAX_WORD = 30;
/** The length mode's bounds, inclusive. */
export const LENGTH_MIN = 5;
export const LENGTH_MAX = 10;
/** A prompt is dealt only with at least this many answers left (source §4.2). */
export const MIN_ANSWERS = 8;
/** The room's say on an unknown word. */
export const VOTE_MS = 4_000;
/** Votes one holder can call per hold, before unknown words just bounce. */
export const MAX_HOLD_VOTES = 2;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** live: fuse burning. vote: fuse frozen, the room's deciding on a word. boom: it just went off, next round shortly. */
export type BombPhase = "live" | "vote" | "boom";

export type VoteChoice = "reject" | "allow";
export const VOTE_CHOICES: readonly VoteChoice[] = ["reject", "allow"];

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
  /** What the word needs (the effective cluster). The bomb may show it otherwise. */
  cluster: string;
  /** In category mode, the current prompt's category. */
  category: Category | null;
  /** Who it went off on, from the bang until the next round starts. */
  blownId: string | null;
  lastWord: PlayedWord | null;
  /** Every word played this game, so none gets played twice. */
  used: string[];
  /** Words the room voted down this game, as `category:word` in category mode. They don't come back for another vote. */
  rejected: string[];
  /** When the fuse goes, by ctx.now. Meaningless outside `live`. */
  fuseEndsAt: number;
  /** The fuse left when a vote froze it. */
  fuseLeft: number;
  /** Votes called on this hold. Back to 0 when the bomb changes hands. */
  holdVotes: number;
  /** Ballot ids, so a vote cast on an old ballot can't land on a new one. */
  voteSeq: number;
  vote: OpenVote | null;
  lastVote: ClosedVote | null;
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

export interface OpenVote {
  id: number;
  by: string;
  word: string;
  ballot: Ballot<VoteChoice>;
  deadline: number;
}

export interface ClosedVote {
  id: number;
  by: string;
  word: string;
  allowed: boolean;
  votes: Record<string, VoteChoice>;
}

/** What everyone sees of a vote while it's open: who's voted, never how. */
export interface PublicVote {
  id: number;
  by: string;
  word: string;
  voters: string[];
  voted: string[];
  deadline: number;
  ms: number;
}

export interface PassTheBombPublicState {
  phase: BombPhase | "finished";
  round: number;
  turn: number;
  holderId: string;
  /** What the bomb shows. effectiveCluster(cluster, modes) is what the word needs. */
  cluster: string;
  modes: BombModes;
  category: Category | null;
  unknown: UnknownWords;
  vote: PublicVote | null;
  lastVote: ClosedVote | null;
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
  /** You're on the open vote's ballot. */
  canVote: boolean;
  myVote: VoteChoice | null;
}

export type PassTheBombAction = { type: "word"; text: string } | { type: "vote"; ballot: number; choice: VoteChoice };

/** The holder's typing, relayed as-is. `wrong`: a word just bounced. */
export interface TypingData {
  turn: number;
  text: string;
  wrong?: boolean;
}

export type PassTheBombEvent =
  | { type: "round-started"; round: number; holderId: string }
  | { type: "passed"; from: string; to: string; word: string; voted?: true }
  | { type: "vote-opened"; ballot: number; by: string; word: string }
  | ({ type: "vote-closed" } & ClosedVote)
  | { type: "vote-called-off"; ballot: number }
  | { type: "skipped"; from: string; to: string }
  | { type: "left"; playerId: string; to: string | null }
  | { type: "boom"; playerId: string; lives: number }
  | { type: "game-over"; winnerId: string | null };
