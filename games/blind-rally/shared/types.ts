// Everything here is bundled eagerly for every player, Drivers included (map
// §3.5). So: rules, ids and timings only. No coordinates, no checkpoints, no
// notes; those live in data/tracks.json, which only server/ and the lazily
// loaded navigator chunk may read.

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export type Mode = "race" | "practice";
/** What the Navigator's 3D view may be. "free" lets them cycle all three. */
export type CameraPolicy = "free" | "topdown" | "chase" | "bonnet";
export type CameraMode = "topdown" | "chase" | "bonnet";
export type Weather = "clear" | "patchy" | "murky";
/** Spec §7.4. solo: every car on its own copy of the course. shared: one course, rivals as ghosts. */
export type StageMode = "solo" | "shared";

export interface BlindRallySettings {
  mode: Mode;
  /** Minutes. */
  timeLimit: number;
  camera: CameraPolicy;
  weather: Weather;
  stageMode: StageMode;
}

export const MODES: readonly Mode[] = ["race", "practice"];
export const TIME_LIMITS: readonly number[] = [3, 5, 8];
export const CAMERA_POLICIES: readonly CameraPolicy[] = ["free", "topdown", "chase", "bonnet"];
export const CAMERA_MODES: readonly CameraMode[] = ["topdown", "chase", "bonnet"];
export const WEATHERS: readonly Weather[] = ["clear", "patchy", "murky"];
export const STAGE_MODES: readonly StageMode[] = ["solo", "shared"];
/** Godot's cloud intensity per setting (weather.gd: 0 none, 1 heavy). */
export const CLOUDS: Record<Weather, number> = { clear: 0, patchy: 0.4, murky: 0.8 };

export const DEFAULT_SETTINGS: BlindRallySettings = { mode: "race", timeLimit: 5, camera: "free", weather: "patchy", stageMode: "solo" };

// ---------------------------------------------------------------------------
// Team colours (spec §2, §7.4)
// ---------------------------------------------------------------------------

export type TeamColorKey = "orange" | "sky" | "green" | "purple";

export interface TeamColor {
  key: TeamColorKey;
  name: string;
  hex: string;
  /** Never colour alone (§10): every team also has a shape and its number. */
  shape: "circle" | "square" | "triangle" | "diamond";
}

/** Okabe–Ito picks: they stay apart under the common colour blindnesses, and on black. */
export const TEAM_COLORS: readonly TeamColor[] = [
  { key: "orange", name: "Orange", hex: "#e69f00", shape: "circle" },
  { key: "sky", name: "Sky", hex: "#56b4e9", shape: "square" },
  { key: "green", name: "Green", hex: "#009e73", shape: "triangle" },
  { key: "purple", name: "Purple", hex: "#cc79a7", shape: "diamond" },
];

export const teamColor = (key: TeamColorKey): TeamColor => TEAM_COLORS.find((c) => c.key === key) ?? TEAM_COLORS[0]!;

// ---------------------------------------------------------------------------
// Timing and limits
// ---------------------------------------------------------------------------

/** Pairs: one Driver, one Navigator. Four of them fill the 8 car seats. */
export const MAX_TEAMS = 4;
/** 3-2-1 before the clock starts (spec §3.8). */
export const COUNTDOWN_MS = 3_000;
/** What a reset costs (spec §5). */
export const RESET_PENALTY_MS = 5_000;

// ---------------------------------------------------------------------------
// State (server only; never sent as-is)
// ---------------------------------------------------------------------------

export type Role = "driver" | "navigator";

/**
 * teams: pick seats and ready up (the spec's READY is the "everyone's ready"
 * guard, not a phase of its own). countdown → racing flip on a timer, but
 * anything time-critical compares against `startsAt`, never the phase alone.
 */
export type Phase = "teams" | "countdown" | "racing" | "finished";

export interface PlayerState {
  id: string;
  ready: boolean;
}

export type RunStatus = "running" | "finished" | "dnf";

/** One team's race. Step 8 onward adds the last accepted snapshot and checkpoints here. */
export interface RunState {
  status: RunStatus;
  /** Highest Driver input seq accepted; anything at or below it is stale. */
  lastSeq: number;
  resets: number;
  penaltyMs: number;
}

export interface TeamState {
  id: number;
  driverId: string | null;
  navigatorId: string | null;
  /** Who votes for the team (M3). Navigator unless they swap it. */
  captain: Role;
  /** Picked when the team forms, then kept: across rematches too. */
  color: TeamColorKey;
  run: RunState | null;
}

export interface BlindRallyState {
  phase: Phase;
  settings: BlindRallySettings;
  trackId: string;
  /** The room's sky: every team gets the same weather (Fair Race). */
  seed: number;
  players: PlayerState[];
  teams: TeamState[];
  startsAt: number | null;
  endsAt: number | null;
  endedAt: number | null;
}

/** What survives a rematch (`carryOver` → `match.carry`). */
export interface BlindRallyCarry {
  teams: { driverId: string | null; navigatorId: string | null; captain: Role; color: TeamColorKey }[];
}

// ---------------------------------------------------------------------------
// Projections (map §2: public / driver / navigator DTOs)
// ---------------------------------------------------------------------------

export interface PublicTeam {
  id: number;
  driverId: string | null;
  navigatorId: string | null;
  captainId: string | null;
  color: TeamColorKey;
  status: RunStatus | null;
  resets: number;
  penaltyMs: number;
}

export interface BlindRallyPublicState {
  phase: Phase;
  mode: Mode;
  stageMode: StageMode;
  trackId: string;
  timeLimitMs: number;
  teams: PublicTeam[];
  /** Everyone in the game, seated in a car or not. */
  players: { id: string; ready: boolean }[];
  startsAt: number | null;
  endsAt: number | null;
  endedAt: number | null;
  /** Why the host can't start yet, or null when they can. */
  startBlocker: string | null;
}

/** What Godot's initSession gets, besides the seat token. */
export interface NavigatorSession {
  trackId: string;
  seed: number;
  clouds: number;
  camera: CameraMode;
  allowedCameras: CameraMode[];
  teamNumber: number;
  teamColor: string;
  teamShape: TeamColor["shape"];
  /** Shared stage: other teams' cars arrive as `ghost` relays to draw. */
  ghosts: boolean;
}

export type BlindRallyPrivateState =
  | { role: null }
  | { role: "driver"; teamId: number; lastSeq: number }
  | { role: "navigator"; teamId: number; session: NavigatorSession };

// ---------------------------------------------------------------------------
// Actions (game-action payloads; spec §8.4 names as discriminants)
// ---------------------------------------------------------------------------

export type BlindRallyAction =
  | { type: "team.join"; teamId: number; role: Role }
  | { type: "team.leave" }
  /** Your role in your own team; if your teammate has it, you swap. */
  | { type: "role.pick"; role: Role }
  /** Host: put someone in a seat (bumping whoever's there), or `teamId: null` to unseat them. */
  | { type: "team.assign"; playerId: string; teamId: number | null; role?: Role }
  | { type: "player.ready"; ready: boolean }
  | { type: "race.start" }
  /** Host: stop the race now and go to results (teams carry over). */
  | { type: "race.end" }
  /** Driver: back to the last checkpoint, plus RESET_PENALTY_MS. */
  | { type: "race.reset" };

export type BlindRallyEvent =
  | { type: "countdown"; startsAt: number }
  | { type: "reset"; teamId: number; penaltyMs: number }
  | { type: "race-over"; reason: "time" | "host" };

// ---------------------------------------------------------------------------
// Streams (best-effort; see shared/wire.ts for parsing)
// ---------------------------------------------------------------------------

/** Driver → server → their Navigator. steer -1..1 (right +), throttle/brake 0..1. */
export interface ControlInput {
  t: "in";
  seq: number;
  steer: number;
  throttle: number;
  brake: number;
}

/** Navigator → server, ~10 Hz: Godot's snapshot as emitted, tagged. Never relayed as-is. */
export interface SnapshotStream {
  t: "snap";
  speed: number;
  [k: string]: unknown;
}

/** Navigator → server: a Godot physics event (impact, cp, finish). */
export interface PhysicsEventStream {
  t: "ev";
  kind: string;
  strength?: number;
}

/** Server → Driver: all a Driver ever learns about the car. m/s, negative in reverse. */
export interface DashRelay {
  t: "dash";
  speed: number;
}

/**
 * Server → the other teams' Navigators, shared stage only (§7.4): where a
 * rival car is, for a non-colliding ghost. Never sent to a Driver.
 */
export interface GhostRelay {
  t: "ghost";
  teamId: number;
  color: string;
  tick: number;
  position: [number, number, number];
  heading: number;
  speed: number;
}

/** Server → Driver: the car hit something. 0..1-ish. */
export interface HitRelay {
  t: "hit";
  strength: number;
}
