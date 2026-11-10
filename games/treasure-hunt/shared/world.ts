// World constants, in metres. Godot faces −Z; sea level is y = 0.

/** The playable area is x, z ∈ [−PLAY_HALF, PLAY_HALF]. */
export const PLAY_HALF = 750;
/** The edge ring runs from the playable edge out to here. */
export const WORLD_HALF = 950;
export const SEA_LEVEL = 0;

/** The macro grid: MACRO_SIZE² vertices, MACRO_CELL apart, starting at MACRO_ORIGIN on both axes. */
export const MACRO_CELL = 32;
export const MACRO_ORIGIN = -960;
export const MACRO_SIZE = 61;

/** The invisible wall, 20 m into the ring (§4.4). */
export const WALL_HALF = 770;

export const BIOMES = ["meadow", "forest", "rocky", "wetland", "snowcap"] as const;
export type Biome = (typeof BIOMES)[number];

export type RingSide = "mountain" | "sea";
