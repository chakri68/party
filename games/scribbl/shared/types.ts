// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export interface ScribblSettings {
  /** Everyone draws once per round. */
  rounds: number;
  drawSeconds: number;
}

export const ROUND_OPTIONS: readonly number[] = [2, 3, 4, 5];
export const DRAW_SECONDS_OPTIONS: readonly number[] = [60, 80, 100, 120];

export const DEFAULT_SETTINGS: ScribblSettings = { rounds: 3, drawSeconds: 80 };

// ---------------------------------------------------------------------------
// Timing
// ---------------------------------------------------------------------------

/** The drawer's pick. Run out and one gets picked for them. */
export const CHOOSE_MS = 15_000;
/** The word on screen between turns. */
export const REVEAL_MS = 5_000;
export const WORD_CHOICES = 3;

// ---------------------------------------------------------------------------
// Drawing (§35). Coordinates are a fixed 800×600 page, whatever the screen.
// ---------------------------------------------------------------------------

export const CANVAS_W = 800;
export const CANVAS_H = 600;

/** Index 0 is the paper: the eraser is just paper-coloured ink. */
export const PALETTE: readonly string[] = [
  "#ffffff", "#c4c4c4", "#4d4d4d", "#111111",
  "#e5322d", "#f28c28", "#f7d31e", "#2fb344",
  "#17a2a2", "#2563eb", "#1e2a78", "#8e44ad",
  "#f06aa6", "#8b5a2b", "#f2c9a0",
];
export const PAPER = 0;
/** Brush diameters, in page units. */
export const SIZES: readonly number[] = [4, 10, 20, 40];

/** Per turn. A drawing that needs more than this is a painting. */
export const MAX_POINTS = 16_000;
export const MAX_STROKES = 1_500;
/** Coordinates per chunk (x,y pairs × 2). Well under the socket's message cap. */
export const MAX_CHUNK = 600;

export interface Stroke {
  id: number;
  color: number;
  size: number;
  /** Flat x,y pairs. */
  points: number[];
}

/**
 * What goes over the stream. `turn` pins each op to its drawing, so a chunk
 * that lands after the turn changed is just ignored.
 */
export type DrawOp =
  | { turn: number; op: "start"; id: number; color: number; size: number; points: number[] }
  | { turn: number; op: "add"; id: number; points: number[] }
  | { turn: number; op: "undo" }
  | { turn: number; op: "clear" };

export interface DrawingSnapshot {
  turn: number;
  strokes: Stroke[];
  /** The id the drawer's next stroke must use. */
  nextId: number;
}

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

/**
 * msg: a guess (or chatter) everyone sees. secret: from someone who's already
 * got it, so only the others who have (and the drawer) see it. guessed: "X got
 * it". close: private, "you're nearly there". The rest are the table talking:
 * drawing ("X is drawing"), word ("the word was…"), missed ("X is away").
 * Names aren't in here: the view joins them in from the room (§7).
 */
export type ChatKind = "msg" | "secret" | "guessed" | "close" | "drawing" | "word" | "missed";

export interface ChatLine {
  id: number;
  kind: ChatKind;
  playerId: string | null;
  text: string;
  /** null: everyone. Otherwise only these players. */
  to: string[] | null;
}

export const MAX_GUESS_LENGTH = 60;
/** Lines the server keeps. Enough to scroll back through a turn. */
export const CHAT_KEEP = 60;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export type TurnPhase = "choosing" | "drawing" | "reveal";

/** time: the clock ran out. all: everyone got it. left: the drawer walked out. */
export type TurnEnd = "time" | "all" | "left";

export interface Guessed {
  playerId: string;
  points: number;
}

export interface TurnState {
  number: number;
  drawerId: string;
  phase: TurnPhase;
  choices: string[];
  word: string | null;
  /** When this phase runs out (server clock), and how long it was. */
  endsAt: number;
  phaseMs: number;
  /** Letter positions handed out as hints, in order. */
  revealed: number[];
  hintsLeft: number;
  guessed: Guessed[];
  drawerPoints: number;
  endedBy: TurnEnd | null;
  strokes: Stroke[];
  nextStrokeId: number;
  pointCount: number;
}

export interface ScribblPlayerState {
  id: string;
  score: number;
  /** Host removed them. */
  removed: boolean;
  /** Socket's down. They don't hold up "everyone got it", and miss their draw. */
  away: boolean;
}

/** "done": all rounds played. "abandoned": fewer than two people left. */
export type EndReason = "done" | "abandoned";

export interface ScribblServerState {
  phase: "playing" | "finished";
  settings: ScribblSettings;
  players: ScribblPlayerState[];
  round: number;
  /** Seat of the current drawer. */
  drawerIndex: number;
  /** Who's had their go this round. */
  drewThisRound: string[];
  turn: TurnState;
  /** Where choices come from, and what's already come up this game. */
  pool: string[];
  used: string[];
  chat: ChatLine[];
  nextChatId: number;
  endReason: EndReason | null;
}

export interface ScribblPublicState {
  round: number;
  rounds: number;
  turn: number;
  drawerId: string;
  phase: TurnPhase | "finished";
  endsAt: number;
  phaseMs: number;
  /**
   * While drawing: one entry per character. Letters are null until revealed;
   * spaces and hyphens show as themselves.
   */
  hint: (string | null)[] | null;
  /** Once the turn's over. */
  word: string | null;
  endedBy: TurnEnd | null;
  players: { id: string; score: number; removed: boolean; guessed: boolean; turnPoints: number | null }[];
  endReason: EndReason | null;
}

export interface ScribblPrivateState {
  /** The drawer, while choosing. */
  choices: string[] | null;
  /** The drawer, and anyone who's got it. */
  word: string | null;
  canDraw: boolean;
  /** The drawer can't type during their own drawing: no free hints. */
  canChat: boolean;
  chat: ChatLine[];
}

export type ScribblAction = { type: "choose"; index: number } | { type: "guess"; text: string };

export type ScribblEvent =
  | { type: "turn-started"; drawerId: string; round: number; turn: number }
  | { type: "drawing"; drawerId: string }
  | { type: "hint" }
  | { type: "guessed"; playerId: string; points: number }
  | { type: "close" }
  | { type: "turn-ended"; word: string; by: TurnEnd }
  | { type: "missed"; playerId: string }
  | { type: "game-over"; reason: EndReason };
