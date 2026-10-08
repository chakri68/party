// Per-recipient projections (§10). The browser gets what its player knows and
// nothing else: no seed, no hidden units, no current state of fogged tiles.

import { ICE, UNITS, VETERAN_KILLS } from "../shared/content.ts";
import { neighbors } from "../shared/grid.ts";
import { decodeTile } from "../shared/memory.ts";
import {
  achievementProgress,
  allied,
  canSeeUnit,
  treatyOf,
  attackTargets,
  canCaptureWith,
  freezeTargets,
  capacity,
  cityIncome,
  connectedCities,
  faction,
  homedUnits,
  indexUnits,
  isOccupied,
  nextLevelAt,
  ownedCities,
  reachable,
  resolveCombat,
  scoreOf,
  tileOwner,
  totalIncome,
  visionOf,
  type UnitIndex,
} from "../shared/rules.ts";
import type {
  AttackOption,
  DominionPrivateState,
  DominionState,
  KnownCity,
  KnownTile,
  KnownUnit,
  Unit,
} from "../shared/types.ts";

/** Units `owner` can see right now: their own, plus anyone on a visible tile. */
export function visibleUnits(state: DominionState, owner: string, vis = visionOf(state, owner)): UnitIndex {
  return indexUnits(Object.values(state.units).filter((u) => u.owner === owner || canSeeUnit(state, owner, u, vis)));
}

function knownUnit(u: Unit, me: string): KnownUnit {
  const base: KnownUnit = {
    id: u.id,
    type: u.type,
    owner: u.owner,
    at: u.at,
    hp: u.hp,
    maxHp: u.maxHp,
    veteran: u.veteran,
    vessel: u.vessel ?? null,
    ...(u.chilled && { chilled: true }),
    ...(u.poison && { poisoned: true }),
  };
  if (u.owner !== me) return base;
  return {
    ...base,
    mine: {
      kills: u.kills,
      mp: u.mp,
      moved: u.moved,
      attacked: u.attacked,
      done: u.done,
      settled: u.settled,
      home: u.home,
      ...(UNITS[u.type].matures && { maturesIn: UNITS[u.type].matures!.turns - (u.age ?? 0) }),
    },
  };
}

export function projectFor(state: DominionState, me: string): DominionPrivateState {
  const f = faction(state, me);
  const empty: DominionPrivateState = {
    me,
    kind: f?.kind ?? "orchard",
    myTurn: false,
    turn: state.turn,
    tiles: state.tiles.map(() => null),
    units: [],
    cities: [],
    credits: 0,
    income: 0,
    techs: [],
    cityCount: 0,
    score: 0,
    moves: {},
    attacks: {},
    idleUnits: [],
    eliminated: true,
    achievements: [],
    monumentsToPlace: 0,
    converts: {},
    freezes: {},
    diplomacy: [],
  };
  if (!f) return empty;

  // Fog lifts for everyone once it's over.
  const finished = state.phase === "finished";
  const vis = finished ? new Uint8Array(state.tiles.length).fill(1) : visionOf(state, me);
  const truth = indexUnits(Object.values(state.units));
  const seen = finished ? truth : visibleUnits(state, me, vis);

  const tiles: (KnownTile | null)[] = state.tiles.map((t, i) => {
    if (vis[i]) {
      return {
        t: t.t,
        res: t.res,
        imp: t.imp,
        road: t.road,
        feat: t.feat,
        owner: tileOwner(state, i),
        vis: true,
        seen: state.round,
        ...(t.tended && { tended: true }),
        ...(t.myc && { myc: t.myc }),
      };
    }
    const code = f.memory.codes[i]!;
    if (code < 0) return null;
    const d = decodeTile(code);
    return {
      t: d.t,
      res: d.res,
      imp: d.imp,
      road: d.road,
      feat: d.feat,
      owner: d.ownerSeat >= 0 ? (state.factions[d.ownerSeat]?.id ?? null) : null,
      vis: false,
      seen: f.memory.seen[i]!,
      ...(d.mycSeat >= 0 && { myc: state.factions[d.mycSeat]?.id }),
    };
  });

  const links = connectedCities(state, me);
  const cities: KnownCity[] = [];
  for (const c of Object.values(state.cities)) {
    if (c.owner === me) {
      cities.push({
        id: c.id,
        name: c.name,
        at: c.at,
        owner: c.owner,
        level: c.level,
        capital: c.capitalOf !== null,
        vis: true,
        mine: {
          id: c.id,
          pop: c.pop,
          nextLevelAt: nextLevelAt(c.level),
          workshop: c.workshop,
          walls: c.walls,
          parks: c.parks,
          units: homedUnits(state, c.id),
          capacity: capacity(c),
          income: cityIncome(state, c, truth, links),
          occupied: isOccupied(c, truth),
          connected: links.has(c.id),
          pendingRewards: c.pendingRewards,
          pendingChampion: c.pendingChampion,
        },
      });
    } else if (vis[c.at]) {
      cities.push({ id: null, name: c.name, at: c.at, owner: c.owner, level: c.level, capital: c.capitalOf !== null, vis: true });
    } else {
      const m = f.memory.cities[c.at];
      if (m) cities.push({ id: null, name: m.name, at: c.at, owner: m.owner, level: m.level, capital: m.capital, vis: false });
    }
  }

  const myTurn = state.phase === "playing" && state.factions[state.current]!.id === me && !f.eliminated;
  const moves: Record<string, number[]> = {};
  const attacks: Record<string, AttackOption[]> = {};
  const idleUnits: string[] = [];
  const converts: Record<string, number[]> = {};
  const freezes: Record<string, number[]> = {};
  if (myTurn) {
    for (const u of Object.values(state.units)) {
      if (u.owner !== me) continue;
      const m = [...reachable(state, u, seen).keys()];
      const a = attackTargets(state, u, seen).map((t) => ({ target: t.at, ...resolveCombat(state, u, t) }));
      if (m.length) moves[u.id] = m;
      if (a.length) attacks[u.id] = a;
      const tile = state.tiles[u.at]!;
      const city = tile.city ? state.cities[tile.city] : undefined;
      const canCapture =
        !u.done && !u.moved && u.settled && canCaptureWith(u) && (tile.feat === "village" || (!!city && !allied(state, city.owner, me)));
      const canPromote = !u.veteran && u.kills >= VETERAN_KILLS;
      if (UNITS[u.type].sage && !u.done && !u.attacked) {
        const c = neighbors(u.at, state.size).filter((i) => {
          const t = seen.get(i);
          return !!t && !allied(state, t.owner, me) && !UNITS[t.type].steadfast;
        });
        if (c.length) converts[u.id] = c;
      }
      if (!u.done && !u.moved && !u.attacked && !u.vessel && f.credits >= ICE.cost) {
        const fz = freezeTargets(state, me, u.at, seen);
        if (fz.length) freezes[u.id] = fz;
      }
      if (m.length || a.length || canCapture || canPromote || converts[u.id]) idleUnits.push(u.id);
    }
  }

  return {
    me,
    kind: f.kind,
    myTurn,
    turn: state.turn,
    tiles,
    units: Object.values(state.units)
      .filter((u) => seen.get(u.at) === u)
      .map((u) => knownUnit(u, me)),
    cities,
    credits: f.credits,
    income: totalIncome(state, me),
    techs: f.techs,
    cityCount: ownedCities(state, me).length,
    score: scoreOf(state, me),
    moves,
    attacks,
    idleUnits,
    eliminated: f.eliminated,
    achievements: achievementProgress(state, me).map((a) => ({ ...a, done: !!f.monuments?.earned.includes(a.kind) })),
    monumentsToPlace: f.monuments?.unplaced ?? 0,
    converts,
    freezes,
    diplomacy: (f.contacts ?? [])
      .filter((id) => !faction(state, id)?.eliminated)
      .map((id) => {
        const t = treatyOf(state, me, id);
        return {
          id,
          relation: !t ? "war" : t.brokenBy ? "notice" : "peace",
          peaceSince: t?.since ?? null,
          brokenBy: t?.brokenBy ?? null,
          embassy: !!f.embassies?.includes(id),
          offerFromThem: !!state.offers?.some((o) => o.from === id && o.to === me),
          offerFromMe: !!state.offers?.some((o) => o.from === me && o.to === id),
        } as const;
      }),
  };
}

