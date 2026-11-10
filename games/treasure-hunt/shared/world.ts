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

// The hunt (§6.4, R1, R8). Godot mirrors the ones it needs.

/** A pool cache this close (XZ) is revealed to its owner. */
export const REVEAL_RADIUS = 40;
/** The client offers a claim this close. */
export const CLAIM_RANGE = 3;
/** The server accepts a claim this close (XZ): looser than CLAIM_RANGE, for lag. */
export const CLAIM_CHECK = 6;
/** How often the client sends its position. */
export const POS_HZ = 4;
/** m/s. Faster than this between two positions is a jump. The buggy tops out at 15.3. */
export const MAX_SPEED = 25;
/** No claims for this long after a jump. */
export const JUMP_GRACE_MS = 5000;
/** A position older than this can't back a claim. */
export const POS_STALE_MS = 2000;
/** Metres a claimer may be above or below the ground at the cache. */
export const HEIGHT_TOL = 20;
export const COUNTDOWN_MS = 3000;
/** Timed round lengths. The default is 30. */
export const TIMED_MINUTES = [15, 30, 60] as const;
