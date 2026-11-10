import type { MinorPoint } from "./minor.ts";
import type { Trail } from "./trails.ts";
import { TIMED_MINUTES, type RingSide } from "./world.ts";

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

/** How long the server waits for every client to load the world before it starts anyway. */
export const READY_TIMEOUT_MS = 60_000;

export type Phase = "generating" | "countdown" | "hunting" | "finished";

export interface THPlayer {
  id: string;
  ready: boolean;
  /** Never reported ready in time. Watches instead of hunting, with no pool. */
  spectator: boolean;
  removed: boolean;
}

/** What everyone sees of a player. Never their pool or position. */
export interface THPublicPlayer extends THPlayer {
  foundCount: number;
  poolSize: number;
}

export interface THPublic {
  phase: Phase;
  /** The final layout seed. Clients rebuild the map with generateLayout. */
  seed: number;
  players: THPublicPlayer[];
  startedAt: number | null;
  /** When the round timer fires. Set in hunting. */
  endsAt: number | null;
  /** When the countdown ends. Set from the countdown on. */
  countdownEndsAt: number | null;
}

/** One player's own clue board, and the caches they've come close to (R1). */
export interface THPrivate {
  clues: { id: string; clues: string[]; difficulty: number; found: boolean }[];
  /** x and z rounded to 0.1. */
  revealed: { id: string; x: number; z: number; dy: number }[];
}

export type THAction = { type: "ready" } | { type: "end" } | { type: "claim"; cacheId: string };

/** Client → server, at POS_HZ in countdown and hunting. */
export type THStreamIn = { t: "pos"; x: number; y: number; z: number; foot: boolean };
/** Server → one player, the first time they come within REVEAL_RADIUS of a pool cache. */
export type THReveal = { t: "reveal"; id: string; x: number; z: number; dy: number };

export type THEvent =
  | { type: "countdown"; spectators: string[] }
  | { type: "hunt-start" }
  | { type: "claimed"; playerId: string; foundCount: number }
  | { type: "ended" }
  | { type: "player-removed"; playerId: string };

export type THMinutes = (typeof TIMED_MINUTES)[number];
export interface THSettings {
  minutes: THMinutes;
}

export const DEFAULT_SETTINGS: THSettings = { minutes: 30 };

/** Missing or empty means the default; anything else must be a known length. */
export function parseTHSettings(input: unknown): THSettings | null {
  if (input === undefined || input === null) return { ...DEFAULT_SETTINGS };
  if (typeof input !== "object" || Array.isArray(input)) return null;
  const m = (input as Record<string, unknown>).minutes;
  if (m === undefined) return { ...DEFAULT_SETTINGS };
  return (TIMED_MINUTES as readonly unknown[]).includes(m) ? { minutes: m as THMinutes } : null;
}
