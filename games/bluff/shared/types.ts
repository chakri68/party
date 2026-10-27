import type { Ballot } from "@games/game-core";

// ---------------------------------------------------------------------------
// Variants
// ---------------------------------------------------------------------------

/** Fake Word: invent the word. Bluff Definitions: invent the meaning. */
export type Variant = "fake-word" | "bluff-definitions";

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export interface BluffSettings {
  rounds: number;
}

export const ROUND_OPTIONS: readonly number[] = [3, 5];
export const DEFAULT_SETTINGS: BluffSettings = { rounds: 5 };

// ---------------------------------------------------------------------------
// Timing and limits
// ---------------------------------------------------------------------------

export const WRITE_MS: Record<Variant, number> = { "fake-word": 45_000, "bluff-definitions": 60_000 };
export const VOTE_MS = 30_000;
export const REVEAL_MS = 12_000;

export const MIN_FAKE = 3;
export const MAX_FAKE = 18;
export const MIN_DEFINITION = 15;
export const MAX_DEFINITION = 180;
export const MIN_PLAYERS = 3;

/** For finding the real one. */
export const FOUND_POINTS = 2;
/** For each opponent your fake fooled. */
export const FOOLED_POINTS = 1;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export type RoundPhase = "write" | "vote" | "reveal";
export type Phase = RoundPhase | "finished";

/** One real word, its meaning, and a line of flavour for the reveal. */
export interface Entry {
  word: string;
  definition: string;
  notes: string;
}

export interface BluffPlayerState {
  id: string;
  score: number;
  /** Host removed them, or they left. */
  removed: boolean;
  /** Socket's down. They don't hold a phase up. */
  away: boolean;
}

export interface ServerOption {
  /** Random, per round: says nothing about the author or the slot. */
  id: string;
  /** Null: the real one. */
  author: string | null;
  /** As shown. */
  text: string;
}

export interface RoundState {
  phase: RoundPhase;
  /** When this phase runs out (server clock), and how long it was. */
  deadline: number;
  phaseMs: number;
  entry: Entry;
  /** By player, cleaned. Null: done without one (skipped). Absent: not yet. */
  entries: Record<string, string | null>;
  /** Built, shuffled, when voting opens. */
  options: ServerOption[];
  ballot: Ballot | null;
  /** Points each player made this round, set at the reveal. */
  gained: Record<string, number>;
}

/** "done": all rounds played. "abandoned": fewer than three people left. */
export type EndReason = "done" | "abandoned";

export interface BluffServerState {
  variant: Variant;
  phase: "playing" | "finished";
  settings: BluffSettings;
  players: BluffPlayerState[];
  /** 1-based. */
  roundNumber: number;
  round: RoundState;
  /** Real words already played, this game and the ones before it (carryOver). */
  used: string[];
  /** Test-only list. Null: the real one. */
  deck: Entry[] | null;
  endReason: EndReason | null;
}

export interface PublicOption {
  id: string;
  text: string;
}

export interface BluffPublicState {
  variant: Variant;
  phase: Phase;
  round: number;
  rounds: number;
  deadline: number;
  phaseMs: number;
  players: { id: string; score: number; removed: boolean; done: boolean }[];
  /** Bluff Definitions: always. Fake Word: from the reveal on (it's the answer). */
  word: string | null;
  /** Fake Word: always. Bluff Definitions: from the reveal on (it's the answer). */
  definition: string | null;
  notes: string | null;
  /** From the vote on, in display order. */
  options: PublicOption[] | null;
  /** From the reveal on. */
  realId: string | null;
  /** From the reveal on: option id → who wrote it. */
  authors: Record<string, string> | null;
  /** From the reveal on: voter → option id. */
  votes: Record<string, string> | null;
  gained: Record<string, number> | null;
  /** The round had no fakes, so no vote. */
  noFakes: boolean;
  endReason: EndReason | null;
}

export interface BluffPrivateState {
  /** What you wrote this round. */
  mine: string | null;
  sent: boolean;
  /** Your option's id, from the vote on. */
  mineId: string | null;
  vote: string | null;
  /** Option ids you may vote for right now. */
  choices: string[];
}

export type BluffAction = { type: "submit"; text: string } | { type: "vote"; optionId: string } | { type: "next" };

export type BluffEvent =
  | { type: "round-started"; round: number }
  | { type: "vote-open" }
  | { type: "no-fakes" }
  | { type: "revealed"; realId: string | null }
  | { type: "skipped"; playerId: string }
  | { type: "game-over"; reason: EndReason };
