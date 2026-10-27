import type { Ballot } from "@games/game-core";

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export type PresetId = "beginner" | "standard" | "fast";
/** Relative to the usual count, so it keeps meaning as the table grows. */
export type MoleShift = "fewer" | "usual" | "more";

export interface HeistSettings {
  preset: PresetId;
  moles: MoleShift;
}

export const DEFAULT_SETTINGS: HeistSettings = { preset: "beginner", moles: "usual" };

export interface Timers {
  leaderMs: number;
  voteMs: number;
  cardMs: number;
}

export const TIMERS: Record<PresetId, Timers> = {
  beginner: { leaderMs: 60_000, voteMs: 30_000, cardMs: 20_000 },
  standard: { leaderMs: 45_000, voteMs: 20_000, cardMs: 20_000 },
  fast: { leaderMs: 30_000, voteMs: 15_000, cardMs: 10_000 },
};

export const REVEAL_MS = 30_000;

// ---------------------------------------------------------------------------
// The game's words
// ---------------------------------------------------------------------------

export type Alignment = "crew" | "mole";
export type Vote = "go" | "no-go";
export type Card = "clean" | "sabotage";

export type Phase = "reveal" | "propose" | "vote" | "job" | "finished";

/** "done": a side got three jobs. The rest end it with no winner. */
export type EndReason = "done" | "too-few" | "no-moles" | "no-crew";

// ---------------------------------------------------------------------------
// History, public as it's written
// ---------------------------------------------------------------------------

export interface ProposalRecord {
  job: number;
  leader: string;
  /** Empty when the leader never proposed. */
  crew: string[];
  /** Everyone who could vote, missed votes as No-go. Empty when the leader never proposed. */
  votes: Record<string, Vote>;
  /** Voters who never voted; their No-go was automatic. */
  missed: string[];
  passed: boolean;
  /** The leader ran out the clock. */
  timedOut: boolean;
  /** Passed, then someone on the crew left before the job was played. */
  voided: boolean;
}

export interface JobRecord {
  job: number;
  /** Who went in; empty for a job lost to heat. */
  crew: string[];
  /** How many Sabotage cards went in. Never whose. */
  sabotaged: number;
  /** How many cards the clock played as Clean. Never whose. */
  auto: number;
  winner: Alignment;
  /** Lost to three failed proposals, not played. */
  heat: boolean;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface HeistPlayer {
  id: string;
  left: boolean;
  away: boolean;
}

export interface HeistServerState {
  phase: Phase;
  settings: HeistSettings;
  deadline: number;
  phaseMs: number;
  /** Seat order. */
  players: HeistPlayer[];
  /** The deal. Never changes. */
  alignment: Record<string, Alignment>;
  /** Sabotage cards each mole has left. */
  budget: Record<string, number>;
  /** Index into `players`: who leads now. */
  leader: number;
  /** Who led the proposal on the table; a void hands the lead back to them. */
  proposer: number;
  /** 0..4. */
  job: number;
  heat: number;
  score: Record<Alignment, number>;
  /** The proposal on the table (vote) or on the job (job). */
  crew: string[];
  ballot: Ballot<Vote> | null;
  /** This job's cards, by crew member. Never leaves the server. */
  cards: Record<string, Card>;
  proposals: ProposalRecord[];
  jobs: JobRecord[];
  acks: string[];
  winner: Alignment | null;
  endReason: EndReason | null;
}

export interface HeistPublicState {
  phase: Phase;
  deadline: number;
  phaseMs: number;
  players: { id: string; left: boolean }[];
  leader: string;
  job: number;
  /** All five, for the head count still in. */
  sizes: number[];
  heat: number;
  score: Record<Alignment, number>;
  moleCount: number;
  crew: string[];
  acked: number;
  voted: number;
  voters: number;
  proposals: ProposalRecord[];
  jobs: JobRecord[];
  /** From `finished` on. */
  alignments: Record<string, Alignment> | null;
  winner: Alignment | null;
  endReason: EndReason | null;
}

export interface HeistPrivateState {
  alignment: Alignment | null;
  /** The moles, in seat order. Moles only. */
  moles: string[] | null;
  /** Sabotage cards left. Moles only. */
  budget: number | null;
  acked: boolean;
  /** Yours, in the open vote. */
  vote: Vote | null;
  canVote: boolean;
  onJob: boolean;
  /** The card you've put in on this job. */
  card: Card | null;
}

export type HeistAction =
  | { type: "ack" }
  | { type: "propose"; crew: string[] }
  | { type: "vote"; vote: Vote }
  | { type: "card"; card: Card };

export type HeistEvent =
  | { type: "propose"; leader: string; job: number }
  | { type: "proposed"; crew: string[] }
  | { type: "vote-closed"; passed: boolean; heat: number }
  | { type: "job-done"; job: number; winner: Alignment; sabotaged: number; heat: boolean }
  | { type: "voided" }
  | { type: "game-over"; winner: Alignment | null; reason: EndReason };
