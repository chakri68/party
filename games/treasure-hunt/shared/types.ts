import type { MinorPoint } from "./minor.ts";
import type { TeamColorKey } from "./teams.ts";
import type { Trail } from "./trails.ts";
import { RACE_TARGET_DEFAULT, RACE_TARGETS, TIMED_MINUTES, type RingSide } from "./world.ts";

export type TemplateId = "lighthouse" | "shipwreck" | "stone-circle" | "radio-tower" | "camp" | "plane";

/** One placed set piece (layer 3). Built in Godot from its template and params. */
export interface SetPiece {
  /** "p0", "p1", … in placement order. */
  id: string;
  template: TemplateId;
  /** Rounded to 0.1 m. */
  x: number;
  z: number;
  /** Radians, Godot style: yaw 0 faces −Z. */
  yaw: number;
  /** The flat pad's height in metres: macroHeight at (x, z), rounded to 0.1. */
  padY: number;
  /** The pad's radius in metres. */
  padR: number;
  /** Index into TEMPLATES[template].labels. Unique per template on a map. */
  variant: number;
  /** Rolled by the template. Booleans are 0/1. */
  params: Record<string, number>;
}

export interface TreasureLayout {
  version: 2;
  /** The seed actually used, after any rerolls. */
  seed: number;
  macro: {
    origin: number;
    cell: number;
    size: number;
    /** size² heights in integer decimetres, x fastest. */
    heights: number[];
    /** size² indices into BIOMES. */
    biomes: number[];
  };
  /** North (−z), east (+x), south (+z), west (−x). */
  ring: [RingSide, RingSide, RingSide, RingSide];
  /** yaw in radians, Godot style: yaw 0 faces −Z. The spawn faces the map centre. */
  spawn: { x: number; z: number; yaw: number };
  /** Layer 3: 10–14 set pieces. */
  pieces: SetPiece[];
  /** Layer 4: trails between the pieces and the spawn. */
  trails: Trail[];
  /** Layer 5: 40–80 minor points. */
  minor: MinorPoint[];
}

export type Phase = "teams" | "countdown" | "hunting" | "finished";

/** Up to MAX_TEAMS, one per colour. A team with no members is gone. */
export interface THTeam {
  id: number;
  color: TeamColorKey;
}

export interface THPlayer {
  id: string;
  /** Their client has built the map. */
  ready: boolean;
  /** Wasn't ready when the host started. Watches instead of hunting, with no pool. */
  spectator: boolean;
  removed: boolean;
  /** null only once they've left in the teams phase. */
  teamId: number | null;
}

/** What everyone sees of a player. Never a pool or a position. Scores are the team's: see THPublic.teams. */
export type THPublicPlayer = THPlayer;

export interface THPublic {
  phase: Phase;
  /** The final layout seed. Clients rebuild the map with generateLayout. */
  seed: number;
  /** A team whose hunters all left mid-round stays listed, with no members. */
  teams: (THTeam & { foundCount: number; poolSize: number })[];
  players: THPublicPlayer[];
  startedAt: number | null;
  /** When the round timer fires. Set in hunting. */
  endsAt: number | null;
  /** When the countdown ends. Set from the countdown on. */
  countdownEndsAt: number | null;
  /** Only in finished. */
  replay: THReplay | null;
  /** Empty before start. */
  vehicles: Vehicle[];
}

/** A buggy with two seats (§7.2). The passenger only looks around and drops pins. */
export interface Vehicle {
  /** A buggySlots id: "t0".."t7" or "l0".."l2". */
  id: string;
  x: number;
  /** null until somebody drives it: it then rests where the driver last streamed. */
  y: number | null;
  z: number;
  /** Radians, Godot style. */
  yaw: number;
  driver: string | null;
  passenger: string | null;
}

export type Seat = "driver" | "passenger";

/** A map pin. Seen by the pinner's team only. x and z rounded to 0.1. */
export interface Pin {
  id: string;
  /** The player who dropped it. */
  by: string;
  x: number;
  z: number;
}

/** A player's team's clue board, and the caches anyone on the team has come close to (R1). */
export interface THPrivate {
  teamId: number | null;
  /** taken: another team claimed it first. Race only; always false in Timed. */
  clues: { id: string; clues: string[]; difficulty: number; found: boolean; taken: boolean }[];
  /** x and z rounded to 0.1. */
  revealed: { id: string; x: number; z: number; dy: number }[];
  /** Empty until pins land (Task 7). */
  pins: Pin[];
}

export type THAction =
  | { type: "ready" }
  | { type: "end" }
  | { type: "claim"; cacheId: string }
  | { type: "team.join"; teamId: number }
  | { type: "team.new" }
  /** Host only. */
  | { type: "team.assign"; playerId: string; teamId: number }
  /** Host only. */
  | { type: "start" }
  | { type: "seat"; vehicleId: string; seat: Seat }
  /** Where you got out. A driver's buggy rests here, clamped near its last streamed pose. */
  | { type: "unseat"; x: number; y: number; z: number; yaw: number };

/** Handed from a finished game to the rematch's createGame. */
export interface THCarry {
  teams: { color: TeamColorKey; members: string[] }[];
}

/** Client → server, at POS_HZ in countdown and hunting. */
export type THStreamIn = {
  t: "pos";
  x: number;
  y: number;
  z: number;
  /** Radians, Godot style. Missing reads as 0. */
  yaw: number;
  foot: boolean;
  /** The id of the vehicle you sit in, 1 to 8 characters. Missing reads as null. */
  v: string | null;
};
/** What everyone else gets: the snapshot rounded to 0.01. The runtime adds `from`. */
export type THPosRelay = THStreamIn;

/** The round, drawn after it ends (§9). Ints: seconds since the start, and metres. */
export interface THReplay {
  durationS: number;
  tracks: { playerId: string; teamId: number; points: [number, number, number][] }[];
  finds: { cacheId: string; teamId: number; playerId: string; t: number; x: number; z: number }[];
}
/** Server → a whole team, the first time any of its hunters comes within REVEAL_RADIUS of a pool cache. */
export type THReveal = { t: "reveal"; id: string; x: number; z: number; dy: number };

export type THEvent =
  | { type: "countdown"; spectators: string[] }
  | { type: "hunt-start" }
  /** foundCount is the claimer's team's. */
  | { type: "claimed"; playerId: string; foundCount: number }
  | { type: "ended" }
  | { type: "player-removed"; playerId: string };

export type THMinutes = (typeof TIMED_MINUTES)[number];
export type THMode = "timed" | "race";
export interface THSettings {
  mode: THMode;
  /** Timed only. */
  minutes: THMinutes;
  /** Race only: caches to win. */
  target: number;
}

export const DEFAULT_SETTINGS: THSettings = { mode: "timed", minutes: 30, target: RACE_TARGET_DEFAULT };

/** Missing or empty means the default, field by field; anything present must be a known value. */
export function parseTHSettings(input: unknown): THSettings | null {
  if (input === undefined || input === null) return { ...DEFAULT_SETTINGS };
  if (typeof input !== "object" || Array.isArray(input)) return null;
  const { mode = DEFAULT_SETTINGS.mode, minutes = DEFAULT_SETTINGS.minutes, target = DEFAULT_SETTINGS.target } = input as Record<string, unknown>;
  if (mode !== "timed" && mode !== "race") return null;
  if (!(TIMED_MINUTES as readonly unknown[]).includes(minutes)) return null;
  if (!(RACE_TARGETS as readonly unknown[]).includes(target)) return null;
  return { mode, minutes: minutes as THMinutes, target: target as number };
}
