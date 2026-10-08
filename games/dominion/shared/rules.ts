// Rules that both sides need: movement, combat, vision, economy, score. Pure
// and DOM/Node-free (§16); the server resolves actions on top of these.

import {
  CITY_DEFENSE,
  DEMOLISH_COST,
  DEVELOP,
  FACTIONS,
  HARBOURS,
  HARVEST,
  MARKET_CAP,
  PEACE_ROUNDS,
  PEACE_TREATIES,
  PRODUCTION,
  REEF_NEST_NEIGHBOURS,
  ROAD_COST,
  SCORE,
  TERRAIN,
  TECHS,
  TEND,
  techFor,
  techsFor,
  TERRAIN_DEFENSE,
  UNITS,
  VESSELS,
  WALLS_DEFENSE,
} from "./content.ts";
import { area, colOf, inBounds, indexOf, NEIGHBORS, neighbors, rowOf } from "./grid.ts";
import type {
  City,
  DevelopKind,
  DominionState,
  Faction,
  FactionKind,
  Improvement,
  IncomeBreakdown,
  MonumentId,
  Resource,
  TechId,
  Terrain,
  Treaty,
  Unit,
  UnitType,
} from "./types.ts";

export type UnitIndex = Map<number, Unit>;

export function indexUnits(units: Iterable<Unit>): UnitIndex {
  const m: UnitIndex = new Map();
  for (const u of units) m.set(u.at, u);
  return m;
}

export function faction(state: DominionState, id: string | null): Faction | undefined {
  return id === null ? undefined : state.factions.find((f) => f.id === id);
}

/** Same empire, or teammates. Allies never fight, block with zones, or take each other's cities. */
export function allied(state: DominionState, a: string | null, b: string | null): boolean {
  if (a === null || b === null) return false;
  if (a === b) return true;
  const ta = faction(state, a)?.team;
  return ta !== undefined && ta !== null && ta === faction(state, b)?.team;
}

/** The treaty between two empires, if any. A broken one still binds until its notice runs out. */
export function treatyOf(state: DominionState, a: string, b: string): Treaty | undefined {
  return state.treaties?.find((t) => (t.a === a && t.b === b) || (t.a === b && t.b === a));
}

export function atPeace(state: DominionState, a: string | null, b: string | null): boolean {
  return a !== null && b !== null && a !== b && !!treatyOf(state, a, b);
}

/** Fair game: neither allies nor bound by a treaty. */
export function hostile(state: DominionState, a: string | null, b: string | null): boolean {
  return a !== null && b !== null && !allied(state, a, b) && !atPeace(state, a, b);
}

/** Embassies pay and see only while peace holds, notice included or not. */
function embassyActive(state: DominionState, owner: string, partner: string): boolean {
  const t = treatyOf(state, owner, partner);
  return !!t && !t.brokenBy && !!faction(state, owner)?.embassies?.includes(partner);
}

/** Whether `owner` knows `tech`, or the tech its faction swapped in for it. */
export function hasTech(state: DominionState, owner: string, tech: TechId | undefined): boolean {
  if (!tech) return true;
  const f = faction(state, owner);
  return !!f && f.techs.includes(techFor(f.kind, tech));
}

/** Who owns a tile's territory: whoever owns the city that claims it. */
export function tileOwner(state: DominionState, i: number): string | null {
  const claim = state.tiles[i]?.claim;
  return claim ? (state.cities[claim]?.owner ?? null) : null;
}

export interface UnitStats {
  attack: number;
  defense: number;
  move: number;
  range: number;
  vision: number;
}

/** A unit's fighting numbers: its own on land, its vessel's at sea (§9). */
export function statsOf(unit: Pick<Unit, "type" | "vessel">): UnitStats {
  if (unit.vessel) return VESSELS[unit.vessel];
  const d = UNITS[unit.type];
  return { attack: d.attack, defense: d.defense, move: d.move, range: d.range, vision: d.vision ?? UNIT_VISION };
}

export function fullMp(unit: Pick<Unit, "type" | "vessel">): number {
  return statsOf(unit).move * 2;
}

// ---------------------------------------------------------------------------
// Movement (§8)
// ---------------------------------------------------------------------------

/** Terrain a unit could stand on, ignoring who's there. */
export function canStand(state: DominionState, owner: string, i: number): boolean {
  const def = TERRAIN[state.tiles[i]!.t];
  return def.land && hasTech(state, owner, def.needs);
}

/** Water a vessel can enter: shallows always, open ocean with Navigation. */
export function canSail(state: DominionState, owner: string, i: number): boolean {
  const def = TERRAIN[state.tiles[i]!.t];
  return !def.land && hasTech(state, owner, def.needs);
}

/** Where `unit` may stand without a ship: its habitat decides, land by default. */
export function canOccupy(state: DominionState, unit: Pick<Unit, "owner" | "type" | "vessel">, i: number): boolean {
  if (unit.vessel) return canSail(state, unit.owner, i);
  const habitat = UNITS[unit.type].habitat;
  if (habitat === "water") return canSail(state, unit.owner, i);
  if (habitat === "amphibious") return canStand(state, unit.owner, i) || canSail(state, unit.owner, i);
  return canStand(state, unit.owner, i);
}

/** A city built on the water: a reef settlement. */
export function isWaterCity(state: DominionState, i: number): boolean {
  const t = state.tiles[i]!;
  return t.city !== null && !TERRAIN[t.t].land;
}

/** A harbour of yours or an ally's, where land units board: a port, a reef nest, or a reef city. */
export function isFriendlyPort(state: DominionState, owner: string, i: number): boolean {
  const t = state.tiles[i]!;
  const harbour = (t.imp !== null && HARBOURS.includes(t.imp)) || isWaterCity(state, i);
  return harbour && allied(state, tileOwner(state, i), owner);
}

function isRoadLike(state: DominionState, i: number): boolean {
  const t = state.tiles[i]!;
  return t.road || t.city !== null;
}

/** Half-points for `type` to step from `a` into neighbouring `b`. */
export function stepCost(state: DominionState, owner: string, a: number, b: number, type?: UnitType): number {
  const friendly = (i: number) => {
    const o = tileOwner(state, i);
    return o === null || allied(state, o, owner);
  };
  if (isRoadLike(state, a) && isRoadLike(state, b) && friendly(a) && friendly(b)) return ROAD_COST;
  const def = type ? UNITS[type] : undefined;
  const terrain = state.tiles[b]!.t;
  // Fliers pay a plain step whatever is underneath.
  if (def?.flying) return TERRAIN.plains.cost;
  return def?.terrainCost?.[terrain] ?? TERRAIN[terrain].cost;
}

/** Whether this unit may take a village or a city at all. */
export function canCaptureWith(unit: Pick<Unit, "type" | "vessel">): boolean {
  // A ship can only ever be on water, so it captures only reef settlements.
  return !UNITS[unit.type].noCapture;
}

/** Tiles next to a hostile melee unit. Entering one ends the move. */
export function zoneOfControl(state: DominionState, owner: string, units: UnitIndex): Set<number> {
  const zone = new Set<number>();
  for (const u of units.values()) {
    const st = statsOf(u);
    // Partners at peace don't project zones (§8).
    if (!hostile(state, u.owner, owner) || st.range !== 1 || st.attack === 0) continue;
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
  // Not `attacked`: cavalry with Free Spirit may still fall back after a strike.
  if (unit.done || unit.mp <= 0) return out;
  const size = state.size;
  const flying = !unit.vessel && !!UNITS[unit.type].flying;
  // Fliers pass over zones of control (§ special factions).
  const zone = flying ? new Set<number>() : zoneOfControl(state, unit.owner, units);
  const naval = !!unit.vessel;
  // Amphibious and sea creatures walk the water themselves; they never board.
  const native = !naval && !!UNITS[unit.type].habitat;
  // A treaty forbids standing in the partner's cities (§11).
  const offLimits = (i: number) => {
    const c = state.tiles[i]!.city;
    return !!c && atPeace(state, state.cities[c]?.owner ?? null, unit.owner);
  };
  const passable = (i: number) => !offLimits(i) && (flying || canOccupy(state, unit, i));
  // Crossing the shore ends the move: boarding at a port, or landing on empty
  // ground. Neither creates extra movement (§9).
  // Some peoples never set foot on a ship at all.
  const shipless = !!FACTIONS[faction(state, unit.owner)?.kind ?? "orchard"].noShips;
  const crossing = (i: number) =>
    !flying &&
    !native &&
    !shipless &&
    !units.has(i) &&
    (naval
      ? canStand(state, unit.owner, i)
      : isFriendlyPort(state, unit.owner, i) && hasTech(state, unit.owner, "sailing"));
  const best = new Map<number, number>([[unit.at, unit.mp]]);
  const ends = new Set<number>();
  const queue = [unit.at];
  while (queue.length) {
    const cur = queue.shift()!;
    const left = best.get(cur)!;
    if (left <= 0 || ends.has(cur)) continue;
    // Entering a zone of control or ruins stops the unit there.
    if (cur !== unit.at && (zone.has(cur) || state.tiles[cur]!.feat === "ruins")) continue;
    const r = rowOf(cur, size);
    const c = colOf(cur, size);
    for (const [dr, dc] of NEIGHBORS) {
      const rr = r + dr;
      const cc = c + dc;
      if (!inBounds(rr, cc, size)) continue;
      const next = indexOf(rr, cc, size);
      // No squeezing diagonally between two impassable tiles.
      if (dr && dc && !passable(indexOf(r + dr, c, size)) && !passable(indexOf(r, c + dc, size))) continue;
      if (!passable(next) || units.has(next)) {
        if (crossing(next) && !best.has(next)) {
          best.set(next, 0);
          ends.add(next);
        }
        continue;
      }
      const cost = stepCost(state, unit.owner, cur, next, unit.vessel ? undefined : unit.type);
      let remain = left - cost;
      if (remain < 0) {
        if (cur !== unit.at || unit.moved) continue;
        remain = 0;
      }
      if (zone.has(next)) remain = 0;
      if ((best.get(next) ?? -1) < remain) {
        best.set(next, remain);
        ends.delete(next);
        queue.push(next);
      }
    }
  }
  best.delete(unit.at);
  for (const [i, left] of best) {
    // A flier crosses water and peaks but has to come down on land.
    if (flying && !TERRAIN[state.tiles[i]!.t].land) continue;
    out.set(i, left);
  }
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
  const own = unit.vessel ? undefined : UNITS[unit.type].terrainDefense?.[tile.t];
  if (own) best = Math.max(best, own);
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
  const ad = statsOf(attacker);
  const dd = statsOf(defender);
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
  // Siege can't move and shoot in one turn.
  const staticAttack = !unit.vessel && UNITS[unit.type].staticAttack;
  return !unit.done && !unit.attacked && statsOf(unit).attack > 0 && !(staticAttack && unit.moved);
}

/** Enemy units in range that the attacker's owner can see. */
export function attackTargets(state: DominionState, unit: Unit, visibleUnits: UnitIndex): Unit[] {
  if (!canAttackWith(unit)) return [];
  const range = statsOf(unit).range;
  return area(unit.at, range, state.size)
    .map((i) => visibleUnits.get(i))
    .filter((u): u is Unit => !!u && hostile(state, u.owner, unit.owner));
}

// ---------------------------------------------------------------------------
// Vision (§10)
// ---------------------------------------------------------------------------

export const UNIT_VISION = 1;
export const MOUNTAIN_VISION = 2;
export const CITY_VISION = 2;

/**
 * Whether `viewer` sees `unit`. Infiltrators show only to enemies right next to
 * them; everything else shows wherever the viewer can see (§11).
 */
export function canSeeUnit(state: DominionState, viewer: string, unit: Unit, vis: Uint8Array): boolean {
  if (allied(state, viewer, unit.owner)) return true;
  if (!vis[unit.at]) return false;
  if (unit.vessel || !UNITS[unit.type].stealth) return true;
  const share = state.settings.sharedVision;
  const watcher = (owner: string) => owner === viewer || (share && allied(state, owner, viewer));
  const near = (at: number) => chebyshevOf(state, at, unit.at) <= 1;
  return (
    Object.values(state.units).some((u) => watcher(u.owner) && near(u.at)) ||
    Object.values(state.cities).some((c) => c.owner !== null && watcher(c.owner) && near(c.at))
  );
}

function chebyshevOf(state: DominionState, a: number, b: number): number {
  return Math.max(Math.abs(rowOf(a, state.size) - rowOf(b, state.size)), Math.abs(colOf(a, state.size) - colOf(b, state.size)));
}

/** What one empire's own units, cities and land reveal. */
function ownVision(state: DominionState, owner: string, vis: Uint8Array): void {
  for (const u of Object.values(state.units)) {
    if (u.owner !== owner) continue;
    const own = statsOf(u).vision;
    const r = u.vessel ? own : Math.max(own, state.tiles[u.at]!.t === "mountain" ? MOUNTAIN_VISION : UNIT_VISION);
    for (const i of area(u.at, r, state.size)) vis[i] = 1;
  }
  for (const c of Object.values(state.cities)) {
    if (c.owner !== owner) continue;
    for (const i of area(c.at, CITY_VISION, state.size)) vis[i] = 1;
  }
  state.tiles.forEach((t, i) => {
    if (t.claim && state.cities[t.claim]?.owner === owner) vis[i] = 1;
  });
}

/** 1 where `owner` can see right now. With shared vision, that's the whole team's sight. */
export function visionOf(state: DominionState, owner: string): Uint8Array {
  const vis = new Uint8Array(state.tiles.length);
  if (state.settings.fog === "off") return vis.fill(1);
  const f = faction(state, owner);
  if (!f || f.eliminated) return vis;
  const share = state.settings.sharedVision && f.team !== undefined && f.team !== null;
  for (const other of state.factions) {
    if (other.id === owner || (share && !other.eliminated && allied(state, owner, other.id))) ownVision(state, other.id, vis);
  }
  // An embassy shows the partner's capital, and only that (§6).
  for (const partner of f.embassies ?? []) {
    if (!embassyActive(state, owner, partner)) continue;
    const capital = capitalOf(state, partner);
    if (capital) for (const i of area(capital.at, 1, state.size)) vis[i] = 1;
  }
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
  // Roads first, from the capital.
  const seen = new Set<number>();
  const byRoad = (from: number) => {
    const stack = [from];
    seen.add(from);
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
  };
  byRoad(capital.at);
  // Then ports: two of yours on the same water link their cities, and each
  // newly linked city's roads count too. Ocean joins waters only with Navigation.
  const water = waterComponents(state, hasTech(state, owner, "navigation"));
  // A reef city is its own harbour.
  const portsOf = (cityId: string) =>
    state.tiles.flatMap((t, i) =>
      (t.claim === cityId && t.imp !== null && HARBOURS.includes(t.imp) && t.city === null) || (t.city === cityId && water[i]! >= 0)
        ? [water[i]!]
        : [],
    );
  for (let grew = true; grew; ) {
    grew = false;
    const reached = new Set([...out].flatMap(portsOf));
    for (const c of ownedCities(state, owner)) {
      if (out.has(c.id) || !portsOf(c.id).some((w) => reached.has(w))) continue;
      byRoad(c.at);
      grew = true;
    }
  }
  out.delete(capital.id);
  return out;
}

/** Connected bodies of water: shallows, plus ocean if `withOcean`. */
export function waterComponents(state: DominionState, withOcean: boolean): Int32Array {
  const comp = new Int32Array(state.tiles.length).fill(-1);
  const wet = (i: number) => state.tiles[i]!.t === "shallow" || (withOcean && state.tiles[i]!.t === "ocean");
  let next = 0;
  for (let i = 0; i < state.tiles.length; i++) {
    if (comp[i] !== -1 || !wet(i)) continue;
    const stack = [i];
    comp[i] = next;
    while (stack.length) {
      const cur = stack.pop()!;
      for (const n of neighbors(cur, state.size)) {
        if (comp[n] === -1 && wet(n)) {
          comp[n] = next;
          stack.push(n);
        }
      }
    }
    next++;
  }
  return comp;
}

/** +1 per production improvement next to the city's market, in the same city, up to the cap (§6). */
export function marketIncome(state: DominionState, city: City): number {
  let total = 0;
  state.tiles.forEach((t, i) => {
    if (t.claim !== city.id || t.imp !== "market") return;
    const near = neighbors(i, state.size).filter((j) => {
      const n = state.tiles[j]!;
      return n.claim === city.id && n.imp !== null && PRODUCTION.includes(n.imp);
    }).length;
    total += Math.min(MARKET_CAP, near);
  });
  return total;
}

/** Wildwood: untouched forest (bare, or a grove) in the city's land pays, up to a cap. */
export function forestIncome(state: DominionState, city: City): number {
  const rule = city.owner ? FACTIONS[faction(state, city.owner)?.kind ?? "orchard"].forestIncome : undefined;
  if (!rule) return 0;
  const n = state.tiles.filter((t) => t.claim === city.id && t.t === "forest" && (t.imp === null || t.imp === "grove")).length;
  return Math.min(rule.cap, Math.floor(n / rule.per));
}

/** +1 per reef nest with enough fish or reef settlements beside it. */
export function reefIncome(state: DominionState, city: City): number {
  let n = 0;
  state.tiles.forEach((t, i) => {
    if (t.claim !== city.id || t.imp !== "reef_nest") return;
    const good = neighbors(i, state.size).filter((j) => {
      const nt = state.tiles[j]!;
      return nt.res === "fish" || ((nt.feat === "village" || nt.city !== null) && !TERRAIN[nt.t].land);
    }).length;
    if (good >= REEF_NEST_NEIGHBOURS) n++;
  });
  return n;
}

export function cityIncome(state: DominionState, city: City, units: UnitIndex, connected?: Set<string>): IncomeBreakdown {
  const zero = { level: 0, workshop: 0, capital: 0, connection: 0, market: 0, forest: 0, reef: 0, total: 0 };
  if (!city.owner || isOccupied(city, units) || city.sabotaged) return zero;
  const links = connected ?? connectedCities(state, city.owner);
  const b = {
    level: city.level,
    workshop: city.workshop ? 1 : 0,
    capital: city.capitalOf === city.owner ? 1 : 0,
    connection: links.has(city.id) ? 1 : 0,
    market: marketIncome(state, city),
    forest: forestIncome(state, city),
    reef: reefIncome(state, city),
    total: 0,
  };
  b.total = b.level + b.workshop + b.capital + b.connection + b.market + b.forest + b.reef;
  return b;
}

export function totalIncome(state: DominionState, owner: string): number {
  const units = indexUnits(Object.values(state.units));
  const links = connectedCities(state, owner);
  return ownedCities(state, owner).reduce((sum, c) => sum + cityIncome(state, c, units, links).total, 0) + embassyIncome(state, owner);
}

/** +1 per embassy whose host is at peace with you. */
export function embassyIncome(state: DominionState, owner: string): number {
  return (faction(state, owner)?.embassies ?? []).filter((p) => embassyActive(state, owner, p)).length;
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
    f.kills * SCORE.kill +
    (f.monuments?.earned.length ?? 0) * SCORE.monument +
    templeCulture(state, owner)
  );
}

/** Score gathered by temples on the empire's land. */
export function templeCulture(state: DominionState, owner: string): number {
  let total = 0;
  state.tiles.forEach((t) => {
    if (t.culture && t.claim && state.cities[t.claim]?.owner === owner) total += t.culture;
  });
  return total;
}

// ---------------------------------------------------------------------------
// Development options, from what a player knows of a tile (§6). The server
// adds what only it can check: one-per-city buildings and population credit.
// ---------------------------------------------------------------------------

export interface DevTile {
  t: Terrain;
  res: Resource | null;
  imp: Improvement | null;
  road: boolean;
  feat: string | null;
  tended?: boolean;
}

/**
 * undefined: not an option here at all. A string: possible in principle, but
 * not now, and why. null: go ahead.
 */
export function developBlock(
  kind: DevelopKind,
  tile: DevTile,
  ctx: { kind: FactionKind; mine: boolean; open: boolean; hasCity: boolean; techs: readonly TechId[]; credits: number },
): string | null | undefined {
  const need = (tech: TechId) => (ctx.techs.includes(tech) ? null : `Needs ${TECHS[tech].name}`);
  const pay = (cost: number) => (ctx.credits < cost ? "Not enough credits" : null);
  const rules = FACTIONS[ctx.kind];
  if (ctx.hasCity) return undefined;
  if (kind === "harvest" || kind === "tend") {
    // Tending factions tend; everyone else harvests. Never both.
    if ((kind === "tend") !== !!rules.tends) return undefined;
    const h = tile.res ? HARVEST[tile.res] : undefined;
    if (!h || !ctx.mine || (kind === "tend" && tile.tended)) return undefined;
    return need(techFor(ctx.kind, h.needs)) ?? pay(kind === "tend" ? TEND.cost : h.cost);
  }
  if (kind === "demolish") {
    if (!ctx.mine || !tile.imp || tile.imp === "monument") return undefined;
    return need("construction") ?? pay(DEMOLISH_COST);
  }
  if (rules.forbids?.includes(kind)) return undefined;
  // Roads on ice are their own tech, and only for those who can learn it.
  if (kind === "road" && tile.t === "ice") {
    if (!techsFor(ctx.kind).includes("ice_roads") || tile.road || !(ctx.mine || ctx.open) || tile.feat) return undefined;
    return need("ice_roads") ?? pay(DEVELOP.road.cost);
  }
  const def = DEVELOP[kind];
  if (!def.terrain.includes(tile.t) || tile.feat) return undefined;
  if (kind === "road") {
    if (tile.road || !(ctx.mine || ctx.open)) return undefined;
  } else {
    if (!ctx.mine || tile.imp) return undefined;
    if (def.resource ? !tile.res || !def.resource.includes(tile.res) : tile.res !== null) return undefined;
  }
  return need(def.needs) ?? pay(def.cost);
}

/**
 * Water `owner` could freeze from a unit at `from`: shallows next to it (ocean
 * too with Deep freeze), empty of cities, improvements, features and visible
 * units, and outside any treaty partner's land.
 */
export function freezeTargets(state: DominionState, owner: string, from: number, units: UnitIndex): number[] {
  const f = faction(state, owner);
  if (!f?.techs.includes("frostcraft")) return [];
  return neighbors(from, state.size).filter((i) => {
    const t = state.tiles[i]!;
    const water = t.t === "shallow" || (t.t === "ocean" && f.techs.includes("deep_freeze"));
    return water && !t.city && !t.imp && !t.feat && !units.has(i) && !atPeace(state, tileOwner(state, i), owner);
  });
}

// ---------------------------------------------------------------------------
// Achievements (§13)
// ---------------------------------------------------------------------------

export function achievementProgress(state: DominionState, id: string): { kind: MonumentId; progress: number; goal: number }[] {
  const f = faction(state, id)!;
  const explored = f.memory.seen.filter((x) => x >= 0).length;
  return [
    { kind: "research", progress: f.techs.length, goal: 10 },
    { kind: "trade", progress: connectedCities(state, id).size, goal: 5 },
    // Of every tile on the map, never a breakdown that hints at hidden terrain.
    { kind: "exploration", progress: Math.floor((explored / state.tiles.length) * 100), goal: 80 },
    { kind: "battle", progress: f.kills, goal: 10 },
    {
      kind: "peace",
      progress: (state.treaties ?? []).filter(
        (t) => (t.a === id || t.b === id) && !t.brokenBy && state.round - t.since >= PEACE_ROUNDS,
      ).length,
      goal: PEACE_TREATIES,
    },
  ];
}

