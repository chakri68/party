import type { Ballot } from "@games/game-core";

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/** "clues": a word, typed clues. "spoken": a place, the table talks. */
export type Mode = "clues" | "spoken";

export interface ImposterSettings {
  rounds: number;
  /** Clues mode's talking time. */
  discussSeconds: number;
  /** Absent: clues. Optional so settings from before spoken mode keep their shape. */
  mode?: Mode;
  /** Spoken mode's talking time. Absent: DEFAULT_TALK. */
  talkMinutes?: number;
}

export const ROUND_OPTIONS: readonly number[] = [3, 5, 7];
export const DISCUSS_OPTIONS: readonly number[] = [30, 60, 90];
export const MODE_OPTIONS: readonly Mode[] = ["clues", "spoken"];
export const TALK_OPTIONS: readonly number[] = [4, 6, 8];
export const DEFAULT_TALK = 6;

export const DEFAULT_SETTINGS: ImposterSettings = { rounds: 5, discussSeconds: 60 };

export const modeOf = (s: ImposterSettings): Mode => s.mode ?? "clues";
export const talkMinutesOf = (s: ImposterSettings): number => s.talkMinutes ?? DEFAULT_TALK;

// ---------------------------------------------------------------------------
// Timing and limits
// ---------------------------------------------------------------------------

export const REVEAL_MS = 20_000;
export const CLUES_MS = 60_000;
export const VOTE_MS = 30_000;
export const ROLE_MS = 5_000;
export const GUESS_MS = 20_000;
/** Picking from the place list takes longer than typing a word you've been chewing on. */
export const PLACE_GUESS_MS = 30_000;
export const RESULT_MS = 10_000;

export const MAX_CLUE = 40;
export const MAX_GUESS = 40;
export const MIN_PLAYERS = 3;
/** Points for a round's winning side: each innocent, or the Imposter. */
export const POINTS = 2;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export type RoundPhase = "reveal" | "clues" | "discuss" | "talk" | "vote" | "runoff" | "reveal-role" | "guess" | "round-result";
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
  /** Empty in spoken mode. */
  category: string;
  /** The word, or in spoken mode the place's display name. */
  word: string;
  /** Spoken mode's place id; empty in clues mode. */
  placeId: string;
  /** Spoken mode: who's suggested to ask first. Advisory. */
  firstAsker: string | null;
  /** The Imposter stopped the talk to guess. */
  early: boolean;
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
  mode: Mode;
  category: string;
  /** Spoken mode, from talk on. */
  firstAsker: string | null;
  /** The guess phase came from the Imposter calling it, not a catch. */
  early: boolean;
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
  | { type: "call" }
  | { type: "guess-place"; placeId: string }
  | { type: "next" };

export type ImposterEvent =
  | { type: "round-started"; round: number; restarted: boolean }
  | { type: "clues-in" }
  | { type: "vote-open"; runoff: boolean }
  | { type: "accused"; playerId: string; role: Role }
  | { type: "nobody-accused" }
  | { type: "early-guess" }
  | { type: "guessed"; right: boolean }
  | { type: "round-over"; winner: Side; imposterId: string; word: string }
  | { type: "round-dropped" }
  | { type: "skipped"; playerId: string }
  | { type: "game-over"; reason: EndReason };
