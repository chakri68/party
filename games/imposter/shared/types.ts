import type { Ballot } from "@games/game-core";

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export interface ImposterSettings {
  rounds: number;
  discussSeconds: number;
}

export const ROUND_OPTIONS: readonly number[] = [3, 5, 7];
export const DISCUSS_OPTIONS: readonly number[] = [30, 60, 90];

export const DEFAULT_SETTINGS: ImposterSettings = { rounds: 5, discussSeconds: 60 };

// ---------------------------------------------------------------------------
// Timing and limits
// ---------------------------------------------------------------------------

export const REVEAL_MS = 20_000;
export const CLUES_MS = 60_000;
export const VOTE_MS = 30_000;
export const ROLE_MS = 5_000;
export const GUESS_MS = 20_000;
export const RESULT_MS = 10_000;

export const MAX_CLUE = 40;
export const MAX_GUESS = 40;
export const MIN_PLAYERS = 3;
/** Points for a round's winning side: each innocent, or the Imposter. */
export const POINTS = 2;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export type RoundPhase = "reveal" | "clues" | "discuss" | "vote" | "runoff" | "reveal-role" | "guess" | "round-result";
export type Phase = RoundPhase | "finished";

/** Who scored the round. */
export type Side = "imposter" | "innocents";

export type Role = "imposter" | "innocent";

export interface ImposterPlayerState {
  id: string;
  score: number;
  /** Host removed them, or they left. */
  removed: boolean;
  /** Socket's down. They don't hold a phase up. */
  away: boolean;
  imposterCount: number;
}

export interface RoundState {
  phase: RoundPhase;
  /** When this phase runs out (server clock), and how long it was. */
  deadline: number;
  phaseMs: number;
  imposterId: string;
  category: string;
  word: string;
  acks: string[];
  /** By player. Null: they never sent one (time, or skipped). Absent: not yet. */
  clues: Record<string, string | null>;
  /** Display order for the clues, shuffled when the round starts. */
  order: string[];
  ballot: Ballot | null;
  candidates: string[];
  /** Who tied in the first vote; empty unless there was a runoff. */
  tied: string[];
  accusedId: string | null;
  guess: string | null;
  guessRight: boolean;
  guessClose: boolean;
  winner: Side | null;
}

/** "done": all rounds played. "abandoned": fewer than three people left. */
export type EndReason = "done" | "abandoned";

export interface ImposterServerState {
  phase: "playing" | "finished";
  settings: ImposterSettings;
  /** For tally's tie-break, so it's fixed per game but not guessable. */
  seed: number;
  players: ImposterPlayerState[];
  /** 1-based. A dropped round keeps its number. */
  roundNumber: number;
  round: RoundState;
  /** Words already played, as "category|word". */
  used: string[];
  /** Test-only word list, as "category|word". Null: the real pack. */
  deck: string[] | null;
  endReason: EndReason | null;
}

export interface PublicClue {
  playerId: string;
  text: string | null;
}

export interface ImposterPublicState {
  phase: Phase;
  round: number;
  rounds: number;
  deadline: number;
  phaseMs: number;
  category: string;
  players: { id: string; score: number; removed: boolean; done: boolean }[];
  /** After the clue phase, in display order. */
  clues: PublicClue[] | null;
  /** While voting. */
  candidates: string[];
  tied: string[];
  /** From reveal-role on. */
  accusedId: string | null;
  accusedRole: Role | null;
  votes: Record<string, string> | null;
  counts: Record<string, number> | null;
  /** From round-result on. */
  imposterId: string | null;
  word: string | null;
  guess: string | null;
  guessRight: boolean;
  guessClose: boolean;
  winner: Side | null;
  endReason: EndReason | null;
}

export interface ImposterPrivateState {
  role: Role | null;
  /** Innocents only, until it's public anyway. */
  word: string | null;
  acked: boolean;
  clue: string | null;
  sentClue: boolean;
  vote: string | null;
  /** Who you may vote for right now. */
  choices: string[];
  /** It's your guess. */
  guessing: boolean;
}

export type ImposterAction =
  | { type: "ack" }
  | { type: "clue"; text: string }
  | { type: "vote"; playerId: string }
  | { type: "guess"; text: string }
  | { type: "next" };

export type ImposterEvent =
  | { type: "round-started"; round: number; restarted: boolean }
  | { type: "clues-in" }
  | { type: "vote-open"; runoff: boolean }
  | { type: "accused"; playerId: string; role: Role }
  | { type: "nobody-accused" }
  | { type: "guessed"; right: boolean }
  | { type: "round-over"; winner: Side; imposterId: string; word: string }
  | { type: "round-dropped" }
  | { type: "skipped"; playerId: string }
  | { type: "game-over"; reason: EndReason };
