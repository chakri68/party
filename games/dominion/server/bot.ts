// Computer players (§17). A bot sees exactly what a person in its seat would:
// it decides from its own projection, never the full world, and every action
// it picks goes through the same legality checks as a human's.
//
// It's a weighted priority list rather than a search: claim what's free,
// take favourable fights, grow cities, keep a small army, explore the rest.
// Skill changes how picky and how greedy it is, not what it can see.

import {
  type BuildKind,
  DEVELOP,
  FACTIONS,
  NETWORK,
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
    const kinds: DevelopKind[] = ["harvest", "tend", "absorb", "farm", "mine", "lumber_camp", "grove", "port", "reef_nest", "mill", "forge", "temple", "market"];
    for (let i = 0; i < view.tiles.length; i++) {
      const t = view.tiles[i];
      if (!t?.vis || t.owner !== view.me) continue;
      const ctx = { kind: view.kind, mine: true, open: true, hasCity: view.cities.some((c) => c.at === i), techs: view.techs, credits: view.credits };
      for (const kind of kinds) {
        if (developBlock(kind, t, ctx) !== null) continue;
        // One per city: skip it if one already stands on our land nearby.
        const def = Object.hasOwn(DEVELOP, kind) ? DEVELOP[kind as BuildKind] : undefined;
        if (def?.unique && view.tiles.some((o, j) => o?.imp === def.builds && o?.owner === view.me && chebyshev(i, j, size) <= 2)) continue;
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

  // Rimeborn bridge water by freezing it once a unit's own landmass has
  // nothing worth walking to (see landPlan).
  if (view.credits >= 2) {
    for (const [unit, targets] of Object.entries(view.freezes)) {
      const u = mine.find((m) => m.id === unit)!;
      const plan = landPlan(view, u.at, size);
      if (plan.walk && !sloppy()) continue;
      // Toward the prize if there is one, else toward the unknown.
      const useful =
        plan.toward !== null
          ? [...targets].sort((x, y) => chebyshev(x, plan.toward!, size) - chebyshev(y, plan.toward!, size))[0]
          : targets.find((i) => neighbors(i, size).some((j) => !view.tiles[j]));
      const a: Act | null = useful === undefined ? null : { type: "freeze", turn, unit, target: useful };
      if (a && ok(a)) return a;
    }
  }

  // The Bloom: evolve larvae on the network, and grow the network toward prizes.
  if (FACTIONS[view.kind].network) {
    const a = bloomStep(view, mine, enemies, size, level, ok);
    if (a) return a;
  }

  // Standing on an enemy's mycelium: burn it, unless there's a fight to pick.
  for (const u of mine) {
    const t = view.tiles[u.at];
    if (u.mine!.done || u.vessel || !t?.myc || t.myc === view.me) continue;
    if (view.diplomacy.some((d) => d.id === t.myc && d.relation !== "war") || view.attacks[u.id]?.length) continue;
    const a: Act = { type: "burn", turn, unit: u.id };
    if (ok(a)) return a;
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
      // A faction's own units join the plan by price, priciest first, as the
      // classic plans already run; easy sticks to basics first. One mender is plenty.
      const own = roster.filter((t) => UNITS[t].faction && !(UNITS[t].mender && mine.some((u) => u.type === t)));
      const byPrice = [...own, ...TRAIN_PLAN[level]].sort((x, y) => UNITS[y].cost - UNITS[x].cost);
      // A swarm is its larvae: what can grow into something better comes first.
      const growers = own.filter((t) => UNITS[t].evolvesInto);
      const plan = level === "easy" ? [...TRAIN_PLAN[level], ...own] : [...growers, ...byPrice.filter((t) => !growers.includes(t))];
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
  // Shipless peoples gain nothing from rushing the sea techs.
  const naval: TechId[] = FACTIONS[view.kind].noShips ? [] : wet > 0.5 ? ["fishing", "sailing", "navigation"] : wet > 0.3 ? ["fishing", "sailing"] : [];
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

/** One Bloom move: an evolution or a spread, or nothing worth doing. */
function bloomStep(
  view: DominionPrivateState,
  mine: KnownUnit[],
  enemies: KnownUnit[],
  size: number,
  level: BotLevel,
  ok: (a: Act) => boolean,
): Act | null {
  const turn = view.turn;
  const onNet = (i: number) => view.tiles[i]?.myc === view.me || view.tiles[i]?.owner === view.me;
  // A brood mother first (she pays for herself), then stingers when enemies are close.
  const hasBrood = mine.some((u) => u.type === "brood_mother");
  for (const u of mine) {
    const def = UNITS[u.type];
    const m = u.mine!;
    if (!def.evolvesInto || m.done || m.moved || m.attacked || !onNet(u.at)) continue;
    const threat = enemies.some((e) => chebyshev(e.at, u.at, size) <= 4);
    const pick = def.evolvesInto.find((into) => {
      const d = UNITS[into];
      if (d.needs && !view.techs.includes(d.needs)) return false;
      if (view.credits < d.cost - def.cost + (level === "easy" ? 2 : 0)) return false;
      return into === "brood_mother" ? !hasBrood : threat;
    });
    if (pick) {
      const a: Act = { type: "evolve", turn, unit: u.id, into: pick };
      if (ok(a)) return a;
    }
  }
  // Spread one step toward the nearest prize, keeping enough back for larvae.
  if (view.credits < NETWORK.spreadCost + 4) return null;
  const prizes: number[] = [];
  view.tiles.forEach((t, i) => {
    if (t?.feat === "village" || view.cities.some((c) => c.at === i && c.owner !== view.me)) prizes.push(i);
  });
  if (!prizes.length) return null;
  const dist = (i: number) => Math.min(...prizes.map((p) => chebyshev(i, p, size)));
  let best: { at: number; d: number } | null = null;
  let current = Infinity;
  view.tiles.forEach((t, i) => {
    if (!t) return;
    if (onNet(i)) {
      current = Math.min(current, dist(i));
      return;
    }
    if (!t.vis || t.t === "shallow" || t.t === "ocean" || t.t === "ice") return;
    if (!neighbors(i, size).some(onNet)) return;
    if (t.owner && view.diplomacy.some((d) => d.id === t.owner && d.relation !== "war")) return;
    if (view.units.some((u) => u.at === i && u.owner !== view.me)) return;
    const d = dist(i);
    if (!best || d < best.d) best = { at: i, d };
  });
  const pick = best as { at: number; d: number } | null;
  if (!pick || pick.d >= current) return null;
  const a: Act = { type: "develop", turn, tile: pick.at, kind: "spread" };
  return ok(a) ? a : null;
}

/**
 * Where a unit on foot should look next: a prize (village, rival city or unit)
 * on its own landmass means keep walking; else the nearest one known across the
 * water is worth bridging to; else unexplored edges of its own land; else the
 * unknown beyond the shore.
 */
export function landPlan(view: DominionPrivateState, from: number, size: number): { walk: boolean; toward: number | null } {
  // Ground it can actually walk: mountains only with Climbing.
  const climb = view.techs.includes("climbing");
  const dry = (i: number) => {
    const t = view.tiles[i];
    return !!t && t.t !== "shallow" && t.t !== "ocean" && (climb || t.t !== "mountain");
  };
  // Villages, rival cities, and rivals' units: what the computer goes after anyway.
  const prize = (i: number) =>
    view.tiles[i]?.feat === "village" || view.cities.some((c) => c.at === i && c.owner !== view.me) || view.units.some((u) => u.at === i && u.owner !== view.me);
  const region = new Set([from]);
  const stack = [from];
  let edge = false;
  while (stack.length) {
    const cur = stack.pop()!;
    if (prize(cur)) return { walk: true, toward: null };
    if (neighbors(cur, size).some((j) => !view.tiles[j])) edge = true;
    for (const j of neighbors(cur, size)) {
      if (!region.has(j) && dry(j)) {
        region.add(j);
        stack.push(j);
      }
    }
  }
  let toward: number | null = null;
  view.tiles.forEach((_, i) => {
    if (!region.has(i) && prize(i) && (toward === null || chebyshev(i, from, size) < chebyshev(toward, from, size))) toward = i;
  });
  return { walk: toward === null && edge, toward };
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
