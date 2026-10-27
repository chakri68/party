import type { Ballot } from "@games/game-core";
import type { Deck, DeckSettings } from "@games/hidden-roles";
import type { RoleId, Team } from "./roles.ts";

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/** Flat, per the kit: `preset`, `n:<role>` counts, then ours. */
export interface ShortNightSettings extends DeckSettings {
  discussMinutes: number;
  stepSeconds: number;
}

export const DISCUSS_OPTIONS: readonly number[] = [3, 4, 5, 6];
export const STEP_OPTIONS: readonly number[] = [10, 15, 20];

export const DEFAULT_SETTINGS: ShortNightSettings = { preset: "standard", discussMinutes: 4, stepSeconds: 15 };

// ---------------------------------------------------------------------------
// Timing
// ---------------------------------------------------------------------------

export const REVEAL_MS = 30_000;
export const VOTE_MS = 20_000;
export const RUNOFF_MS = 10_000;
/** Below this many players still in, the round can't be fair. */
export const MIN_LEFT = 3;

/** The vote's "nobody goes" choice. Never a player id: those are opaque tokens. */
export const NOBODY = "nobody";

// ---------------------------------------------------------------------------
// Night results. Every one is computed from the deal, which never changes.
// ---------------------------------------------------------------------------

export type NightResult =
  /** Every Wolf's. `pack` is all the Wolves, you included; a lone Wolf gets a Villager (or null: none dealt). */
  | { kind: "wolves"; pack: string[]; villager: string | null }
  | { kind: "lamp"; target: string; reads: Team }
  | { kind: "match"; targets: [string, string]; same: boolean }
  | { kind: "bell"; neighbours: [string, string]; count: number }
  | { kind: "eavesdropper"; pair: [string, string] }
  | { kind: "wander"; target: string; notRole: RoleId }
  /** A picker whose step ran out. */
  | { kind: "missed" };

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export type Phase = "reveal" | "night" | "day" | "vote" | "runoff" | "finished";

/** "done": the vote settled it. The others end it with no winner. */
export type EndReason = "done" | "last-wolf-left" | "too-few" | "runoff-left";

export interface ShortNightPlayer {
  id: string;
  /** Gone for good. Their card stays on the table and secret. */
  left: boolean;
  /** Socket's down. They hold nothing up. */
  away: boolean;
}

export interface ShortNightServerState {
  phase: Phase;
  settings: ShortNightSettings;
  /** For tally's tie-break hash; nothing here is decided by it, but it keeps keys unguessable. */
  seed: number;
  deadline: number;
  phaseMs: number;
  /** Seat order, which is the Bellringer's circle. */
  players: ShortNightPlayer[];
  /** The deal. Never changes. */
  cards: Record<string, RoleId>;
  deck: Deck;
  /** Tonight's steps, in order. */
  steps: RoleId[];
  /** Index into `steps` while it's night. */
  step: number;
  /** By player. Passive ones are drawn at the deal; a picker's when they pick or their step ends. */
  results: Record<string, NightResult>;
  /** What each picker picked. */
  targets: Record<string, string[]>;
  acks: string[];
  ballot: Ballot | null;
  runoff: Ballot | null;
  /** Named leaders tied in the first ballot; the runoff's candidates. */
  tied: string[];
  /** Voted out; null if nobody was. */
  out: string | null;
  winner: Team | null;
  endReason: EndReason | null;
}

export interface NightLogEntry {
  role: RoleId;
  /** Who held the card: every Wolf, or the one holder. */
  holders: string[];
  targets: string[];
  result: NightResult | null;
}

export interface ShortNightPublicState {
  phase: Phase;
  deadline: number;
  phaseMs: number;
  steps: RoleId[];
  step: number;
  deck: Deck;
  players: { id: string; left: boolean }[];
  /** Counts only: who's done would be a tell. */
  acked: number;
  voted: number;
  voters: number;
  /** Runoff candidates. */
  tied: string[];
  /** From `finished` on. */
  cards: Record<string, RoleId> | null;
  night: NightLogEntry[] | null;
  votes: Record<string, string> | null;
  runoffVotes: Record<string, string> | null;
  out: string | null;
  winner: Team | null;
  endReason: EndReason | null;
}

export interface ShortNightPrivateState {
  role: RoleId | null;
  /** Your night, from your step on. */
  result: NightResult | null;
  /** Your step is on and you have a pick to make. */
  picking: { count: 1 | 2; choices: string[] } | null;
  acked: boolean;
  vote: string | null;
  /** Who (or NOBODY) you may vote for right now. */
  choices: string[];
}

export type ShortNightAction =
  | { type: "ack" }
  | { type: "pick"; targets: string[] }
  | { type: "vote"; choice: string }
  | { type: "next" };

export type ShortNightEvent =
  | { type: "night-step"; step: number; waking: RoleId }
  | { type: "day" }
  | { type: "vote-open"; runoff: boolean }
  | { type: "game-over"; winner: Team | null; out: string | null; reason: EndReason };
