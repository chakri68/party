// Computer players (§17). A bot sees exactly what a person in its seat would:
// it decides from its own projection, never the full world, and every action
// it picks goes through the same legality checks as a human's.
//
// It's a weighted priority list rather than a search: claim what's free,
// take favourable fights, grow cities, keep a small army, explore the rest.
// Skill changes how picky and how greedy it is, not what it can see.

import {
  parentFor,
  rewardChoices,
  VESSELS,
  techCost,
  techFor,
  techsFor,
  trainableFor,
  UNITS,
} from "../shared/content.ts";
import { chebyshev, neighbors, type Rng } from "../shared/grid.ts";
import { developBlock } from "../shared/rules.ts";
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
  easy: ["gathering", "hunting", "fishing", "riding", "farming", "forestry", "climbing", "archery", "mining", "roads", "strategy", "meditation", "metallurgy", "construction", "spirituality", "commerce", "sailing"],
  normal: [
    "gathering", "hunting", "riding", "fishing", "archery", "farming", "forestry", "climbing", "mining",
    "free_spirit", "chivalry", "construction", "roads", "commerce", "strategy", "metallurgy", "spirituality",
    "sailing", "mathematics", "meditation", "philosophy", "navigation", "diplomacy",
  ],
  hard: [
    "riding", "hunting", "gathering", "free_spirit", "chivalry", "archery", "climbing", "mining", "metallurgy",
    "farming", "construction", "forestry", "mathematics", "roads", "commerce", "meditation", "philosophy",
    "fishing", "sailing", "navigation", "strategy", "spirituality", "diplomacy",
  ],
};

/** What it trains, best first. Easy keeps it simple. */
const TRAIN_PLAN: Record<BotLevel, UnitType[]> = {
  easy: ["infantry"],
  normal: ["knight", "cavalry", "archer", "infantry"],
  hard: ["knight", "swordsman", "cavalry", "archer", "defender", "infantry"],
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

  // 0. Peace offers: easy and normal take them; hard takes about half.
  for (const d of view.diplomacy) {
    if (!d.offerFromThem) continue;
    const accept = level !== "hard" || rng.chance(0.5);
    const a = { type: "answer-peace", from: d.id, accept } as const;
    if (ok(a)) return a;
  }
  // Embassies with peace partners pay for themselves in five turns.
  if (view.techs.includes("diplomacy") && view.credits >= 10) {
    const partner = view.diplomacy.find((d) => d.relation === "peace" && !d.embassy);
    if (partner) {
      const a: Act = { type: "embassy", turn, with: partner.id };
      if (ok(a)) return a;
    }
  }

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
    if (UNITS[u.type].noCapture) continue;
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

  // 4. Grow: monuments first (free population), then harvest and build.
  if (view.monumentsToPlace > 0) {
    const spot = view.tiles.findIndex(
      (t, i) => t?.vis && t.owner === view.me && !t.imp && !t.feat && !t.res && t.t !== "shallow" && t.t !== "ocean" && !view.cities.some((c) => c.at === i),
    );
    if (spot >= 0) {
      const a: Act = { type: "monument", turn, tile: spot };
      if (ok(a)) return a;
    }
  }
  if (!sloppy()) {
    const kinds: DevelopKind[] = ["harvest", "tend", "farm", "mine", "lumber_camp", "grove", "port", "reef_nest", "mill", "forge", "temple", "market"];
    for (let i = 0; i < view.tiles.length; i++) {
      const t = view.tiles[i];
      if (!t?.vis || t.owner !== view.me) continue;
      const ctx = { kind: view.kind, mine: true, open: true, hasCity: view.cities.some((c) => c.at === i), techs: view.techs, credits: view.credits };
      for (const kind of kinds) {
        if (developBlock(kind, t, ctx) !== null) continue;
        const a: Act = { type: "develop", turn, tile: i, kind };
        if (ok(a)) return a;
      }
    }
  }

  // Menders (dryads, sages) patch up whoever's hurt beside them.
  for (const u of mine) {
    const def = UNITS[u.type];
    if (!(def.mender || def.sage) || u.mine!.done || u.mine!.attacked) continue;
    const hurt = mine.some((o) => o !== u && o.hp < o.maxHp && chebyshev(o.at, u.at, size) <= 1);
    const a: Act = { type: "mend", turn, unit: u.id };
    if (hurt && ok(a)) return a;
  }

  // Sages turn enemies rather than fight them.
  if (level !== "easy") {
    for (const [unit, targets] of Object.entries(view.converts)) {
      const a: Act = { type: "convert", turn, unit, target: targets[0]! };
      if (ok(a)) return a;
    }
  }

  // 5. A standing army: about one and a half units per city, more when threatened.
  const threatened = enemies.some((e) => myCities.some((c) => chebyshev(c.at, e.at, size) <= 3));
  const wantUnits = Math.ceil(myCities.length * (level === "hard" ? 2 : 1.5)) + (threatened ? 1 : 0);
  if (mine.length < wantUnits) {
    for (const c of myCities) {
      const m = c.mine!;
      if (m.occupied || m.units >= m.capacity || view.units.some((u) => u.at === c.at)) continue;
      const roster = trainableFor(view.kind);
      // A faction's own units lead, except on easy, which sticks to basics first.
      // Best first; one mender is plenty.
      const own = roster
        .filter((t) => UNITS[t].faction && !(UNITS[t].mender && mine.some((u) => u.type === t)))
        .sort((x, y) => UNITS[y].cost - UNITS[x].cost);
      const plan = level === "easy" ? [...TRAIN_PLAN[level], ...own] : [...own, ...TRAIN_PLAN[level]];
      const type = plan.find(
        (t) => roster.includes(t) && (!UNITS[t].needs || view.techs.includes(UNITS[t].needs!)) && view.credits >= UNITS[t].cost,
      );
      if (!type) continue;
      const a: Act = { type: "train", turn, city: m.id, unitType: type };
      if (ok(a)) return a;
    }
  }

  // 6. Research, keeping a little back on easy.
  const reserve = level === "easy" ? 3 : 0;
  // An empire hemmed in by water goes to sea before anything else.
  const known = view.tiles.filter((t) => t !== null);
  const wet = known.filter((t) => t!.t === "shallow" || t!.t === "ocean").length / Math.max(1, known.length);
  const naval: TechId[] = wet > 0.5 ? ["fishing", "sailing", "navigation"] : wet > 0.3 ? ["fishing", "sailing"] : [];
  // The classic plan read through the faction's swaps, then anything of its own left over.
  const tree = techsFor(view.kind);
  const plan = [...naval, ...TECH_PLAN[level]].map((t) => techFor(view.kind, t));
  const tech = [...plan, ...tree].find((t) => {
    const parent = parentFor(view.kind, t);
    return tree.includes(t) && !view.techs.includes(t) && (!parent || view.techs.includes(parent));
  });
  if (tech && view.credits >= techCost(tech, view.cityCount, view.techs) + reserve) {
    const a: Act = { type: "research", turn, tech };
    if (ok(a)) return a;
  }

  // Transports that can be warships, on normal and hard.
  if (level !== "easy") {
    const vessel = (["bomber", "rammer", "scout"] as const).find(
      (v) => view.techs.includes(VESSELS[v].needs) && view.credits >= VESSELS[v].cost + 4,
    );
    const boat = mine.find((u) => u.vessel === "transport" && !u.mine!.done && !u.mine!.attacked);
    if (vessel && boat) {
      const a: Act = { type: "upgrade", turn, unit: boat.id, vessel };
      if (ok(a)) return a;
    }
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
  const wetFrontier: number[] = [];
  view.tiles.forEach((t, i) => {
    if (!t || !neighbors(i, size).some((j) => !view.tiles[j])) return;
    (t.t !== "ocean" && t.t !== "shallow" ? frontier : wetFrontier).push(i);
  });
  const hunt = level === "easy" ? [] : enemies.map((e) => e.at);
  const wet = (i: number) => view.tiles[i]?.t === "shallow" || view.tiles[i]?.t === "ocean";

  // Lower is better: distance to the nearest goal, prizes weighted most.
  // Amphibious units explore the shallows too; sea creatures only the sea.
  const value = (u: KnownUnit, i: number) => {
    const habitat = u.vessel ? undefined : UNITS[u.type].habitat;
    const d = (goals: number[], w: number) => (goals.length ? Math.min(...goals.map((g) => chebyshev(i, g, size))) + w : Infinity);
    const edge = habitat === "water" ? wetFrontier : habitat === "amphibious" ? [...frontier, ...wetFrontier] : frontier;
    const loot = habitat === "water" ? [] : prizes.filter((p) => habitat === "amphibious" || !wet(p) || !!u.vessel);
    return Math.min(d(loot, 0), d(hunt, 2), d(edge, 3));
  };

  let best: { a: Act; gain: number } | null = null;
  for (const u of mine) {
    const dests = view.moves[u.id];
    if (!dests?.length) continue;
    // A unit guarding the city it stands on stays home while enemies are near.
    const onCity = view.cities.some((c) => c.at === u.at && c.owner === view.me);
    if (onCity && enemies.some((e) => chebyshev(e.at, u.at, size) <= 2) && level !== "easy") continue;
    const here = value(u, u.at);
    for (const to of dests) {
      const gain = here - value(u, to) + rng.next() * 0.1; // jitter breaks ties
      const a: Act = { type: "move", turn: view.turn, unit: u.id, to };
      if (gain > 0.05 && ok(a) && (!best || gain > best.gain)) best = { a, gain };
    }
  }
  return best?.a ?? null;
}
