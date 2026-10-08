// Computer players (§17). A bot sees exactly what a person in its seat would:
// it decides from its own projection, never the full world, and every action
// it picks goes through the same legality checks as a human's.
//
// It's a weighted priority list rather than a search: claim what's free,
// take favourable fights, grow cities, keep a small army, explore the rest.
// Skill changes how picky and how greedy it is, not what it can see.

import {
  DEVELOP,
  HARVEST,
  rewardChoices,
  techCost,
  TECHS,
  TRAINABLE,
  UNITS,
} from "../shared/content.ts";
import { chebyshev, neighbors, type Rng } from "../shared/grid.ts";
import type {
  BotLevel,
  DevelopKind,
  DominionAction,
  DominionPrivateState,
  KnownUnit,
  RewardChoice,
  TechId,
  UnitType,
} from "../shared/types.ts";

type Act = Exclude<DominionAction, { type: "surrender" }>;

/** Research order. Military first on hard, economy first otherwise. */
const TECH_PLAN: Record<BotLevel, TechId[]> = {
  easy: ["gathering", "hunting", "fishing", "riding", "farming", "forestry", "climbing", "archery", "mining", "roads", "strategy", "meditation", "metallurgy"],
  normal: ["gathering", "hunting", "riding", "fishing", "archery", "farming", "forestry", "climbing", "mining", "strategy", "roads", "metallurgy", "meditation"],
  hard: ["riding", "hunting", "gathering", "archery", "climbing", "mining", "metallurgy", "farming", "strategy", "fishing", "forestry", "roads", "meditation"],
};

/** What it trains, best first. Easy keeps it simple. */
const TRAIN_PLAN: Record<BotLevel, UnitType[]> = {
  easy: ["infantry"],
  normal: ["cavalry", "archer", "infantry"],
  hard: ["swordsman", "cavalry", "archer", "defender", "infantry"],
};

const REWARD_PLAN: Record<BotLevel, (level: number) => RewardChoice> = {
  easy: (level) => rewardChoices(level)[0],
  normal: (level) => rewardChoices(level)[0],
  hard: (level) => (level === 3 ? "walls" : level >= 5 ? "champion" : rewardChoices(level)[0]),
};

export interface BotMemory {
  /** Actions that failed this turn; never retried. */
  banned: Set<string>;
}

const key = (a: Act) => JSON.stringify(a);

/** The bot's next action, or end-turn when it has nothing worth doing. */
export function decide(view: DominionPrivateState, level: BotLevel, rng: Rng, memory: BotMemory): Act {
  const turn = view.turn;
  const ok = (a: Act) => !memory.banned.has(key(a));
  const size = Math.round(Math.sqrt(view.tiles.length));
  const mine = view.units.filter((u) => u.owner === view.me);
  const myCities = view.cities.filter((c) => c.mine);
  const enemies = view.units.filter((u) => u.owner !== view.me);
  // Easy skips some good moves on purpose: it should be beatable.
  const sloppy = () => level === "easy" && rng.chance(0.3);

  // 1. Rewards can't wait past the turn anyway.
  for (const c of myCities) {
    const level_ = c.mine!.pendingRewards[0];
    if (level_ === undefined) continue;
    const a: Act = { type: "reward", turn, city: c.mine!.id, choice: REWARD_PLAN[level](level_) };
    if (ok(a)) return a;
  }

  // 2. Captures: free cities, and the main way to win.
  for (const u of mine) {
    const m = u.mine!;
    if (m.done || m.moved || m.attacked || !m.settled) continue;
    const tile = view.tiles[u.at];
    const city = view.cities.find((c) => c.at === u.at);
    if (tile?.feat === "village" || (city && city.owner !== view.me)) {
      const a: Act = { type: "capture", turn, unit: u.id };
      if (ok(a)) return a;
    }
  }

  // 3. Fights worth taking, by the preview the bot is shown.
  const minEdge = level === "easy" ? 2 : level === "normal" ? 1 : 0.6;
  let bestAttack: { a: Act; score: number } | null = null;
  for (const [unit, options] of Object.entries(view.attacks)) {
    for (const o of options) {
      const target = enemies.find((e) => e.at === o.target);
      if (!target) continue;
      const kill = o.damage >= target.hp;
      const edge = o.retaliation ? o.damage / o.retaliation : Infinity;
      if (!kill && edge < minEdge) continue;
      const score = o.damage * (kill ? 3 : 1) - o.retaliation + (view.cities.some((c) => c.at === o.target) ? 4 : 0);
      const a: Act = { type: "attack", turn, unit, target: o.target };
      if (ok(a) && (!bestAttack || score > bestAttack.score)) bestAttack = { a, score };
    }
  }
  if (bestAttack && !sloppy()) return bestAttack.a;

  // 4. Grow: harvest and build on its own land.
  if (!sloppy()) {
    for (let i = 0; i < view.tiles.length; i++) {
      const t = view.tiles[i];
      if (!t?.vis || t.owner !== view.me || view.cities.some((c) => c.at === i)) continue;
      const h = t.res ? HARVEST[t.res] : undefined;
      if (h && view.techs.includes(h.needs) && view.credits >= h.cost) {
        const a: Act = { type: "develop", turn, tile: i, kind: "harvest" };
        if (ok(a)) return a;
      }
      for (const kind of ["farm", "mine", "lumber_camp"] as const) {
        const d = DEVELOP[kind];
        const fits = d.terrain.includes(t.t) && !t.imp && !t.feat && (d.resource ? !!t.res && d.resource.includes(t.res) : t.res === null);
        if (fits && view.techs.includes(d.needs) && view.credits >= d.cost) {
          const a: Act = { type: "develop", turn, tile: i, kind: kind as DevelopKind };
          if (ok(a)) return a;
        }
      }
    }
  }

  // 5. A standing army: about one and a half units per city, more when threatened.
  const threatened = enemies.some((e) => myCities.some((c) => chebyshev(c.at, e.at, size) <= 3));
  const wantUnits = Math.ceil(myCities.length * (level === "hard" ? 2 : 1.5)) + (threatened ? 1 : 0);
  if (mine.length < wantUnits) {
    for (const c of myCities) {
      const m = c.mine!;
      if (m.occupied || m.units >= m.capacity || view.units.some((u) => u.at === c.at)) continue;
      const type = TRAIN_PLAN[level].find(
        (t) => TRAINABLE.includes(t) && (!UNITS[t].needs || view.techs.includes(UNITS[t].needs!)) && view.credits >= UNITS[t].cost,
      );
      if (!type) continue;
      const a: Act = { type: "train", turn, city: m.id, unitType: type };
      if (ok(a)) return a;
    }
  }

  // 6. Research, keeping a little back on easy.
  const reserve = level === "easy" ? 3 : 0;
  const tech = TECH_PLAN[level].find(
    (t) => !view.techs.includes(t) && (!TECHS[t].parent || view.techs.includes(TECHS[t].parent!)),
  );
  if (tech && view.credits >= techCost(tech, view.cityCount) + reserve) {
    const a: Act = { type: "research", turn, tech };
    if (ok(a)) return a;
  }

  // 7. Wounded units heal rather than wander.
  for (const u of mine) {
    const m = u.mine!;
    if (m.done || m.moved || m.attacked || u.hp > u.maxHp * 0.4) continue;
    const a: Act = { type: "heal", turn, unit: u.id };
    if (ok(a)) return a;
  }

  // 8. Move towards something: free villages and enemy cities first, then
  // enemies, then the edge of the known world.
  const move = bestMove(view, mine, enemies, size, level, rng, ok);
  if (move) return move;

  return { type: "end-turn", turn };
}

function bestMove(
  view: DominionPrivateState,
  mine: KnownUnit[],
  enemies: KnownUnit[],
  size: number,
  level: BotLevel,
  rng: Rng,
  ok: (a: Act) => boolean,
): Act | null {
  const occupied = new Set(view.units.map((u) => u.at));
  const prizes: number[] = [];
  view.tiles.forEach((t, i) => {
    if (!t || occupied.has(i)) return;
    if (t.feat === "village" || t.feat === "ruins") prizes.push(i);
  });
  for (const c of view.cities) if (c.owner !== view.me && !occupied.has(c.at)) prizes.push(c.at);
  const frontier: number[] = [];
  view.tiles.forEach((t, i) => {
    if (t && t.t !== "ocean" && t.t !== "shallow" && neighbors(i, size).some((j) => !view.tiles[j])) frontier.push(i);
  });
  const hunt = level === "easy" ? [] : enemies.map((e) => e.at);

  // Lower is better: distance to the nearest goal, prizes weighted most.
  const value = (i: number) => {
    const d = (goals: number[], w: number) => (goals.length ? Math.min(...goals.map((g) => chebyshev(i, g, size))) + w : Infinity);
    return Math.min(d(prizes, 0), d(hunt, 2), d(frontier, 3));
  };

  let best: { a: Act; gain: number } | null = null;
  for (const u of mine) {
    const dests = view.moves[u.id];
    if (!dests?.length) continue;
    // A unit guarding the city it stands on stays home while enemies are near.
    const onCity = view.cities.some((c) => c.at === u.at && c.owner === view.me);
    if (onCity && enemies.some((e) => chebyshev(e.at, u.at, size) <= 2) && level !== "easy") continue;
    const here = value(u.at);
    for (const to of dests) {
      const gain = here - value(to) + rng.next() * 0.1; // jitter breaks ties
      const a: Act = { type: "move", turn: view.turn, unit: u.id, to };
      if (gain > 0.05 && ok(a) && (!best || gain > best.gain)) best = { a, gain };
    }
  }
  return best?.a ?? null;
}
