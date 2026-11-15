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
  // 0: a river cuts the island in two. 2 bridges.
  ["gfcg", "fgfgS", "gnRgfg", "gfgGfgc", "wbwwbw", "gcgSg", "Cggg"],
  // 1: reeds in the middle.
  ["gcgC", "gSeeg", "gfeeeg", "fgeGwbg", "gnRegg", "gcfeS", "cwbg"],
  // 2: rock walls with gaps, and a short river in the north east. 2 bridges.
  ["gfkc", "gfkwS", "ggkkbg", "CgkGgbg", "ggkgfS", "gcgRg", "cgng"],
  // 3: thick forest round the nest, and a stream along the south.
  ["gfcf", "ffnfS", "gfRfff", "cgfGfgg", "gffffc", "wbwbS", "Cfgg"],
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
