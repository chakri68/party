import type { Ballot } from "@games/game-core";
import type { Deck, DeckSettings } from "@games/hidden-roles";
import type { RoleId, Team } from "./roles.ts";

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/** Flat, per the kit: `preset`, `n:<role>` counts, then ours. */
export interface NightfallSettings extends DeckSettings {
  discussMinutes: number;
  nightSeconds: number;
}

export const DISCUSS_OPTIONS: readonly number[] = [1, 2, 3, 4, 5];
export const NIGHT_OPTIONS: readonly number[] = [20, 30, 45];

export const DEFAULT_SETTINGS: NightfallSettings = { preset: "standard", discussMinutes: 2, nightSeconds: 30 };

// ---------------------------------------------------------------------------
// Timing
// ---------------------------------------------------------------------------

export const REVEAL_MS = 30_000;
export const VOTE_MS = 30_000;
export const RUNOFF_MS = 20_000;

/** The day vote's "nobody": counts for no one. Never a player id: those are opaque tokens. */
export const SKIP = "skip";

// ---------------------------------------------------------------------------
// Logs. Dawns and days go public as they happen; nights only at the end.
// ---------------------------------------------------------------------------

export interface NightRecord {
  night: number;
  /** Wolf -> who they picked. Abstainers are missing. */
  wolfVotes: Record<string, string>;
  /** The pack's choice, or null: nobody picked. */
  target: string | null;
  /** Who the Keeper sheltered, or null. */
  sheltered: string | null;
  /** Who the Watcher read, and what they learned. */
  read: string | null;
  readWolf: boolean | null;
  /** Taken in the night, or null. */
  died: string | null;
}

/** What the morning says. */
export interface Dawn {
  night: number;
  died: string | null;
  team: Team | null;
}

export interface DayRecord {
  day: number;
  /** Voter -> choice (a player or SKIP). Missing: didn't vote. */
  votes: Record<string, string>;
  /** Runoff candidates; empty if there was none. */
  tied: string[];
  runoffVotes: Record<string, string> | null;
  /** Voted out, or null. */
  out: string | null;
  team: Team | null;
}

/** One of the Watcher's readings, theirs from the dawn after. */
export interface Reading {
  night: number;
  target: string;
  wolf: boolean;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export type Phase = "reveal" | "night" | "day" | "vote" | "runoff" | "finished";

/** "done": a side won. "abandoned": a side emptied by leavers, no winner. */
export type EndReason = "done" | "abandoned";

export interface NightfallPlayer {
  id: string;
  /** Taken in the night or voted out. */
  dead: boolean;
  /** Gone from the room. Can't act from now on. */
  left: boolean;
  /** Left while alive, settled at a phase boundary: off both sides' counts. */
  abandoned: boolean;
  /** Socket's down. Holds nothing up. */
  away: boolean;
}

export interface NightfallServerState {
  phase: Phase;
  settings: NightfallSettings;
  /** For the Wolves' tie-break. */
  seed: number;
  deadline: number;
  phaseMs: number;
  /** Nights so far; the day after night n is day n. */
  round: number;
  /** Seat order. */
  players: NightfallPlayer[];
  /** The deal. Never changes. */
  cards: Record<string, RoleId>;
  deck: Deck;
  /** Tonight's Wolf votes. */
  pack: Ballot | null;
  /** Tonight's Keeper and Watcher picks, by player. */
  picks: Record<string, string>;
  /** Last night's shelter, which tonight's can't repeat. */
  lastShelter: string | null;
  readings: Reading[];
  acks: string[];
  ballot: Ballot | null;
  runoff: Ballot | null;
  tied: string[];
  nights: NightRecord[];
  days: DayRecord[];
  winner: Team | null;
  endReason: EndReason | null;
}

export interface NightfallPublicState {
  phase: Phase;
  deadline: number;
  phaseMs: number;
  round: number;
  deck: Deck;
  /** `team`: a dead player's, announced when they died. */
  players: { id: string; dead: boolean; left: boolean; abandoned: boolean; team: Team | null }[];
  /** Counts only: who's done would be a tell. */
  acked: number;
  voted: number;
  voters: number;
  /** Runoff candidates. */
  tied: string[];
  dawns: Dawn[];
  days: DayRecord[];
  /** From `finished` on. */
  cards: Record<string, RoleId> | null;
  nights: NightRecord[] | null;
  winner: Team | null;
  endReason: EndReason | null;
}

export interface NightfallPrivateState {
  role: RoleId | null;
  /** Every Wolf, seat order. Wolves only. */
  pack: string[] | null;
  /** The pack's picks tonight. Wolves only. */
  packPicks: Record<string, string> | null;
  /** Your pick tonight, as the server has it (Wolf, Watcher, Keeper). */
  pick: string | null;
  /** True for every living player at night, whatever the card. */
  picking: boolean;
  /** Keeper only. */
  lastShelter: string | null;
  /** Watcher only. */
  readings: Reading[] | null;
  acked: boolean;
  vote: string | null;
  /** Who (or SKIP) you may vote for right now. */
  choices: string[];
}

export type NightfallAction =
  | { type: "ack" }
  | { type: "pick"; target: string }
  | { type: "vote"; choice: string }
  | { type: "next" };

export type NightfallEvent =
  | { type: "night"; round: number }
  | { type: "dawn"; died: string | null; team: Team | null }
  | { type: "vote-open"; runoff: boolean }
  | { type: "verdict"; out: string | null; team: Team | null }
  | { type: "game-over"; winner: Team | null; reason: EndReason };
