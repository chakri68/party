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

/** Spec §4.3's presets. Custom reads the three toggles below; the others ignore them. */
export type AssistPreset = "beginner" | "classic" | "nightmare" | "custom";

/**
 * Spec §4.3's four assists. `camera` (the setting) says which 3D views are
 * allowed; `camera3d` says whether there's a 3D view at all.
 */
export interface Assists {
  /** The car's dot and heading on the static map. Off: the map never moves. */
  liveMarker: boolean;
  /** Path length actually driven, detours included. */
  tripMeter: boolean;
  /** The printed, hand-scrolled notes. Never auto-advanced. */
  paceNotes: boolean;
  /** The Navigator's 3D view. Off: the static map and nothing else (Godot's map-only mode). */
  camera3d: boolean;
}

export interface BlindRallySettings {
  mode: Mode;
  /** Minutes. */
  timeLimit: number;
  camera: CameraPolicy;
  weather: Weather;
  stageMode: StageMode;
  assists: AssistPreset;
  /** Custom's toggles. Kept when a preset is picked, so going back to Custom finds them. */
  liveMarker: boolean;
  tripMeter: boolean;
  paceNotes: boolean;
  camera3d: boolean;
}

export const MODES: readonly Mode[] = ["race", "practice"];
export const TIME_LIMITS: readonly number[] = [3, 5, 8];
export const CAMERA_POLICIES: readonly CameraPolicy[] = ["free", "topdown", "chase", "bonnet"];
export const CAMERA_MODES: readonly CameraMode[] = ["topdown", "chase", "bonnet"];
export const WEATHERS: readonly Weather[] = ["clear", "patchy", "murky"];
export const STAGE_MODES: readonly StageMode[] = ["solo", "shared"];
export const ASSIST_PRESETS: readonly AssistPreset[] = ["beginner", "classic", "nightmare", "custom"];
export const PRESET_ASSISTS: Record<Exclude<AssistPreset, "custom">, Assists> = {
  beginner: { liveMarker: true, tripMeter: true, paceNotes: true, camera3d: true },
  classic: { liveMarker: false, tripMeter: true, paceNotes: true, camera3d: true },
  nightmare: { liveMarker: false, tripMeter: false, paceNotes: false, camera3d: false },
};

/** What the Navigator actually gets. */
export function effectiveAssists(s: BlindRallySettings): Assists {
  return s.assists === "custom"
    ? { liveMarker: s.liveMarker, tripMeter: s.tripMeter, paceNotes: s.paceNotes, camera3d: s.camera3d }
    : { ...PRESET_ASSISTS[s.assists] };
}
/** Godot's cloud intensity per setting (weather.gd: 0 none, 1 heavy). */
export const CLOUDS: Record<Weather, number> = { clear: 0, patchy: 0.4, murky: 0.8 };

export const DEFAULT_SETTINGS: BlindRallySettings = {
  mode: "race",
  timeLimit: 5,
  camera: "free",
  weather: "patchy",
  stageMode: "solo",
  // Classic Navigation is the featured default (spec §4.3).
  assists: "classic",
  ...PRESET_ASSISTS.classic,
};

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
/** How long the car sits on its recovery anchor before it may move (spec §5's "brief immobilization"). */
export const RESET_HOLD_MS = 1_500;
/** A dropped player has this long to come back before their team is DNF (spec §8.3). */
export const RACE_GRACE_MS = 30_000;

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

/** The last snapshot the server believed. Server time, not Godot's: Δt is ours to measure. */
export interface AcceptedSnapshot {
  at: number;
  tick: number;
  position: [number, number, number];
  speed: number;
  /** Godot's trip meter, metres actually driven. */
  distance: number;
}

/** One team's race. */
export interface RunState {
  status: RunStatus;
  /** Highest Driver input seq accepted; anything at or below it is stale. */
  lastSeq: number;
  resets: number;
  penaltyMs: number;
  /** Checkpoints passed, in order, as the server accepted them: 0..n. */
  cp: number;
  snap: AcceptedSnapshot | null;
  /** When `snap` last went to storage. The stream path writes at most once a second. */
  savedAt: number;
  /**
   * A server-authorised move: a reset, or a Navigator back from a drop with
   * a fresh Godot. Until a snapshot lands near the recovery anchor (or this
   * goes stale), that one jump is allowed.
   */
  movedAt: number | null;
  /** Driver input is dropped, and Godot holds the car, until then. */
  holdUntil: number;
  /** Server time the finish was accepted. */
  finishedAt: number | null;
  /** Clock stopped for a dropped teammate, total so far (spec §8.3). */
  pausedMs: number;
  /** Since when it's stopped now, or null when everyone's here. */
  pausedSince: number | null;
  /** Who's dropped mid-race. Non-empty means the team is paused. */
  away: Role[];
  /** When the grace for `away` runs out. */
  graceEndsAt: number | null;
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
  /** Clock stopped for drop-outs: shown as an adjustment. Running total, plus `pausedSince` if it's stopped now. */
  pausedMs: number;
  pausedSince: number | null;
  /** Who's dropped out, and until when they can come back. */
  away: Role[];
  graceEndsAt: number | null;
  /** Effective time (elapsed - pause + penalties), once finished. */
  timeMs: number | null;
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
  /** The effective set, server-locked. Godot reads liveMarker; the TS chrome does the other two. */
  assists: Assists;
}

/** The Navigator's view of their own run, beside the session (which only changes between races). */
export interface NavigatorRun {
  /** Checkpoints the server has accepted. A fresh Godot restores to this one's anchor. */
  checkpoints: number;
  checkpointCount: number;
  /** The car's held on its anchor until then (server time). */
  holdUntil: number;
}

export type BlindRallyPrivateState =
  | { role: null }
  | { role: "driver"; teamId: number; lastSeq: number }
  | { role: "navigator"; teamId: number; session: NavigatorSession; run: NavigatorRun };

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
  /**
   * Driver: back to the last checkpoint, plus RESET_PENALTY_MS. The
   * Navigator's Godot may ask too, with `reason: "fell"`, when the car's
   * dropped out of the world: same penalty, same anchor, server's say-so.
   */
  | { type: "race.reset"; reason?: "fell" }
  /**
   * Navigator's Godot: through a gate, or over the line. A game-action, not a
   * stream: it changes standings, has to survive an eviction, and the
   * Navigator wants to hear a "no".
   */
  | { type: "race.event"; kind: "cp"; checkpointId: number }
  | { type: "race.event"; kind: "finish" };

export type BlindRallyEvent =
  | { type: "countdown"; startsAt: number }
  | { type: "reset"; teamId: number; penaltyMs: number }
  /**
   * To that team's Navigator only: put the car on the anchor after
   * `checkpoint` and hold it for `holdMs`. Private because it names a
   * checkpoint, which a Driver mustn't learn.
   */
  | { type: "recover"; teamId: number; checkpoint: number; holdMs: number }
  /** To that team's Navigator: the Driver's gone, stop the car. */
  | { type: "park"; teamId: number }
  | { type: "team-finished"; teamId: number; timeMs: number }
  | { type: "team-out"; teamId: number; reason: "grace" | "left" }
  | { type: "race-over"; reason: "time" | "host" | "done" };

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
