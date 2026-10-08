// Rules that both sides need: movement, combat, vision, economy, score. Pure
// and DOM/Node-free (§16); the server resolves actions on top of these.

import {
  CITY_DEFENSE,
  ROAD_COST,
  SCORE,
  TERRAIN,
  TERRAIN_DEFENSE,
  UNITS,
  WALLS_DEFENSE,
} from "./content.ts";
import { area, colOf, inBounds, indexOf, NEIGHBORS, neighbors, rowOf } from "./grid.ts";
import type { City, DominionState, Faction, IncomeBreakdown, TechId, Unit } from "./types.ts";

export type UnitIndex = Map<number, Unit>;

export function indexUnits(units: Iterable<Unit>): UnitIndex {
  const m: UnitIndex = new Map();
  for (const u of units) m.set(u.at, u);
  return m;
}

export function faction(state: DominionState, id: string | null): Faction | undefined {
  return id === null ? undefined : state.factions.find((f) => f.id === id);
}

export function hasTech(state: DominionState, owner: string, tech: TechId | undefined): boolean {
  return !tech || !!faction(state, owner)?.techs.includes(tech);
}

/** Who owns a tile's territory: whoever owns the city that claims it. */
export function tileOwner(state: DominionState, i: number): string | null {
  const claim = state.tiles[i]?.claim;
  return claim ? (state.cities[claim]?.owner ?? null) : null;
}

export function fullMp(unit: Pick<Unit, "type">): number {
  return UNITS[unit.type].move * 2;
}

// ---------------------------------------------------------------------------
// Movement (§8)
// ---------------------------------------------------------------------------

/** Terrain a unit could stand on, ignoring who's there. */
export function canStand(state: DominionState, owner: string, i: number): boolean {
  const def = TERRAIN[state.tiles[i]!.t];
  return def.land && hasTech(state, owner, def.needs);
}

function isRoadLike(state: DominionState, i: number): boolean {
  const t = state.tiles[i]!;
  return t.road || t.city !== null;
}

/** Half-points to step from `a` into neighbouring `b`. */
export function stepCost(state: DominionState, owner: string, a: number, b: number): number {
  const friendly = (i: number) => {
    const o = tileOwner(state, i);
    return o === null || o === owner;
  };
  if (isRoadLike(state, a) && isRoadLike(state, b) && friendly(a) && friendly(b)) return ROAD_COST;
  return TERRAIN[state.tiles[b]!.t].cost;
}

/** Tiles next to a hostile melee unit. Entering one ends the move. */
export function zoneOfControl(state: DominionState, owner: string, units: UnitIndex): Set<number> {
  const zone = new Set<number>();
  for (const u of units.values()) {
    if (u.owner === owner || UNITS[u.type].range !== 1) continue;
    for (const n of neighbors(u.at, state.size)) zone.add(n);
  }
  return zone;
}

/**
 * Where `unit` can end its move this turn, with the movement left on arrival.
 * `units` is whatever the mover can see: the server validates against the
 * mover's own view, so a hidden unit can't be probed by trying moves.
 *
 * A unit that hasn't moved yet can always take one step into any passable
 * neighbour, even one that costs more than it has: otherwise a 1-move unit
 * could never enter a forest.
 */
export function reachable(state: DominionState, unit: Unit, units: UnitIndex): Map<number, number> {
  const out = new Map<number, number>();
  if (unit.done || unit.attacked || unit.mp <= 0) return out;
  const size = state.size;
  const zone = zoneOfControl(state, unit.owner, units);
  const free = (i: number) => canStand(state, unit.owner, i) && !units.has(i);
  const best = new Map<number, number>([[unit.at, unit.mp]]);
  const queue = [unit.at];
  while (queue.length) {
    const cur = queue.shift()!;
    const left = best.get(cur)!;
    if (left <= 0) continue;
    // Entering a zone of control or ruins stops the unit there.
    if (cur !== unit.at && (zone.has(cur) || state.tiles[cur]!.feat === "ruins")) continue;
    const r = rowOf(cur, size);
    const c = colOf(cur, size);
    for (const [dr, dc] of NEIGHBORS) {
      const rr = r + dr;
      const cc = c + dc;
      if (!inBounds(rr, cc, size)) continue;
      const next = indexOf(rr, cc, size);
      if (!free(next)) continue;
      // No squeezing diagonally between two impassable tiles.
      if (dr && dc && !canStand(state, unit.owner, indexOf(r + dr, c, size)) && !canStand(state, unit.owner, indexOf(r, c + dc, size))) {
        continue;
      }
      const cost = stepCost(state, unit.owner, cur, next);
      let remain = left - cost;
      if (remain < 0) {
        if (cur !== unit.at || unit.moved) continue;
        remain = 0;
      }
      if (zone.has(next)) remain = 0;
      if ((best.get(next) ?? -1) < remain) {
        best.set(next, remain);
        queue.push(next);
      }
    }
  }
  best.delete(unit.at);
  for (const [i, left] of best) out.set(i, left);
  return out;
}

// ---------------------------------------------------------------------------
// Combat (§8). Original draft numbers, deterministic, previewable.
// ---------------------------------------------------------------------------

export function defenseMultiplier(state: DominionState, unit: Unit): number {
  const tile = state.tiles[unit.at]!;
  let best = 1;
  const city = tile.city ? state.cities[tile.city] : undefined;
  if (city && city.owner === unit.owner) best = Math.max(best, city.walls ? WALLS_DEFENSE : CITY_DEFENSE);
  const tech = TERRAIN[tile.t].defenseTech;
  if (tech && hasTech(state, unit.owner, tech)) best = Math.max(best, TERRAIN_DEFENSE);
  return best;
}

interface Fighter {
  attack: number;
  hp: number;
  maxHp: number;
}

/** One strike. `defMult` is the receiver's best defense bonus. */
export function strike(
  attacker: Fighter,
  defender: { defense: number; hp: number; maxHp: number },
  defMult: number,
): number {
  const a = (attacker.attack * attacker.hp) / attacker.maxHp;
  const d = ((defender.defense * defender.hp) / defender.maxHp) * defMult;
  const raw = a + d === 0 ? 1 : Math.round((4.5 * attacker.attack * a) / (a + d));
  return Math.min(Math.max(raw, 1), defender.hp);
}

export interface CombatResult {
  damage: number;
  retaliation: number;
}

export function resolveCombat(state: DominionState, attacker: Unit, defender: Unit): CombatResult {
  const ad = UNITS[attacker.type];
  const dd = UNITS[defender.type];
  const damage = strike(
    { attack: ad.attack, hp: attacker.hp, maxHp: attacker.maxHp },
    { defense: dd.defense, hp: defender.hp, maxHp: defender.maxHp },
    defenseMultiplier(state, defender),
  );
  const left = defender.hp - damage;
  const dist = Math.max(
    Math.abs(rowOf(attacker.at, state.size) - rowOf(defender.at, state.size)),
    Math.abs(colOf(attacker.at, state.size) - colOf(defender.at, state.size)),
  );
  const retaliation =
    left > 0 && dist <= dd.range
      ? strike(
          { attack: dd.attack, hp: left, maxHp: defender.maxHp },
          { defense: ad.defense, hp: attacker.hp, maxHp: attacker.maxHp },
          defenseMultiplier(state, attacker),
        )
      : 0;
  return { damage, retaliation };
}

export function canAttackWith(unit: Unit): boolean {
  return !unit.done && !unit.attacked && UNITS[unit.type].attack > 0;
}

/** Enemy units in range that the attacker's owner can see. */
export function attackTargets(state: DominionState, unit: Unit, visibleUnits: UnitIndex): Unit[] {
  if (!canAttackWith(unit)) return [];
  const range = UNITS[unit.type].range;
  return area(unit.at, range, state.size)
    .map((i) => visibleUnits.get(i))
    .filter((u): u is Unit => !!u && u.owner !== unit.owner);
}

// ---------------------------------------------------------------------------
// Vision (§10)
// ---------------------------------------------------------------------------

export const UNIT_VISION = 1;
export const MOUNTAIN_VISION = 2;
export const CITY_VISION = 2;

/** 1 where `owner` can see right now. */
export function visionOf(state: DominionState, owner: string): Uint8Array {
  const vis = new Uint8Array(state.tiles.length);
  if (state.settings.fog === "off") return vis.fill(1);
  const f = faction(state, owner);
  if (!f || f.eliminated) return vis;
  for (const u of Object.values(state.units)) {
    if (u.owner !== owner) continue;
    const r = state.tiles[u.at]!.t === "mountain" ? MOUNTAIN_VISION : UNIT_VISION;
    for (const i of area(u.at, r, state.size)) vis[i] = 1;
  }
  for (const c of Object.values(state.cities)) {
    if (c.owner !== owner) continue;
    for (const i of area(c.at, CITY_VISION, state.size)) vis[i] = 1;
  }
  state.tiles.forEach((t, i) => {
    if (t.claim && state.cities[t.claim]?.owner === owner) vis[i] = 1;
  });
  return vis;
}

// ---------------------------------------------------------------------------
// Cities & economy (§6)
// ---------------------------------------------------------------------------

/** Population needed to reach the next level: 2 for level 2, then the level itself. */
export function nextLevelAt(level: number): number {
  return level + 1;
}

export function ownedCities(state: DominionState, owner: string): City[] {
  return Object.values(state.cities).filter((c) => c.owner === owner);
}

/** An enemy unit standing in the city: no income, no training. */
export function isOccupied(city: City, units: UnitIndex): boolean {
  const u = units.get(city.at);
  return !!u && u.owner !== city.owner;
}

export function capacity(city: City): number {
  return city.level + 1;
}

export function homedUnits(state: DominionState, cityId: string): number {
  let n = 0;
  for (const u of Object.values(state.units)) if (u.home === cityId) n++;
  return n;
}

export function capitalOf(state: DominionState, owner: string): City | undefined {
  return Object.values(state.cities).find((c) => c.capitalOf === owner && c.owner === owner);
}

/**
 * Cities linked to the capital through roads and own cities. Hostile territory
 * breaks a link; nobody gets free use of a rival's roads.
 */
export function connectedCities(state: DominionState, owner: string): Set<string> {
  const capital = capitalOf(state, owner);
  const out = new Set<string>();
  if (!capital) return out;
  const seen = new Set([capital.at]);
  const stack = [capital.at];
  while (stack.length) {
    const cur = stack.pop()!;
    const t = state.tiles[cur]!;
    if (t.city) out.add(t.city);
    for (const n of neighbors(cur, state.size)) {
      if (seen.has(n)) continue;
      const nt = state.tiles[n]!;
      const owned = nt.city ? state.cities[nt.city]!.owner === owner : false;
      const o = tileOwner(state, n);
      if (owned || (nt.road && (o === null || o === owner))) {
        seen.add(n);
        stack.push(n);
      }
    }
  }
  out.delete(capital.id);
  return out;
}

export function cityIncome(state: DominionState, city: City, units: UnitIndex, connected?: Set<string>): IncomeBreakdown {
  const zero = { level: 0, workshop: 0, capital: 0, connection: 0, total: 0 };
  if (!city.owner || isOccupied(city, units)) return zero;
  const links = connected ?? connectedCities(state, city.owner);
  const b = {
    level: city.level,
    workshop: city.workshop ? 1 : 0,
    capital: city.capitalOf === city.owner ? 1 : 0,
    connection: links.has(city.id) ? 1 : 0,
    total: 0,
  };
  b.total = b.level + b.workshop + b.capital + b.connection;
  return b;
}

export function totalIncome(state: DominionState, owner: string): number {
  const units = indexUnits(Object.values(state.units));
  const links = connectedCities(state, owner);
  return ownedCities(state, owner).reduce((sum, c) => sum + cityIncome(state, c, units, links).total, 0);
}

// ---------------------------------------------------------------------------
// Score (§13)
// ---------------------------------------------------------------------------

export function exploredCount(f: Faction): number {
  return f.memory.seen.reduce((n, s) => n + (s >= 0 ? 1 : 0), 0);
}

export function scoreOf(state: DominionState, owner: string): number {
  const f = faction(state, owner);
  if (!f) return 0;
  const cities = ownedCities(state, owner);
  return (
    cities.reduce((s, c) => s + c.level * SCORE.cityLevel + c.parks * SCORE.park, 0) +
    f.techs.length * SCORE.tech +
    exploredCount(f) * SCORE.explored +
    f.kills * SCORE.kill
  );
}
