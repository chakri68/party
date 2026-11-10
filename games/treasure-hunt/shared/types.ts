import type { MinorPoint } from "./minor.ts";
import type { Trail } from "./trails.ts";
import type { RingSide } from "./world.ts";

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

export type Phase = "generating" | "exploring" | "finished";

export interface THPlayer {
  id: string;
  ready: boolean;
  /** Never reported ready in time. Watches instead of walking. */
  spectator: boolean;
  removed: boolean;
}

export interface THState {
  phase: Phase;
  seed: number;
  layout: TreasureLayout;
  players: THPlayer[];
  startedAt: number | null;
  endedAt: number | null;
}

export interface THPublic {
  phase: Phase;
  layout: TreasureLayout;
  players: THPlayer[];
  startedAt: number | null;
}

export type THAction = { type: "ready" } | { type: "end" };

export type THEvent =
  | { type: "explore-start"; spectators: string[] }
  | { type: "ended" }
  | { type: "player-removed"; playerId: string };

export type THSettings = Record<string, never>;
