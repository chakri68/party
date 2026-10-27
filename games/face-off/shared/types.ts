import type { Ballot } from "@games/game-core";

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export interface FaceOffSettings {
  /** Points to win. */
  target: number;
}

export const TARGET_OPTIONS: readonly number[] = [10, 15, 20];

export const DEFAULT_SETTINGS: FaceOffSettings = { target: 10 };

// ---------------------------------------------------------------------------
// Timing and limits
// ---------------------------------------------------------------------------

/** The quiet between duels, picked at random each time (inclusive). */
export const SPARK_MIN_MS = 4_000;
export const SPARK_MAX_MS = 9_000;
/** No buzz by then: nobody scores and both draw. */
export const DUEL_MS = 8_000;
export const CONFIRM_MS = 6_000;
/** The beat before a redone duel sparks again. */
export const REDO_MS = 2_000;
/** The match's time cap. */
export const CAP_MS = 5 * 60_000;
export const MIN_PLAYERS = 3;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export type Phase = "lull" | "duel" | "confirm" | "finished";

export type Choice = "confirm" | "overturn";
export const CHOICES: readonly Choice[] = ["confirm", "overturn"];

export interface FaceOffPlayerState {
  id: string;
  seat: number;
  /** Index into the deck. */
  card: number;
  score: number;
  removed: boolean;
  away: boolean;
}

export interface DuelState {
  a: string;
  b: string;
  /** Who buzzed first. Null until someone does. */
  claimId: string | null;
  /** This duel is already a redo; it can't be redone again. */
  redone: boolean;
  /** Open from the buzz to the resolution. */
  ballot: Ballot<Choice> | null;
}

/**
 * How the last duel ended. "point": the claim stood. "overturned": the point
 * went to the other duelist. "void": nobody buzzed in time, or the host
 * skipped it. "left": a duelist left.
 */
export type OutcomeKind = "point" | "overturned" | "void" | "left";

export interface Outcome {
  kind: OutcomeKind;
  a: string;
  b: string;
  winnerId: string | null;
  loserId: string | null;
  /** Vote counts, public once the duel's resolved. */
  confirm: number;
  overturn: number;
  /** Who drew a new card. */
  drew: string[];
}

/** "target": someone reached it. "time": the cap. "abandoned": under three players. */
export type EndReason = "target" | "time" | "abandoned";

export interface FaceOffServerState {
  phase: Phase;
  settings: FaceOffSettings;
  players: FaceOffPlayerState[];
  deadline: number;
  phaseMs: number;
  /** When the cap falls. */
  endsAt: number;
  /** The cap fell mid-duel: the game ends when it resolves. */
  capped: boolean;
  duel: DuelState | null;
  /** A redone pair, sparked when the lull ends. */
  queued: [string, string] | null;
  /** The last pair to duel, for the weighting. */
  lastPair: [string, string] | null;
  last: Outcome | null;
  /** Duels sparked so far, redos included. */
  duels: number;
  /** The match's card order, as indexes into the deck. */
  order: number[];
  /** Next unused position in `order`. */
  pos: number;
  /** Category ids the last match used, carried on so a rematch deals fresh ones first. */
  usedBefore: string[];
  /** The order ran out and started over. */
  reshuffled: boolean;
  /** Test-only categories. Null: the real deck. */
  deck: string[] | null;
  endReason: EndReason | null;
}

export interface PublicPlayer {
  id: string;
  category: string;
  score: number;
  removed: boolean;
}

export interface PublicDuel {
  a: string;
  b: string;
  claimId: string | null;
  redone: boolean;
  /** How many have voted, never which way. */
  voted: number;
  voters: number;
}

export interface FaceOffPublicState {
  phase: Phase;
  deadline: number;
  phaseMs: number;
  endsAt: number;
  target: number;
  players: PublicPlayer[];
  duel: PublicDuel | null;
  queued: [string, string] | null;
  last: Outcome | null;
  duels: number;
  reshuffled: boolean;
  endReason: EndReason | null;
}

export interface FaceOffPrivateState {
  canBuzz: boolean;
  canRedo: boolean;
  canVote: boolean;
  myVote: Choice | null;
}

export type FaceOffAction = { type: "buzz" } | { type: "redo" } | { type: "vote"; choice: Choice };

export type FaceOffEvent =
  | { type: "spark"; a: string; b: string; redone: boolean }
  | { type: "buzzed"; by: string }
  | { type: "redo"; by: string }
  | { type: "outcome"; outcome: Outcome }
  | { type: "reshuffled" }
  | { type: "skipped"; playerId: string }
  | { type: "game-over"; reason: EndReason };

/** What a finished match hands the next one. */
export interface FaceOffCarry {
  used: string[];
}

/** Category text to id: "a breakfast food" → "a-breakfast-food". */
export const categoryId = (text: string): string => text.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
