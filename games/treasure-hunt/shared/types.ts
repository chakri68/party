import type { RingSide } from "./world.ts";

export interface TreasureLayout {
  version: 1;
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
