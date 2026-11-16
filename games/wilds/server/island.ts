import { distance } from "../shared/hex.ts";
import { N } from "../shared/numbers.ts";
import type { LiveEvent, PendingBargain, Step, World } from "../shared/types.ts";
import { applyEvent } from "./deck.ts";
import { burnDown, spreadFire } from "./fire.ts";
import { moveSpider } from "./spider.ts";
import { active, addNoise, hurt, type Rnd } from "./world.ts";

export type IslandResult = "win" | "sun" | "down" | null;

/** Everyone still in is up, and on the open gate or next to it. */
export function escaped(w: World): boolean {
  if (!w.gateOpen) return false;
  const gate = w.order.find((t) => w.tiles[t]!.terrain === "gate");
  const team = w.explorers.filter((e) => !e.left);
  return !!gate && team.length > 0 && team.every((e) => !e.down && distance(e.tile, gate) <= 1);
}

/** Spec 4.5, in its fixed order. Mutates `w`. Returns the bargain still waiting, and how the game ended, if it did. */
export function islandTurn(
  w: World, ev: LiveEvent, option: number | null, pending: PendingBargain | null, rnd: Rnd, steps: Step[],
): { pending: PendingBargain | null; result: IslandResult } {
  let result: IslandResult = null;
  // 1. The stone hand's noise, if it's due, then the event.
  if (pending && pending.due === w.round) {
    addNoise(w, pending.tile, N.stoneNoise, steps);
    pending = null;
  }
  pending = applyEvent(w, ev, option, pending, rnd, steps) ?? pending;

  // 2. Fire spreads (two times in a dry wind), then burns down.
  spreadFire(w, rnd, steps);
  if (ev.id === "dry-wind") spreadFire(w, rnd, steps);
  burnDown(w, steps);

  // 3. The spider.
  moveSpider(w, steps);

  // 4. Fire hurts anyone standing in it.
  for (const e of active(w)) if (w.tiles[e.tile]!.fire > 0) hurt(w, e.id, "fire", steps);

  // 5. Noise fades.
  for (const t of w.order) {
    const tile = w.tiles[t]!;
    if (tile.noise > 0) tile.noise -= 1;
  }

  // 6. Win check, before the sun: a win on the last round counts.
  if (escaped(w)) result = "win";
  else {
    // 7. The sun.
    w.sun += 1;
    if (w.sun >= w.sunLimit) result = "sun";
    // 8. Everyone down.
    else if (w.explorers.filter((e) => !e.left).every((e) => e.down)) result = "down";
  }

  for (const e of w.explorers) e.shield = false;
  for (const t of w.order) w.tiles[t]!.litThisTurn = false;
  w.speedBonus = 0;
  w.spider.still = false;
  return { pending, result };
}
