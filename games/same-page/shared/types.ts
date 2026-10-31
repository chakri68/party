// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export interface SamePageSettings {
  /** Prompts per game. */
  rounds: number;
  /** How long everyone gets to type. */
  answerSeconds: number;
  /** The only lone answer in a round costs its owner a point. */
  lone: boolean;
}

export const ROUNDS_OPTIONS: readonly number[] = [8, 12, 16];
export const ANSWER_SECONDS_OPTIONS: readonly number[] = [20, 30, 45];

export const DEFAULT_SETTINGS: SamePageSettings = { rounds: 12, answerSeconds: 30, lone: false };

// ---------------------------------------------------------------------------
// Timing and limits
// ---------------------------------------------------------------------------

/** The host's tidy-up. */
export const TIDY_MS = 20_000;
/** The reveal, unless everyone taps Ready first. */
export const REVEAL_MS = 8_000;
/** Everyone's in: the answer clock drops to this, so a change of heart still fits. */
export const ALL_IN_MS = 5_000;
export const MAX_ANSWER = 40;
export const MIN_PLAYERS = 3;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export type Phase = "answering" | "tidying" | "reveal" | "over";

export interface SamePagePlayerState {
  id: string;
  seat: number;
  score: number;
  removed: boolean;
  away: boolean;
}

/** One answer group as the machine made it. The id is stable while its first member stays. */
export interface AutoGroup {
  id: string;
  /** Player ids, seat order. */
  members: string[];
}

/** `from` folded into `into`: by the host, or `auto` for a near-duplicate. Undone by splitting `into`. */
export interface Merge {
  from: string;
  into: string;
  auto?: true;
}

export interface GroupMember {
  id: string;
  /** What they typed, trimmed. */
  text: string;
}

/** A group as everyone sees it, once answers are public. */
export interface PublicGroup {
  id: string;
  label: string;
  members: GroupMember[];
  /** The host merged something into it: it can be split. */
  merged: boolean;
}

export interface RoundResult {
  /** Biggest first. */
  groups: PublicGroup[];
  /** Ids of the biggest group(s), if any scored. */
  winners: string[];
  /** Who answered nothing. */
  blanks: string[];
  /** What each player's score actually moved by this round (the floor applied). */
  points: Record<string, number>;
  /** The one lone answer that cost a point, with the setting on. */
  loneId: string | null;
}

export interface RoundState {
  /** 1-based. */
  number: number;
  promptId: string;
  prompt: string;
  /** Trimmed. Blank answers are left out. Secret until tidying. */
  answers: Record<string, string>;
  /** Built when answering ends. */
  groups: AutoGroup[];
  merges: Merge[];
  /** Tapped Ready during the reveal. */
  ready: string[];
  /** The clock dropped because everyone was in. */
  hurried: boolean;
  result: RoundResult | null;
}

export type EndReason = "rounds" | "abandoned";

export interface Prompt {
  id: string;
  text: string;
}

export interface SamePageServerState {
  phase: Phase;
  settings: SamePageSettings;
  players: SamePagePlayerState[];
  deadline: number;
  phaseMs: number;
  round: RoundState;
  /** Prompt ids this match has used. */
  used: string[];
  /** Prompt ids the last match used, carried on so a rematch gets fresh ones. */
  usedBefore: string[];
  /** Test-only prompts. Null: the real list. */
  deck: Prompt[] | null;
  /** The room's host, as last seen. Only for who the room is waiting on. */
  hostId: string | null;
  endReason: EndReason | null;
}

export interface PublicPlayer {
  id: string;
  score: number;
  removed: boolean;
  /** Has an answer in. Only meaningful while answering; never what it is. */
  answered: boolean;
}

export interface SamePagePublicState {
  phase: Phase;
  round: number;
  rounds: number;
  prompt: string;
  deadline: number;
  phaseMs: number;
  lone: boolean;
  players: PublicPlayer[];
  /** From tidying on. Null while answers are secret. */
  groups: PublicGroup[] | null;
  /** The reveal's numbers. */
  result: RoundResult | null;
  endReason: EndReason | null;
}

export interface SamePagePrivateState {
  /** Your own answer, before anyone else can see it. */
  answer: string | null;
  canAnswer: boolean;
}

export type SamePageAction =
  | { type: "answer"; text: string }
  | { type: "merge"; from: string; into: string }
  | { type: "split"; group: string }
  | { type: "done" }
  | { type: "ready" };

export type SamePageEvent =
  | { type: "round"; round: number; prompt: string }
  /** Public: who's in, never what. */
  | { type: "answered"; playerId: string; in: boolean }
  | { type: "you-answered"; text: string }
  | { type: "hurry" }
  | { type: "tidying" }
  | { type: "merged"; from: string; into: string }
  | { type: "split"; group: string }
  | { type: "revealed"; round: number }
  | { type: "player-removed"; playerId: string }
  | { type: "game-over"; reason: EndReason };

/** What a finished match hands the next one. */
export interface SamePageCarry {
  used: string[];
}
