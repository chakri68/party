import { neighbours } from "../shared/hex.ts";
import { N } from "../shared/numbers.ts";
import type { Step, TileId, World } from "../shared/types.ts";
import type { Rnd } from "./world.ts";

export const burning = (w: World): TileId[] => w.order.filter((id) => w.tiles[id]!.fire > 0);

const burnable = (w: World, id: TileId): boolean => {
  const t = w.tiles[id];
  return !!t && (t.terrain === "forest" || t.terrain === "bridge") && t.fire === 0;
};

export function light(w: World, tile: TileId, by: string | null, steps: Step[]): boolean {
  if (!burnable(w, tile)) return false;
  if (burning(w).length >= N.fireCap) {
    steps.push({ t: "fire-full" });
    return false;
  }
  w.tiles[tile]!.fire = N.fireLife;
  steps.push({ t: "lit", tile, by });
  return true;
}

export function spreadFire(w: World, rnd: Rnd, steps: Step[]): void {
  for (const src of burning(w)) {
    const options = neighbours(src).filter((n) => burnable(w, n));
    if (options.length === 0) continue;
    const pick = options[rnd(options.length)]!;
    if (light(w, pick, null, steps)) w.tiles[pick]!.litThisTurn = true;
  }
}

export function burnDown(w: World, steps: Step[]): void {
  for (const id of burning(w)) {
    const t = w.tiles[id]!;
    if (t.litThisTurn) continue;
    t.fire -= 1;
    if (t.fire > 0) continue;
    const to = t.terrain === "bridge" ? "broken" : "ash";
    t.terrain = to;
    steps.push({ t: "burnt", tile: id, to });
  }
}

export function rainOut(w: World, steps: Step[]): void {
  const out = burning(w);
  for (const id of out) w.tiles[id]!.fire = 0;
  if (out.length > 0) steps.push({ t: "out", tiles: out });
}
