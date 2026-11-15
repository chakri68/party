import { distance, neighbours, path } from "../shared/hex.ts";
import { N } from "../shared/numbers.ts";
import { passable } from "../shared/maps.ts";
import type { SpiderMove, Step, TileId, World } from "../shared/types.ts";
import { burning } from "./fire.ts";
import { active, hurt } from "./world.ts";

const idx = (w: World, t: TileId): number => w.order.indexOf(t);

/** Passable, not burning, no explorer (active or down) on it. */
function walkable(w: World, t: TileId): boolean {
  const tile = w.tiles[t];
  if (!tile || !passable(tile.terrain) || tile.fire > 0) return false;
  return !w.explorers.some((e) => !e.left && e.tile === t);
}

const nextToActive = (w: World, t: TileId): boolean =>
  active(w).some((e) => distance(e.tile, t) <= 1);

/** Walk toward `to`, at most `steps` steps, stopping as soon as next to an active explorer. */
function walk(w: World, to: TileId, steps: number, allowEnd: boolean): TileId[] | null {
  const from = w.spider.tile;
  const p = path(from, to, (t) => walkable(w, t) || (allowEnd && t === to));
  if (!p) return null;
  return trim(w, p, steps);
}

function trim(w: World, p: TileId[], steps: number): TileId[] {
  const out = [p[0]!];
  for (let i = 1; i < p.length && i <= steps; i++) {
    out.push(p[i]!);
    if (nextToActive(w, p[i]!)) break;
  }
  return out;
}

/** Flee `steps` steps. Each step goes to the walkable neighbour farthest from the danger, if strictly farther. */
function flee(w: World, away: (t: TileId) => number, steps: number): TileId[] {
  const out = [w.spider.tile];
  for (let i = 0; i < steps; i++) {
    const cur = out[out.length - 1]!;
    let best: TileId | null = null;
    let bestD = away(cur);
    for (const n of neighbours(cur).sort((a, b) => idx(w, a) - idx(w, b))) {
      if (!walkable(w, n)) continue;
      const d = away(n);
      if (d > bestD) { best = n; bestD = d; }
    }
    if (!best) break;
    out.push(best);
  }
  return out;
}

const nearestFire = (fires: TileId[]) => (t: TileId): number =>
  Math.min(...fires.map((f) => distance(t, f)));

const bitten = (w: World, at: TileId): string[] =>
  active(w).filter((e) => distance(e.tile, at) <= 1).map((e) => e.id);

export function spiderPlan(w: World): SpiderMove {
  const here = w.spider.tile;
  const stay = (why: SpiderMove["why"], bites: string[] = []): SpiderMove => ({ path: [here], why, bites });
  if (w.spider.still) return stay("still");
  if (w.spider.rest) return stay("rest");

  const fires = burning(w);
  if (fires.some((f) => distance(f, here) <= 1)) {
    return { path: flee(w, nearestFire(fires), N.scaredStep), why: "scared", bites: [] };
  }

  const steps = N.spiderStep + w.speedBonus;
  const finish = (p: TileId[], why: SpiderMove["why"]): SpiderMove => ({
    path: p, why, bites: bitten(w, p[p.length - 1]!),
  });

  // Noise: the loudest tile in range, then the nearest, then the lower index.
  const loud = w.order
    .filter((t) => w.tiles[t]!.noise > 0 && distance(here, t) <= N.spiderNoiseRange)
    .sort((a, b) =>
      w.tiles[b]!.noise - w.tiles[a]!.noise || distance(here, a) - distance(here, b) || idx(w, a) - idx(w, b));
  if (loud.length > 0) {
    const p = walk(w, loud[0]!, steps, false);
    if (p) return finish(p, "noise");
  }

  // Hunt: the nearest active explorer in range, ties to the lower seat.
  const prey = active(w)
    .map((e, seat) => ({ e, seat, d: distance(here, e.tile) }))
    .filter((x) => x.d <= N.spiderHuntRange)
    .sort((a, b) => a.d - b.d || a.seat - b.seat)[0];
  if (prey) {
    const p = walk(w, prey.e.tile, steps, true);
    if (p) {
      // Never step onto the explorer.
      const trimmed = p[p.length - 1] === prey.e.tile ? p.slice(0, -1) : p;
      return finish(trimmed, "hunt");
    }
  }

  // Home: 1 step toward the nest.
  const nest = w.order.find((t) => w.tiles[t]!.nest);
  if (nest && nest !== here) {
    const p = walk(w, nest, 1, false);
    if (p) return finish(p, "home");
  }
  return stay("home", bitten(w, here));
}

export function moveSpider(w: World, steps: Step[]): void {
  const plan = spiderPlan(w);
  steps.push({ t: "spider", path: plan.path, why: plan.why });
  w.spider.tile = plan.path[plan.path.length - 1]!;
  for (const who of plan.bites) hurt(w, who, "spider", steps);
  w.spider.rest = plan.why === "scared";
  w.spider.still = false;
}

export function scare(w: World, from: TileId, steps: Step[]): void {
  const p = flee(w, (t) => distance(t, from), N.scaredStep);
  if (p.length > 1) steps.push({ t: "spider", path: p, why: "scared" });
  w.spider.tile = p[p.length - 1]!;
  w.spider.rest = true;
}
