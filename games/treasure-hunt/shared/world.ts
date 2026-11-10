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
export const POS_HZ = 10;
/** A route point is kept at most this often (ms)... */
export const TRACK_MIN_MS = 1000;
/** ...and only after moving this far (m). */
export const TRACK_MIN_M = 5;
/** Route points kept per player. */
export const TRACK_CAP = 2000;
/** Live pins per player. A 6th removes the oldest. */
export const PIN_CAP = 5;
/** Metres (XZ) from a player's last pos to a buggy seat. */
export const SEAT_RANGE = 4;
/** Other teams show on the minimap within this (m). */
export const DOT_RANGE = 150;
/** Name tags show within this (m). */
export const NAME_RANGE = 50;
/** Clues open at the start of a race. */
export const RACE_OPEN_START = 3;
/** Race-to-N choices. The default is 5. */
export const RACE_TARGETS = [3, 4, 5, 6, 7, 8, 9, 10] as const;
export const RACE_TARGET_DEFAULT = 5;
/** One per team colour. */
export const MAX_TEAMS = 8;
/** Buggies parked loose in the world. */
export const LOOSE_BUGGIES = 3;
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
