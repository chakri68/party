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
