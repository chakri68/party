import { TILE_ORDER, coords } from "../shared/hex.ts";
import { N } from "../shared/numbers.ts";
import type { ItemId, Role, Terrain, Tile, TileId, World } from "../shared/types.ts";

export interface BlankOpts {
  explorers?: { id: string; tile: TileId; role?: Role; items?: ItemId[]; hearts?: number }[];
  tiles?: Record<TileId, Partial<Tile>>;
  spider?: TileId;
  nest?: TileId;
}

/** A 37-tile all-grass, all-open world with terrain overrides. Spider at "3,0" by default. */
export function blankWorld(map: Partial<Record<TileId, Terrain>> = {}, opts: BlankOpts = {}): World {
  const tiles: World["tiles"] = {};
  for (const id of TILE_ORDER) {
    const { q, r } = coords(id);
    tiles[id] = {
      id, q, r, terrain: map[id] ?? "grass", open: true, fire: 0, noise: 0,
      cache: false, nest: id === (opts.nest ?? "3,0"), ruin: null, litThisTurn: false,
      ...(opts.tiles?.[id] ?? {}),
    };
  }
  return {
    tiles, order: [...TILE_ORDER],
    explorers: (opts.explorers ?? []).map((e) => ({
      id: e.id, role: e.role ?? null, tile: e.tile, hearts: e.hearts ?? N.hearts, items: [...(e.items ?? [])],
      down: false, shield: false, left: false,
    })),
    spider: { tile: opts.spider ?? "3,0", rest: false, still: false },
    stones: [], half: [], gateOpen: false,
    sun: 0, round: 1, sunLimit: 10, speedBonus: 0,
  };
}
