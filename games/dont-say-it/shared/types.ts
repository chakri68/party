// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export interface DontSayItSettings {
  turnSeconds: number;
  turnsPerTeam: number;
}

export const TURN_SECONDS_OPTIONS: readonly number[] = [45, 60, 90];
export const TURNS_OPTIONS: readonly number[] = [2, 3, 5];

export const DEFAULT_SETTINGS: DontSayItSettings = { turnSeconds: 60, turnsPerTeam: 3 };

// ---------------------------------------------------------------------------
// Timing and limits
// ---------------------------------------------------------------------------

/** Each half of a dispute: the describer's answer, then the captain's. */
export const DISPUTE_MS = 20_000;
export const RESULT_MS = 8_000;
export const MIN_PLAYERS = 4;
export const MIN_TEAM = 2;
export const FORBIDDEN_PER_CARD = 5;

// ---------------------------------------------------------------------------
// Teams
// ---------------------------------------------------------------------------

export type TeamId = 0 | 1;
export const TEAM_NAMES: readonly [string, string] = ["Amber", "Teal"];
export const other = (t: TeamId): TeamId => (t === 0 ? 1 : 0);

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export type Phase = "teams" | "ready" | "turn" | "buzzed" | "appeal" | "turn-result" | "finished";

/** What happened to a card. "time": in hand when the clock ran out; "left": the describer left. */
export type Outcome = "got" | "skip" | "oops" | "fair" | "upheld" | "time" | "left";

export const OUTCOME_POINTS: Record<Outcome, number> = {
  got: 1,
  skip: 0,
  oops: -1,
  fair: -1,
  upheld: -1,
  time: 0,
  left: 0,
};

export interface Card {
  id: string;
  target: string;
  forbidden: string[];
}

export interface DontSayItPlayerState {
  id: string;
  /** Seat order at the start: the captain is the first of a team by it. */
  seat: number;
  team: TeamId;
  removed: boolean;
  away: boolean;
  /** Turns described this match. */
  described: number;
}

export interface ResolvedCard {
  target: string;
  outcome: Outcome;
}

export interface TurnState {
  team: TeamId;
  describerId: string;
  /** Index into the match's card order; -1 before the clock starts. */
  card: number;
  cards: ResolvedCard[];
  /** What the team's score actually moved by, after the floor. */
  net: number;
  buzzerId: string | null;
  /** Who's ruling on a contested buzz. */
  captainId: string | null;
  /** The turn clock while it's frozen. */
  turnLeft: number;
}

/** "done": all turns played. "abandoned": a team fell below two. */
export type EndReason = "done" | "abandoned";

export interface DontSayItServerState {
  phase: Phase;
  settings: DontSayItSettings;
  players: DontSayItPlayerState[];
  scores: [number, number];
  firstTeam: TeamId;
  /** Turns started, sudden death included. */
  turnIndex: number;
  suddenDeath: boolean;
  deadline: number;
  phaseMs: number;
  turn: TurnState | null;
  /** The match's card order, as indexes into the deck. */
  order: number[];
  /** Next unused position in `order`. */
  pos: number;
  /** Card ids the last match used, carried on so a rematch deals fresh ones first. */
  usedBefore: string[];
  /** The order ran out and started over. */
  reshuffled: boolean;
  /** Test-only cards, as "target: a, b, c, d, e". Null: the real deck. */
  deck: string[] | null;
  endReason: EndReason | null;
}

export interface PublicTeam {
  id: TeamId;
  name: string;
  members: string[];
  score: number;
  captainId: string | null;
}

export interface DontSayItPublicState {
  phase: Phase;
  teams: [PublicTeam, PublicTeam];
  players: { id: string; team: TeamId; removed: boolean }[];
  /** 1-based; 0 in the teams phase. */
  turnNumber: number;
  totalTurns: number;
  suddenDeath: boolean;
  activeTeam: TeamId | null;
  describerId: string | null;
  deadline: number;
  phaseMs: number;
  turnMs: number;
  /** The turn's clock while it's frozen; null when it's running or not started. */
  turnLeft: number | null;
  buzzerId: string | null;
  captainId: string | null;
  cards: ResolvedCard[];
  net: number;
  reshuffled: boolean;
  endReason: EndReason | null;
}

export type Role = "describer" | "guesser" | "watcher";

export interface DontSayItPrivateState {
  team: TeamId | null;
  role: Role | null;
  /** The describer and the other team only, while a card's in play. */
  card: { target: string; forbidden: string[] } | null;
  canBuzz: boolean;
  /** It's your call in a dispute. */
  deciding: boolean;
}

export type DontSayItAction =
  | { type: "switch" }
  | { type: "shuffle" }
  | { type: "start" }
  | { type: "go" }
  | { type: "got" }
  | { type: "skip" }
  | { type: "oops" }
  | { type: "buzz" }
  | { type: "fair" }
  | { type: "nope" }
  | { type: "uphold" }
  | { type: "drop" }
  | { type: "next" };

export const ACTION_TYPES: readonly DontSayItAction["type"][] = [
  "switch",
  "shuffle",
  "start",
  "go",
  "got",
  "skip",
  "oops",
  "buzz",
  "fair",
  "nope",
  "uphold",
  "drop",
  "next",
];

export type DontSayItEvent =
  | { type: "teams-changed" }
  | { type: "turn-ready"; team: TeamId; describerId: string; suddenDeath: boolean }
  | { type: "turn-started"; team: TeamId }
  | { type: "card"; target: string; outcome: Outcome; team: TeamId }
  | { type: "buzzed"; by: string }
  | { type: "appealed"; captainId: string }
  | { type: "dropped" }
  | { type: "turn-over"; team: TeamId; net: number; reason: "time" | "left" | "skipped" }
  | { type: "sudden-death" }
  | { type: "reshuffled" }
  | { type: "skipped"; playerId: string }
  | { type: "game-over"; reason: EndReason };

/** What a finished match hands the next one. */
export interface DontSayItCarry {
  teams: [string[], string[]];
  used: string[];
}
