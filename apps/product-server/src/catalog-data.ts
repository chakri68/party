// Pure data, no Worker types: the web app imports this file too.

/** Rooms on the free tier can't pick these. */
export const PREMIUM_GAME_IDS = ["blind-rally", "rally", "treasure-hunt", "dominion"];

/** Seat cap for a free room. A pass room uses each game's own max. */
export const FREE_MAX_PLAYERS = 8;

/** Product names for games whose shared names differ. Ids don't change. */
export const PRODUCT_NAMES: Record<string, string> = { dominion: "Frontier", scribbl: "Doodle Dash" };
