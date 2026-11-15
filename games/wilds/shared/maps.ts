import { coords, rotate, TILE_ORDER } from "./hex.ts";
import type { RuinId, Terrain, Tile, TileId } from "./types.ts";

/**
 * 4 hand-drawn islands. Each has 7 rows (r = -3..3) and each row lists q from low to high,
 * so the rows have 4, 5, 6, 7, 6, 5, 4 letters (the same order as TILE_ORDER).
 *
 * g grass, f forest, n forest with the spider nest, e reeds, w river, b bridge, k rock,
 * C camp, G gate, c grass with a cache, R the ruin next to the nest (the cave),
 * S the two other ruin spots.
 */
export const ISLANDS: string[][] = [
  // 0: a rock wall on the camp side and a river on the far side, with one dry gap by the nest.
  ["fScc", "fbwwf", "fkfgwf", "CkfGgfR", "gkgfbn", "gwwwf", "cgfS"],
  // 1: rock walls by the camp, a short stream in the south west, and thick forest round the nest.
  ["Cgkc", "gkkkf", "ekgfwS", "cgfGfwg", "wbffbc", "Swfff", "ffnR"],
  // 2: much like island 0 in a mirror, with reeds by a bridge.
  ["Cggc", "fkkwg", "fkfgwf", "fbfGfwS", "Swgebf", "cwwfn", "cffR"],
  // 3: much like island 1 in a mirror, with less rock by the camp.
  ["cwSf", "egbwf", "gkfffn", "CkgGffR", "gkfgbf", "gkwwc", "cfSg"],
];

export interface Board {
  tiles: Record<TileId, Tile>;
  camp: TileId;
  gate: TileId;
  nest: TileId;
  ruins: Record<RuinId, TileId>;
}

const TERRAIN: Record<string, Terrain> = {
  g: "grass", f: "forest", n: "forest", e: "reeds", w: "river", b: "bridge", k: "rock",
  C: "camp", G: "gate", c: "grass", R: "ruin", S: "ruin",
};

export function buildBoard(island: number, turns: number, ruinOrder: [RuinId, RuinId]): Board {
  const rows = ISLANDS[island]!;
  const letters = rows.join("");
  const tiles: Record<TileId, Tile> = {};
  let camp = "";
  let gate = "";
  let nest = "";
  const ruins = {} as Record<RuinId, TileId>;
  let spots = 0;
  TILE_ORDER.forEach((base, i) => {
    const ch = letters[i]!;
    const tid = rotate(base, turns);
    const { q, r } = coords(tid);
    let ruin: RuinId | null = null;
    if (ch === "R") ruin = "cave";
    else if (ch === "S") ruin = ruinOrder[spots++]!;
    if (ruin) ruins[ruin] = tid;
    if (ch === "C") camp = tid;
    if (ch === "G") gate = tid;
    if (ch === "n") nest = tid;
    tiles[tid] = {
      id: tid, q, r, terrain: TERRAIN[ch]!, open: false, fire: 0, noise: 0,
      cache: ch === "c", nest: ch === "n", ruin, litThisTurn: false,
    };
  });
  return { tiles, camp, gate, nest, ruins };
}

export const passable = (terrain: Terrain): boolean =>
  terrain === "grass" || terrain === "forest" || terrain === "reeds" || terrain === "bridge"
  || terrain === "camp" || terrain === "gate" || terrain === "ruin" || terrain === "ash";
