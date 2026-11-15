import { bumpStat, type PartyStats } from "@games/game-core";
import { distance, reachable } from "../shared/hex.ts";
import { N } from "../shared/numbers.ts";
import { ROLE_ATTRS, WAY_BONUS, failCost, rollDice } from "../shared/roll.ts";
import { RUINS } from "../shared/ruins.ts";
import type { Card, Explorer, ItemId, Plan, Step, TileId, World } from "../shared/types.ts";
import { light } from "./fire.ts";
import { scare } from "./spider.ts";
import { addNoise, canWalk, explorer, hurt, openAround, type Rnd } from "./world.ts";

const ITEMS: ItemId[] = ["torch", "planks", "medkit", "lure"];
const BLOCKED = "The way is blocked.";
const FIRST = "Someone got the key stone first.";
const EMPTY = "The cache is empty.";
const FULL = "Your bag is full.";
const FIXED = "The bridge is already fixed.";
const NOPE = "You can't reach that.";

export const turnOrder = (w: World): string[] => {
  const n = w.explorers.length;
  if (n === 0) return [];
  const shift = (w.round - 1) % n;
  return [...w.explorers.slice(shift), ...w.explorers.slice(0, shift)].filter((e) => !e.left).map((e) => e.id);
};

export function planProblem(w: World, who: string, card: Card): string | null {
  const c = card as Record<string, unknown> | null;
  if (!c || typeof c !== "object") return "That card is not valid.";
  const tileOk = (t: unknown): t is TileId => typeof t === "string" && !!w.tiles[t];
  const me = w.explorers.find((e) => e.id === who);
  switch (c.kind) {
    case "guard":
    case "look":
      return null;
    case "move":
      return tileOk(c.to) ? null : "Pick a tile on the map.";
    case "act": {
      if (!tileOk(c.at)) return "Pick a tile on the map.";
      if (c.approach !== undefined) {
        if (c.approach !== 0 && c.approach !== 1 && c.approach !== "force") return "That way in is not valid.";
        if (w.tiles[c.at]!.ruin === null) return "Only a ruin has a way in.";
      }
      if (c.way !== undefined && c.way !== "careful" && c.way !== "normal" && c.way !== "bold") return "That way is not valid.";
      return null;
    }
    case "item": {
      if (!ITEMS.includes(c.item as ItemId)) return "That item is not valid.";
      if (!me?.items.includes(c.item as ItemId)) return "You do not have that item.";
      if (c.at !== undefined && !tileOk(c.at)) return "Pick a tile on the map.";
      if (c.who !== undefined && !w.explorers.some((e) => e.id === c.who)) return "Pick a player in the game.";
      return null;
    }
    case "help":
      if (typeof c.who !== "string" || !w.explorers.some((e) => e.id === c.who)) return "Pick a player in the game.";
      return c.who === who ? "You can't help yourself." : null;
    default:
      return "That card is not valid.";
  }
}

export function playBeats(w: World, plans: Record<string, Plan>, rnd: Rnd, stats: PartyStats, steps: Step[]): void {
  const order = turnOrder(w);
  const out = new Set<string>(); // down at the start of any beat: plays nothing more this round
  const emptied = new Set<TileId>();
  const fixed = new Set<TileId>();

  for (let beat = 0; beat < N.actions; beat++) {
    for (const e of w.explorers) if (e.down) out.add(e.id);
    const cardOf = (id: string): Card => plans[id]?.[beat] ?? { kind: "guard" };
    const helped = new Map<string, string[]>(); // target -> helpers
    const rolled = new Set<string>();
    const startTile = new Map(w.explorers.map((e) => [e.id, e.tile] as const));

    // 1. Help
    for (const id of order) {
      const c = cardOf(id);
      if (c.kind !== "help" || out.has(id) || explorer(w, id).down) continue;
      const target = w.explorers.find((e) => e.id === c.who);
      if (!target || target.id === id) continue;
      if (target.left) { steps.push({ t: "help-nothing", who: id, target: target.id }); continue; }
      if (distance(startTile.get(id)!, startTile.get(target.id)!) > 1) continue;
      if (target.down) {
        target.down = false; target.hearts = 1;
        bumpStat(stats, id, "rescues");
        steps.push({ t: "up", who: target.id, by: id });
      } else {
        const list = helped.get(target.id) ?? [];
        if (!list.includes(id)) list.push(id);
        helped.set(target.id, list);
      }
    }

    // 2. Everything else
    for (const id of order) {
      const me = explorer(w, id);
      if (out.has(id) || me.down || me.left) continue;
      const c = cardOf(id);
      if (c.kind === "help") continue;
      const guard = (why: string | null): void => becomeGuard(w, me, why, steps);
      const wantsGuard = c.kind === "guard";
      if (wantsGuard) { guard(null); continue; }

      if (c.kind === "move") {
        const walls = reachable(me.tile, me.role === "runner" ? N.runnerMove : N.move,
          (t) => canWalk(w, t) && w.tiles[t]!.open, (t) => w.tiles[t]?.terrain === "reeds");
        const p = walls.get(c.to);
        if (!p) {
          const known = !!w.tiles[c.to] && w.tiles[c.to]!.open && distance(me.tile, c.to) <= (me.role === "runner" ? N.runnerMove : N.move);
          guard(known ? BLOCKED : NOPE);
          continue;
        }
        steps.push({ t: "move", who: id, path: p });
        me.tile = c.to;
        openAround(w, c.to, 1, steps);
      } else if (c.kind === "look") {
        openAround(w, me.tile, me.role === "guide" ? N.guideLook : N.look, steps);
      } else if (c.kind === "act") {
        const why = doAct(w, me, c, helped.get(id) ?? [], rnd, steps, rolled, emptied, fixed);
        if (why) guard(why);
      } else if (c.kind === "item") {
        const why = doItem(w, me, c, rnd, stats, steps, fixed);
        if (why) guard(why);
      }
    }

    // 3. Helped but no roll
    for (const [target, helpers] of helped) {
      if (rolled.has(target)) continue;
      for (const h of helpers) steps.push({ t: "help-nothing", who: h, target });
    }
  }
}

function becomeGuard(w: World, me: Explorer, why: string | null, steps: Step[]): void {
  me.shield = true;
  steps.push({ t: "guard", who: me.id, why });
  if (me.role === "protector") {
    for (const e of w.explorers) if (!e.left && !e.down && e.tile === me.tile) e.shield = true;
  }
}

const near = (me: Explorer, t: TileId): boolean => distance(me.tile, t) <= 1;

/** Returns a reason when the act cannot happen. */
function doAct(
  w: World, me: Explorer, c: Extract<Card, { kind: "act" }>, helpers: string[], rnd: Rnd,
  steps: Step[], rolled: Set<string>, emptied: Set<TileId>, fixed: Set<TileId>,
): string | null {
  const tile = w.tiles[c.at];
  if (!tile || !near(me, c.at)) return NOPE;

  if (tile.terrain === "gate") {
    if (me.tile !== c.at || w.stones.length !== 3 || w.gateOpen) return NOPE;
    w.gateOpen = true;
    steps.push({ t: "gate", who: me.id });
    return null;
  }

  if (tile.ruin !== null) {
    const ruin = tile.ruin;
    if (!tile.open) return NOPE;
    if (w.stones.includes(ruin)) return FIRST;
    if (w.half.includes(ruin)) {
      w.half = w.half.filter((r) => r !== ruin);
      w.stones.push(ruin);
      steps.push({ t: "stone", who: me.id, ruin, how: "half" });
      return null;
    }
    if (c.approach === undefined) return NOPE;
    if (c.approach === "force") {
      w.stones.push(ruin);
      w.sun += 1;
      steps.push({ t: "stone", who: me.id, ruin, how: "force" });
      addNoise(w, c.at, N.forceNoise, steps);
      return null;
    }
    const way = c.way ?? "normal";
    const ap = RUINS[ruin].approaches[c.approach];
    const bonus = (me.role ? ROLE_ATTRS[me.role][ap.attr] : 0) + WAY_BONUS[way] + (helpers.length > 0 ? 1 : 0);
    const dice = rollDice(rnd);
    const pass = dice[0] + dice[1] + bonus >= ap.need;
    rolled.add(me.id);
    steps.push({ t: "roll", who: me.id, ruin, attr: ap.attr, dice, bonus, need: ap.need, pass, helpers: [...helpers] });
    if (pass) {
      w.stones.push(ruin);
      steps.push({ t: "stone", who: me.id, ruin, how: "roll" });
    } else {
      const cost = failCost(ap, way);
      for (let i = 0; i < cost.damage; i++) hurt(w, me.id, "ruin", steps);
      if (cost.noise > 0) addNoise(w, c.at, cost.noise, steps);
      w.half.push(ruin);
      steps.push({ t: "half", who: me.id, ruin });
    }
    if (way === "bold") addNoise(w, me.tile, N.boldNoise, steps);
    return null;
  }

  if (tile.cache || emptied.has(c.at)) {
    if (!tile.open) return NOPE;
    if (!tile.cache) return EMPTY;
    if (me.items.length >= N.bag) return FULL;
    const item = drawItem(rnd);
    me.items.push(item);
    tile.cache = false;
    emptied.add(c.at);
    steps.push({ t: "cache", who: me.id, item });
    return null;
  }

  if (tile.terrain === "broken" && me.role === "fixer") {
    tile.terrain = "bridge";
    fixed.add(c.at);
    steps.push({ t: "bridge", tile: c.at, fixed: true, by: me.id });
    return null;
  }
  if (tile.terrain === "bridge" && me.role === "fixer" && fixed.has(c.at)) return FIXED;
  return NOPE;
}

function drawItem(rnd: Rnd): ItemId {
  const ids = Object.keys(N.cacheWeights) as ItemId[];
  const total = ids.reduce((s, i) => s + N.cacheWeights[i], 0);
  let r = rnd(total);
  for (const i of ids) {
    if (r < N.cacheWeights[i]) return i;
    r -= N.cacheWeights[i];
  }
  return ids[0]!;
}

function doItem(
  w: World, me: Explorer, c: Extract<Card, { kind: "item" }>, rnd: Rnd, stats: PartyStats, steps: Step[], fixed: Set<TileId>,
): string | null {
  void rnd;
  const idx = me.items.indexOf(c.item);
  if (idx < 0) return NOPE;
  const use = (): void => { me.items.splice(idx, 1); };
  const at = c.at && w.tiles[c.at] ? c.at : null;

  if (c.item === "medkit") {
    const t = w.explorers.find((e) => e.id === (c.who ?? me.id));
    if (!t || t.left || t.down || !near(me, t.tile)) return NOPE;
    const gain = Math.min(N.hearts, t.hearts + N.medkit) - t.hearts;
    t.hearts += gain;
    use();
    steps.push({ t: "item", who: me.id, item: "medkit", at: null });
    steps.push({ t: "heal", who: t.id, by: me.id, hearts: gain });
    return null;
  }
  if (!at) return NOPE;
  const tile = w.tiles[at]!;
  if (c.item === "torch") {
    if (distance(me.tile, at) !== 1) return NOPE;
    let did = false;
    if (w.spider.tile === at) { scare(w, me.tile, steps); did = true; }
    if (light(w, at, me.id, steps)) { bumpStat(stats, me.id, "firesLit"); did = true; }
    if (!did) return NOPE;
    steps.push({ t: "item", who: me.id, item: "torch", at });
    return null;
  }
  if (c.item === "planks") {
    if (distance(me.tile, at) !== 1) return NOPE;
    if (tile.terrain === "bridge") return FIXED;
    if (tile.terrain !== "broken" && tile.terrain !== "river") return NOPE;
    tile.terrain = "bridge";
    fixed.add(at);
    use();
    steps.push({ t: "item", who: me.id, item: "planks", at });
    steps.push({ t: "bridge", tile: at, fixed: true, by: me.id });
    return null;
  }
  // lure
  if (!tile.open || distance(me.tile, at) > N.lureRange) return NOPE;
  tile.noise = N.lureNoise;
  use();
  steps.push({ t: "item", who: me.id, item: "lure", at });
  steps.push({ t: "noise", tile: at, level: tile.noise });
  return null;
}
