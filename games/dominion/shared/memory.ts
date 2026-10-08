// A faction's memory of the map, packed one number per tile so eight players'
// worth of fog stays small in storage (§17).

import type { Feature, Improvement, Resource, Terrain, Tile } from "./types.ts";

const TERRAINS: Terrain[] = ["plains", "forest", "mountain", "shallow", "ocean"];
const RESOURCES: (Resource | null)[] = [null, "fruit", "animals", "fish", "crops", "ore"];
const IMPROVEMENTS: (Improvement | null)[] = [null, "farm", "lumber_camp", "mine"];
const FEATURES: (Feature | null)[] = [null, "village", "ruins"];

export interface DecodedTile {
  t: Terrain;
  res: Resource | null;
  imp: Improvement | null;
  road: boolean;
  feat: Feature | null;
  /** Index into turn order, or -1. */
  ownerSeat: number;
}

/** bits: terrain 0–2, resource 3–5, improvement 6–7, road 8, feature 9–10, owner seat + 1 from 11. */
export function encodeTile(tile: Tile, ownerSeat: number): number {
  return (
    TERRAINS.indexOf(tile.t) |
    (RESOURCES.indexOf(tile.res) << 3) |
    (IMPROVEMENTS.indexOf(tile.imp) << 6) |
    ((tile.road ? 1 : 0) << 8) |
    (FEATURES.indexOf(tile.feat) << 9) |
    ((ownerSeat + 1) << 11)
  );
}

/** Terrain only: what "revealed terrain" fog starts everyone with. */
export function encodeTerrain(tile: Tile): number {
  return TERRAINS.indexOf(tile.t);
}

export function decodeTile(code: number): DecodedTile {
  return {
    t: TERRAINS[code & 7]!,
    res: RESOURCES[(code >> 3) & 7] ?? null,
    imp: IMPROVEMENTS[(code >> 6) & 3] ?? null,
    road: ((code >> 8) & 1) === 1,
    feat: FEATURES[(code >> 9) & 3] ?? null,
    ownerSeat: (code >> 11) - 1,
  };
}
