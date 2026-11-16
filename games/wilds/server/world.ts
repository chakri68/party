import { within } from "../shared/hex.ts";
import { N } from "../shared/numbers.ts";
import { passable } from "../shared/maps.ts";
import type { Explorer, Step, TileId, World } from "../shared/types.ts";

export type Rnd = (n: number) => number;

export function cloneWorld(w: World): World {
  return structuredClone(w);
}

export function explorer(w: World, id: string): Explorer {
  const e = w.explorers.find((x) => x.id === id);
  if (!e) throw new Error(`No explorer ${id}`);
  return e;
}

export const active = (w: World): Explorer[] => w.explorers.filter((e) => !e.left && !e.down);

/** 1 damage unless shielded (the shield is then used up). Floors at 0, sets down, logs damage and down. */
export function hurt(w: World, who: string, by: "fire" | "spider" | "rocks" | "ruin", steps: Step[]): void {
  const e = explorer(w, who);
  if (e.down || e.left) return;
  if (e.shield) {
    e.shield = false;
    steps.push({ t: "damage", who, by, blocked: true });
    return;
  }
  e.hearts = Math.max(0, e.hearts - 1);
  steps.push({ t: "damage", who, by, blocked: false });
  if (e.hearts === 0) {
    e.down = true;
    steps.push({ t: "down", who });
  }
}

export function addNoise(w: World, tile: TileId, n: number, steps: Step[]): void {
  const t = w.tiles[tile];
  if (!t) return;
  t.noise = Math.min(N.noiseMax, t.noise + n);
  steps.push({ t: "noise", tile, level: t.noise });
}

export function openAround(w: World, centre: TileId, range: number, steps: Step[]): void {
  const opened: TileId[] = [];
  for (const id of within(centre, range)) {
    const t = w.tiles[id];
    if (t && !t.open) {
      t.open = true;
      opened.push(id);
    }
  }
  if (opened.length > 0) steps.push({ t: "open", tiles: opened });
}

export function canWalk(w: World, t: TileId): boolean {
  const tile = w.tiles[t];
  return !!tile && passable(tile.terrain) && tile.fire === 0 && w.spider.tile !== t;
}
