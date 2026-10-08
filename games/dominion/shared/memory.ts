// A faction's memory of the map, packed one number per tile so eight players'
// worth of fog stays small in storage (§17).

import type { Feature, Improvement, Resource, Terrain, Tile } from "./types.ts";

const TERRAINS: Terrain[] = ["plains", "forest", "mountain", "shallow", "ocean", "ice"];
const RESOURCES: (Resource | null)[] = [null, "fruit", "animals", "fish", "crops", "ore"];
const IMPROVEMENTS: (Improvement | null)[] = [null, "farm", "lumber_camp", "mine", "mill", "forge", "market", "temple", "monument", "port", "grove", "reef_nest"];
const FEATURES: (Feature | null)[] = [null, "village", "ruins", "beacon"];

export interface DecodedTile {
  t: Terrain;
  res: Resource | null;
  imp: Improvement | null;
  road: boolean;
  feat: Feature | null;
  /** Index into turn order, or -1. */
  ownerSeat: number;
  /** Seat whose mycelium covers it, or -1. */
  mycSeat: number;
}

/**
 * bits: terrain 0–2, resource 3–5, improvement 6–9, road 10, feature 11–12,
 * owner seat + 1 13–16, mycelium owner seat + 1 17–20. Codes stored before
 * mycelium existed have nothing above bit 16, so they read the same.
 */
export function encodeTile(tile: Tile, ownerSeat: number, mycSeat = -1): number {
  return (
    TERRAINS.indexOf(tile.t) |
    (RESOURCES.indexOf(tile.res) << 3) |
    (IMPROVEMENTS.indexOf(tile.imp) << 6) |
    ((tile.road ? 1 : 0) << 10) |
    (FEATURES.indexOf(tile.feat) << 11) |
    ((ownerSeat + 1) << 13) |
    ((mycSeat + 1) << 17)
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
    imp: IMPROVEMENTS[(code >> 6) & 15] ?? null,
    road: ((code >> 10) & 1) === 1,
    feat: FEATURES[(code >> 11) & 3] ?? null,
    ownerSeat: ((code >> 13) & 15) - 1,
    mycSeat: ((code >> 17) & 15) - 1,
  };
}
