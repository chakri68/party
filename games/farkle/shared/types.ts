export const DICE = 6;

export const TARGET_OPTIONS = [5000, 10000] as const;
export const ENTRY_OPTIONS = [0, 350, 500] as const;

/** Three busts in a row cost this much, when the setting's on. */
export const THREE_FARKLE_PENALTY = 500;
/** How long a bust stays on the table before the turn moves on. */
export const BUST_MS = 2000;

export interface FarkleSettings {
  /** Banking to this (or past it) starts the final round. */
  target: number;
  /** Your first bank must be at least this. 0 is off. */
  entry: number;
  /** Three busts in a row cost 500. */
  threeFarkles: boolean;
}

export const DEFAULT_SETTINGS: FarkleSettings = { target: 5000, entry: 500, threeFarkles: false };

export interface FarklePlayerState {
  id: string;
  score: number;
  /** Has banked at least once (cleared the entry threshold). */
  onBoard: boolean;
  /** Busts in a row. Reset by a bank, and by the penalty. */
  farkles: number;
  removed: boolean;
}

/** Dice set aside this turn, grouped by the roll they came from. */
export interface KeptGroup {
  dice: number[];
  points: number;
}

/** "rolled": the current player picks. "bust": a dead roll, on show until the timer. */
export type Step = "rolled" | "bust";

export type EndReason = "target" | "abandoned";

/** How the last finished turn went, for the table to show until the next one does. */
export interface LastTurn {
  playerId: string;
  kind: "banked" | "farkle";
  points: number;
  penalty: number;
}

export interface FinalRound {
  triggerId: string;
  /** Still owed their last turn, in seat order from the trigger. */
  owed: string[];
}

export interface FarkleServerState {
  phase: "playing" | "finished";
  step: Step;
  settings: FarkleSettings;
  players: FarklePlayerState[];
  turnIndex: number;
  /** Counts every roll, so clients can tell a new roll from a redraw. */
  rollNumber: number;
  /** Faces of the current roll, 1–6. */
  roll: number[];
  kept: KeptGroup[];
  turnTotal: number;
  /** The roll came after all six were set aside. */
  hot: boolean;
  bustEndsAt: number;
  finalRound: FinalRound | null;
  lastTurn: LastTurn | null;
  winnerIds: string[];
  endReason: EndReason | null;
  /** Test-only fixed rolls (`options.deck`), used up before the RNG. */
  rigged: number[];
}

export interface FarklePublicState {
  players: { id: string; score: number; onBoard: boolean; farkles: number; removed: boolean }[];
  /** Null once it's over. */
  currentPlayerId: string | null;
  step: Step | "finished";
  rollNumber: number;
  roll: number[];
  kept: KeptGroup[];
  turnTotal: number;
  hot: boolean;
  bustEndsAt: number;
  settings: FarkleSettings;
  finalRound: FinalRound | null;
  lastTurn: LastTurn | null;
  winnerIds: string[];
  endReason: EndReason | null;
}

/** Everything's on the table. */
export type FarklePrivateState = Record<string, never>;

export type FarkleAction =
  | { type: "keep-and-roll"; keep: number[] }
  | { type: "keep-and-bank"; keep: number[] };

export type FarkleEvent =
  /** `fresh`: the first roll of a turn. `hot`: all six again after hot dice. */
  | { type: "rolled"; playerId: string; dice: number[]; fresh: boolean; hot: boolean }
  /** `indices` into the roll they came from. */
  | { type: "kept"; playerId: string; indices: number[]; dice: number[]; points: number; turnTotal: number }
  | { type: "banked"; playerId: string; points: number; score: number }
  | { type: "farkle"; playerId: string; dice: number[]; lost: number; penalty: number; score: number }
  | { type: "final-round"; playerId: string; score: number; target: number }
  | { type: "turn-skipped"; playerId: string }
  | { type: "player-removed"; playerId: string }
  | { type: "game-over"; winnerIds: string[]; reason: EndReason };
