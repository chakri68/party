import type { GameContext, GameDefinition, GameEventEnvelope, GameResult, GameTransition, TimerRequest } from "@games/game-core";
import {
  DEVELOP,
  FACTION_KINDS,
  FACTIONS,
  HARVEST,
  DEMOLISH_COST,
  HEAL,
  HEAL_HOME,
  MAX_CHAIN,
  MEND_HP,
  MONUMENT_POP,
  EMBASSY_COST,
  OFFER_ROUNDS,
  SABOTAGE_RAIDERS,
  BEACON_POP,
  VESSELS,
  TEMPLE_CULTURE,
  TEMPLE_CULTURE_CAP,
  TERRAIN,
  OPENING_CREDITS,
  POPULATION_REWARD,
  rewardChoices,
  SCOUT_RADIUS,
  TECH_ORDER,
  techCost,
  TECHS,
  TRAINABLE,
  TREASURY_CREDITS,
  UNITS,
  VETERAN_HP,
  VETERAN_KILLS,
} from "../shared/content.ts";
import { area, chebyshev, neighbors, Rng, streamSeed } from "../shared/grid.ts";
import { dominionManifest } from "../shared/manifest.ts";
import { generateWorld } from "../shared/mapgen.ts";
import { encodeTerrain, encodeTile } from "../shared/memory.ts";
import { cityName } from "../shared/names.ts";
import { parseSettings, resolveBots, resolveMapSize, resolveTeams } from "../shared/rules-text.ts";
import {
  allied,
  canAttackWith,
  canStand,
  capitalOf,
  statsOf,
  achievementProgress,
  atPeace,
  canSeeUnit,
  developBlock,
  hostile,
  treatyOf,
  capacity,
  faction,
  fullMp,
  hasTech,
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
} from "../shared/rules.ts";
import {
  CONTENT_VERSION,
  DEFAULT_SETTINGS,
  GENERATOR_VERSION,
  RULES_VERSION,
  SCHEMA_VERSION,
  type City,
  type DevelopKind,
  type DominionAction,
  type DominionEvent,
  type DominionPrivateState,
  type DominionPublicState,
  type DominionSettings,
  type DominionState,
  type FactionKind,
  type RewardChoice,
  type RuinReward,
  type Unit,
  type UnitType,
} from "../shared/types.ts";
import { decide, type BotMemory } from "./bot.ts";
import { parseAction } from "./parse.ts";
import { projectFor, visibleUnits } from "./projection.ts";

type State = DominionState;
type Envelope = GameEventEnvelope<DominionEvent>;
type Transition = GameTransition<State, DominionEvent>;

const TURN_TIMER = "turn";
const BOT_TIMER = "bot";
/** Pause before a computer's turn, and between its batches of actions. */
const BOT_START_MS = 700;
const BOT_STEP_MS = 450;
/** Actions per batch: small, so each server step stays short and moves animate. */
const BOT_BATCH = 4;
/** A computer turn ends after this many actions, whatever it still wants. */
const BOT_TURN_CAP = 80;
const BOT_NAMES = ["Hollis", "Wren", "Marlo", "Tamsin", "Oswin", "Briar", "Corin", "Ysolde"];
/** An alarm that fires a touch early still counts. */
const TIMER_SLACK_MS = 500;

const reject = (code: string, message: string): GameResult<State, DominionEvent> => ({
  ok: false,
  error: { code, message },
});

/** Generic on purpose: a precise error about an unseen tile would be a free scout (§10). */
const ILLEGAL = "That isn't possible right now.";

// ---------------------------------------------------------------------------
// Transaction: collects events, then redacts them per recipient at the end.
// ---------------------------------------------------------------------------

interface Pending {
  event: DominionEvent;
  /** Public, one player only, or anyone who can see these tiles. */
  to: { kind: "all" } | { kind: "player"; id: string } | { kind: "seen"; tiles: number[]; stealthy?: Unit };
}

class Tx {
  readonly events: Pending[] = [];
  readonly timers: TimerRequest[] = [];
  private readonly before = new Map<string, Uint8Array>();

  readonly state: State;
  readonly ctx: GameContext;

  constructor(state: State, ctx: GameContext) {
    this.state = state;
    this.ctx = ctx;
    for (const f of state.factions) this.before.set(f.id, visionOf(state, f.id));
  }

  all(event: DominionEvent) {
    this.events.push({ event, to: { kind: "all" } });
  }

  only(id: string, event: DominionEvent) {
    this.events.push({ event, to: { kind: "player", id } });
  }

  seen(tiles: number[], event: DominionEvent, unit?: Unit) {
    // An infiltrator's doings go only to those who can make it out (§11).
    const stealthy = unit && !unit.vessel && UNITS[unit.type].stealth ? unit : undefined;
    this.events.push({ event, to: { kind: "seen", tiles, stealthy } });
  }

  /** Settle: eliminations, victory, memories, revision, then the envelopes. */
  finish(): Transition {
    const s = this.state;
    if (s.phase === "playing") checkEliminations(this);
    if (s.phase === "playing") discoverBeacons(this);
    if (s.phase === "playing") makeContacts(this);
    if (s.phase === "playing") checkAchievements(this);
    rememberAll(s);
    s.revision++;

    const after = new Map(s.factions.map((f) => [f.id, visionOf(s, f.id)]));
    const envelopes: Envelope[] = [];
    for (const { event, to } of this.events) {
      if (to.kind === "all") {
        envelopes.push({ visibility: { kind: "public" }, event });
        continue;
      }
      if (to.kind === "player") {
        envelopes.push({ visibility: { kind: "private", playerId: to.id }, event });
        continue;
      }
      for (const f of s.factions) {
        const was = this.before.get(f.id)!;
        const now = after.get(f.id)!;
        if (to.stealthy && !canSeeUnit(s, f.id, to.stealthy, now)) continue;
        const redacted = redact(event, to.tiles, was, now);
        if (redacted) envelopes.push({ visibility: { kind: "private", playerId: f.id }, event: redacted });
      }
    }
    return { state: s, events: envelopes, timers: this.timers.length ? this.timers : undefined };
  }
}

/**
 * What a recipient may learn. A move seen at one end only shows as an entry or
 * exit, never the hidden path (§10); everything else needs every tile seen.
 */
function redact(event: DominionEvent, tiles: number[], before: Uint8Array, after: Uint8Array): DominionEvent | null {
  if (event.type === "move") {
    const from = event.from !== null && before[event.from] ? event.from : null;
    const to = event.to !== null && after[event.to] ? event.to : null;
    return from === null && to === null ? null : { ...event, from, to };
  }
  return tiles.every((i) => before[i] || after[i]) ? event : null;
}

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

function seatOf(state: State, owner: string | null): number {
  return owner === null ? -1 : state.factions.findIndex((f) => f.id === owner);
}

function remember(state: State, owner: string, tiles: Iterable<number>): void {
  const f = faction(state, owner)!;
  for (const i of tiles) {
    const t = state.tiles[i]!;
    f.memory.codes[i] = encodeTile(t, seatOf(state, tileOwner(state, i)));
    f.memory.seen[i] = state.round;
    const city = t.city ? state.cities[t.city] : undefined;
    if (city) {
      f.memory.cities[i] = { name: city.name, level: city.level, owner: city.owner, capital: city.capitalOf !== null };
    } else {
      delete f.memory.cities[i];
    }
  }
}

function rememberAll(state: State): void {
  for (const f of state.factions) {
    if (f.eliminated) continue;
    const vis = visionOf(state, f.id);
    const tiles: number[] = [];
    vis.forEach((v, i) => v && tiles.push(i));
    remember(state, f.id, tiles);
  }
}

// ---------------------------------------------------------------------------
// World mutations
// ---------------------------------------------------------------------------

function newId(state: State, prefix: string): string {
  return `${prefix}${(state.nextId++).toString(36)}`;
}

function claim(state: State, city: City, radius: number): void {
  for (const i of area(city.at, radius, state.size)) {
    const t = state.tiles[i]!;
    if (i === city.at || (t.claim === null && t.city === null)) t.claim = city.id;
  }
}

function foundCity(state: State, at: number, owner: string | null, kind: FactionKind, capital: boolean): City {
  const rng = new Rng(state.rng.names);
  const name = cityName(rng, kind, new Set(Object.values(state.cities).map((c) => c.name)));
  state.rng.names = rng.state;
  const city: City = {
    id: newId(state, "c"),
    name,
    at,
    owner,
    level: 1,
    pop: 0,
    capitalOf: capital ? owner : null,
    workshop: false,
    walls: false,
    parks: 0,
    pendingRewards: [],
    pendingChampion: false,
  };
  state.cities[city.id] = city;
  const tile = state.tiles[at]!;
  tile.city = city.id;
  tile.feat = null;
  tile.res = null;
  tile.imp = null;
  claim(state, city, 1);
  return city;
}

function spawnUnit(state: State, type: UnitType, owner: string, at: number, home: string | null): Unit {
  const def = UNITS[type];
  const unit: Unit = {
    id: newId(state, "u"),
    type,
    owner,
    home,
    at,
    hp: def.hp,
    maxHp: def.hp,
    kills: 0,
    veteran: false,
    // New units wait for their owner's next turn (§5).
    mp: 0,
    moved: false,
    attacked: false,
    done: true,
    settled: true,
  };
  state.units[unit.id] = unit;
  return unit;
}

function addPop(tx: Tx, city: City, amount: number): void {
  city.pop += amount;
  while (city.pop >= nextLevelAt(city.level)) {
    city.pop -= nextLevelAt(city.level);
    city.level++;
    city.pendingRewards.push(city.level);
    if (city.owner) tx.only(city.owner, { type: "city-level", city: city.id, level: city.level });
  }
}

/** Empty, standable tiles for a new unit: the city first, then its own neighbours. */
function spawnSpot(state: State, city: City): number | null {
  const units = indexUnits(Object.values(state.units));
  const owner = city.owner!;
  if (!units.has(city.at)) return city.at;
  return (
    neighbors(city.at, state.size).find(
      (i) => !units.has(i) && canStand(state, owner, i) && tileOwner(state, i) === owner,
    ) ?? null
  );
}

function trySpawnChampion(tx: Tx, city: City): void {
  const at = spawnSpot(tx.state, city);
  if (at === null) {
    city.pendingChampion = true;
    return;
  }
  city.pendingChampion = false;
  spawnUnit(tx.state, "champion", city.owner!, at, city.id);
  tx.seen([at], { type: "spawn", at });
}

function applyReward(tx: Tx, city: City, choice: RewardChoice): void {
  const s = tx.state;
  const f = faction(s, city.owner)!;
  switch (choice) {
    case "workshop":
      city.workshop = true;
      break;
    case "scout":
      remember(s, f.id, area(city.at, SCOUT_RADIUS, s.size));
      break;
    case "treasury":
      f.credits += TREASURY_CREDITS;
      break;
    case "walls":
      city.walls = true;
      break;
    case "population":
      addPop(tx, city, POPULATION_REWARD);
      break;
    case "borders":
      claim(s, city, 2);
      break;
    case "park":
      city.parks++;
      break;
    case "champion":
      trySpawnChampion(tx, city);
      break;
  }
}

/** Picks the default for every reward still waiting: the turn can't end with a choice open. */
function settleRewards(tx: Tx, owner: string): void {
  for (const city of ownedCities(tx.state, owner)) {
    while (city.pendingRewards.length) {
      const level = city.pendingRewards.shift()!;
      applyReward(tx, city, rewardChoices(level)[0]);
    }
  }
}

// ---------------------------------------------------------------------------
// Turns
// ---------------------------------------------------------------------------

function current(state: State) {
  return state.factions[state.current]!;
}

function beginTurn(tx: Tx): void {
  const s = tx.state;
  const f = current(s);

  // Capital control: held at the end of its last turn, and still held now (§13).
  if (s.settings.victory === "capitals" && f.holdingCapitals && holdsAllCapitals(s, f.id)) {
    return finish(tx, teamOf(s, f.id), "capitals");
  }

  // Homeless units find a city with room (§6). Excess ones wait, unhomed.
  for (const u of Object.values(s.units)) {
    if (u.owner !== f.id || u.home !== null) continue;
    const city = ownedCities(s, f.id).find((c) => homedUnits(s, c.id) < capacity(c));
    if (city) u.home = city.id;
  }
  for (const c of ownedCities(s, f.id)) if (c.pendingChampion) trySpawnChampion(tx, c);

  // Temples gather culture at their owner's turn start, up to a cap each.
  s.tiles.forEach((t) => {
    if (t.imp === "temple" && t.claim && s.cities[t.claim]?.owner === f.id) {
      t.culture = Math.min(TEMPLE_CULTURE_CAP, (t.culture ?? 0) + TEMPLE_CULTURE);
    }
  });

  f.credits += totalIncome(s, f.id);
  // A sabotaged city has now missed its pay; it's back to normal.
  for (const c of ownedCities(s, f.id)) c.sabotaged = false;
  // A broken treaty's notice ends as its breaker's next turn begins (§11).
  s.treaties = (s.treaties ?? []).filter((t) => t.brokenBy !== f.id);
  s.offers = (s.offers ?? []).filter((o) => s.round - o.round < OFFER_ROUNDS);
  for (const u of Object.values(s.units)) {
    if (u.owner !== f.id) continue;
    u.mp = fullMp(u);
    u.moved = false;
    u.attacked = false;
    u.done = false;
    u.settled = true;
    u.chained = 0;
  }

  s.botSteps = 0;
  if (f.bot) {
    // Computers have no clock; they start after a beat so people can follow.
    s.deadline = null;
    tx.timers.push({ kind: "cancel", timerId: TURN_TIMER }, { kind: "set", timerId: BOT_TIMER, delayMs: BOT_START_MS });
  } else {
    const clock = s.settings.turnClock * 1000;
    s.deadline = clock ? tx.ctx.now + clock : null;
    if (clock) tx.timers.push({ kind: "set", timerId: TURN_TIMER, delayMs: clock });
  }
  tx.all({ type: "turn-start", playerId: f.id, round: s.round });
}

function advanceTurn(tx: Tx): void {
  const s = tx.state;
  if (s.phase !== "playing") return;
  const ending = current(s);
  if (!ending.eliminated) {
    settleRewards(tx, ending.id);
    ending.holdingCapitals = holdsAllCapitals(s, ending.id);
  }
  const n = s.factions.length;
  let next = s.current;
  for (let step = 1; step <= n; step++) {
    const idx = (s.current + step) % n;
    // Passing the first seat starts a new round.
    if (idx === 0) {
      s.round++;
      if (s.settings.roundLimit && s.round > s.settings.roundLimit) return finishByScore(tx);
    }
    if (!s.factions[idx]!.eliminated) {
      next = idx;
      break;
    }
  }
  s.current = next;
  s.turn++;
  beginTurn(tx);
}

function alive(state: State) {
  return state.factions.filter((f) => !f.eliminated);
}

/** Everyone who wins alongside `id`: its team, or just itself. */
function teamOf(state: State, id: string): string[] {
  return state.factions.filter((f) => allied(state, f.id, id)).map((f) => f.id);
}

/** A side: a team number, or a lone empire's id. */
const side = (f: { id: string; team?: number | null }) => (f.team === undefined || f.team === null ? f.id : `team${f.team}`);

/** Every original capital is held by `id` or its allies. */
function holdsAllCapitals(state: State, id: string): boolean {
  const capitals = Object.values(state.cities).filter((c) => c.capitalOf !== null);
  return capitals.length > 0 && capitals.every((c) => allied(state, c.owner, id));
}

function eliminate(tx: Tx, owner: string): void {
  const s = tx.state;
  const f = faction(s, owner)!;
  f.eliminated = true;
  for (const u of Object.values(s.units)) if (u.owner === owner) delete s.units[u.id];
  s.treaties = (s.treaties ?? []).filter((t) => t.a !== owner && t.b !== owner);
  s.offers = (s.offers ?? []).filter((o) => o.from !== owner && o.to !== owner);
  tx.all({ type: "eliminated", playerId: owner });
}

function checkEliminations(tx: Tx): void {
  const s = tx.state;
  const wasTurnOf = current(s).id;
  for (const f of s.factions) {
    if (!f.eliminated && ownedCities(s, f.id).length === 0) eliminate(tx, f.id);
  }
  // Conquest is per side: the last team standing wins together, fallen allies included.
  const sides = new Set(alive(s).map(side));
  if (sides.size <= 1) {
    const last = alive(s)[0];
    finish(tx, last ? teamOf(s, last.id) : [], last ? "conquest" : "draw");
    return;
  }
  if (faction(s, wasTurnOf)!.eliminated) advanceTurn(tx);
}

function finish(tx: Tx, winnerIds: string[], reason: "conquest" | "score" | "capitals" | "draw"): void {
  const s = tx.state;
  s.phase = "finished";
  s.deadline = null;
  s.outcome = { winnerIds, reason };
  tx.timers.push({ kind: "cancel", timerId: TURN_TIMER });
  tx.all({ type: "game-over", winnerIds });
}

/**
 * Highest score; ties go to owned capitals, then city population, then
 * credits; then shared (§13). Teams compete on their members' totals.
 */
function finishByScore(tx: Tx): void {
  const s = tx.state;
  const key = (members: string[]) => {
    const cities = members.flatMap((id) => ownedCities(s, id));
    return [
      members.reduce((n, id) => n + scoreOf(s, id), 0),
      cities.filter((c) => c.capitalOf !== null).length,
      cities.reduce((n, c) => n + c.level, 0),
      members.reduce((n, id) => n + faction(s, id)!.credits, 0),
    ];
  };
  const sides = [...new Set(alive(s).map(side))].map((k) => {
    const members = s.factions.filter((f) => side(f) === k).map((f) => f.id);
    return { members, key: key(members) };
  });
  sides.sort((a, b) => {
    for (let k = 0; k < a.key.length; k++) if (a.key[k] !== b.key[k]) return b.key[k]! - a.key[k]!;
    return 0;
  });
  const top = sides[0];
  const winners = top ? sides.filter((c) => c.key.every((v, k) => v === top.key[k])).flatMap((c) => c.members) : [];
  finish(tx, winners, winners.length ? "score" : "draw");
}

// ---------------------------------------------------------------------------
// Achievements (§13): checked after every change, each earned once.
// ---------------------------------------------------------------------------

/** Seeing another empire's unit or city is meeting it, both ways (§11). */
function makeContacts(tx: Tx): void {
  const s = tx.state;
  for (const f of s.factions) {
    if (f.eliminated) continue;
    const vis = visionOf(s, f.id);
    const seen = new Set<string>();
    for (const u of Object.values(s.units)) if (u.owner !== f.id && canSeeUnit(s, f.id, u, vis)) seen.add(u.owner);
    for (const c of Object.values(s.cities)) if (c.owner && c.owner !== f.id && vis[c.at]) seen.add(c.owner);
    for (const other of seen) {
      if (f.contacts?.includes(other)) continue;
      const o = faction(s, other)!;
      (f.contacts ??= []).push(other);
      if (!o.contacts?.includes(f.id)) (o.contacts ??= []).push(f.id);
      tx.only(f.id, { type: "contact", with: other });
      tx.only(other, { type: "contact", with: f.id });
    }
  }
}

/** First sight of a beacon pays the finder's capital, once per empire per beacon (§9). */
function discoverBeacons(tx: Tx): void {
  const s = tx.state;
  for (const f of s.factions) {
    if (f.eliminated) continue;
    const vis = visionOf(s, f.id);
    s.tiles.forEach((t, i) => {
      if (t.feat !== "beacon" || !vis[i] || f.beacons?.includes(i)) return;
      (f.beacons ??= []).push(i);
      const capital = capitalOf(s, f.id);
      if (capital) addPop(tx, capital, BEACON_POP);
      tx.only(f.id, { type: "beacon", at: i });
    });
  }
}

function checkAchievements(tx: Tx): void {
  const s = tx.state;
  for (const f of s.factions) {
    if (f.eliminated) continue;
    f.monuments ??= { earned: [], unplaced: 0 };
    for (const a of achievementProgress(s, f.id)) {
      if (a.progress < a.goal || f.monuments.earned.includes(a.kind)) continue;
      f.monuments.earned.push(a.kind);
      f.monuments.unplaced++;
      tx.only(f.id, { type: "achievement", kind: a.kind });
    }
  }
}

// ---------------------------------------------------------------------------
// Ruins (§10): outcome drawn from its own stream, stored in the event.
// ---------------------------------------------------------------------------

function enterRuins(tx: Tx, unit: Unit): void {
  const s = tx.state;
  const tile = s.tiles[unit.at]!;
  tile.feat = null;
  const rng = new Rng(s.rng.ruins);
  const roll = rng.int(5);
  const pick = rng.next();
  s.rng.ruins = rng.state;
  const f = faction(s, unit.owner)!;

  let reward: RuinReward | null = null;
  if (roll === 1) {
    const city = ownedCities(s, f.id).sort((a, b) => chebyshev(a.at, unit.at, s.size) - chebyshev(b.at, unit.at, s.size))[0];
    if (city) {
      addPop(tx, city, 3);
      reward = { kind: "population", amount: 3, city: city.id };
    }
  } else if (roll === 2) {
    const open = TECH_ORDER.filter((t) => !f.techs.includes(t) && TECHS[t].tier <= 2 && (!TECHS[t].parent || f.techs.includes(TECHS[t].parent!)));
    if (open.length) {
      const tech = open[Math.floor(pick * open.length)]!;
      f.techs.push(tech);
      reward = { kind: "tech", tech };
    }
  } else if (roll === 3) {
    const units = indexUnits(Object.values(s.units));
    const spot = neighbors(unit.at, s.size).find((i) => !units.has(i) && canStand(s, f.id, i));
    if (spot !== undefined) {
      spawnUnit(s, "infantry", f.id, spot, null);
      reward = { kind: "unit", at: spot };
      tx.seen([spot], { type: "spawn", at: spot });
    }
  } else if (roll === 4) {
    remember(s, f.id, area(unit.at, 4, s.size));
    reward = { kind: "explore", radius: 4 };
  }
  // Credits are the fallback for anything that couldn't happen.
  if (!reward) {
    f.credits += 10;
    reward = { kind: "credits", amount: 10 };
  }
  tx.only(f.id, { type: "ruins", at: unit.at, reward });
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function ownUnit(state: State, me: string, id: string): Unit | null {
  const u = state.units[id];
  return u && u.owner === me ? u : null;
}

function ownCity(state: State, me: string, id: string): City | null {
  const c = state.cities[id];
  return c && c.owner === me ? c : null;
}

/** Null on success, or an error message. */
function apply(tx: Tx, me: string, action: Exclude<DominionAction, { type: "surrender" }>): string | null {
  const s = tx.state;
  const f = faction(s, me)!;
  const truth = indexUnits(Object.values(s.units));

  switch (action.type) {
    case "move": {
      const unit = ownUnit(s, me, action.unit);
      if (!unit) return ILLEGAL;
      const options = reachable(s, unit, visibleUnits(s, me));
      const left = options.get(action.to);
      // Someone hidden on the destination: same answer as any other bad move.
      if (left === undefined || truth.has(action.to)) return "Can't move there.";
      const from = unit.at;
      unit.at = action.to;
      unit.mp = left;
      unit.moved = true;
      unit.settled = false;
      const water = !TERRAIN[s.tiles[action.to]!.t].land;
      if (water && !unit.vessel) {
        // Boarding at a port: the unit becomes the cargo of a transport.
        unit.vessel = "transport";
        unit.mp = 0;
      } else if (!water && unit.vessel) {
        // Landing takes whatever the turn had left (§9).
        unit.vessel = null;
        unit.mp = 0;
        unit.done = true;
      }
      tx.seen([from, action.to], { type: "move", unit: unit.id, from, to: action.to }, unit);
      if (s.tiles[unit.at]!.feat === "ruins") enterRuins(tx, unit);
      return null;
    }

    case "attack": {
      const unit = ownUnit(s, me, action.unit);
      if (!unit || !canAttackWith(unit)) return ILLEGAL;
      const target = truth.get(action.target);
      const vis = visionOf(s, me);
      if (
        !target ||
        !hostile(s, target.owner, me) ||
        !canSeeUnit(s, me, target, vis) ||
        chebyshev(unit.at, target.at, s.size) > statsOf(unit).range
      ) {
        return "Can't attack that.";
      }
      const { damage, retaliation } = resolveCombat(s, unit, target);
      const splash = unit.vessel ? VESSELS[unit.vessel].splash : false;
      target.hp -= damage;
      const defenderKilled = target.hp <= 0;
      if (defenderKilled) {
        delete s.units[target.id];
        unit.kills++;
        f.kills++;
      } else {
        unit.hp -= retaliation;
      }
      const attackerKilled = unit.hp <= 0;
      if (attackerKilled) {
        delete s.units[unit.id];
        target.kills++;
        faction(s, target.owner)!.kills++;
      }
      const def = UNITS[unit.type];
      unit.attacked = true;
      // Knights chain and cavalry fall back on land only; at sea they're just cargo.
      if (def.chain && !unit.vessel && defenderKilled && (unit.chained ?? 0) < MAX_CHAIN) {
        // Knights strike again after a kill, standing where they are.
        unit.chained = (unit.chained ?? 0) + 1;
        unit.attacked = false;
        unit.mp = 0;
      } else if (unit.type === "cavalry" && !unit.vessel && f.techs.includes("free_spirit")) {
        // Free Spirit: cavalry may fall back with what movement it has left.
        unit.moved = true;
      } else {
        unit.done = true;
        unit.mp = 0;
      }
      if (splash) {
        // Half damage to enemies next to the target. Never friends, never the
        // unseen, never anything back (§9).
        const half = Math.max(1, Math.round(damage / 2));
        for (const i of neighbors(target.at, s.size)) {
          const hit = truth.get(i);
          if (!hit || hit === unit || hit === target || allied(s, hit.owner, me) || !vis[i]) continue;
          hit.hp -= Math.min(half, hit.hp);
          const killed = hit.hp <= 0;
          if (killed) {
            delete s.units[hit.id];
            unit.kills++;
            f.kills++;
          }
          tx.seen([i], { type: "splash", at: i, damage: half, killed });
        }
      }
      tx.seen([unit.at, target.at], {
        type: "attack",
        from: unit.at,
        to: target.at,
        damage,
        retaliation: defenderKilled ? 0 : retaliation,
        defenderKilled,
        attackerKilled,
      });
      return null;
    }

    case "capture": {
      const unit = ownUnit(s, me, action.unit);
      if (!unit || unit.done || unit.moved || unit.attacked) return "That unit has already acted.";
      if (!unit.settled) return "Units capture the turn after they arrive.";
      if (unit.vessel) return "Land first.";
      const tile = s.tiles[unit.at]!;
      const city = tile.city ? s.cities[tile.city]! : null;
      if (tile.feat === "village") {
        const c = foundCity(s, unit.at, me, f.kind, false);
        unit.home ??= c.id;
      } else if (city && !allied(s, city.owner, me)) {
        if (atPeace(s, city.owner, me)) return "You're at peace with them.";
        city.owner = me;
        city.pendingRewards = [];
        city.pendingChampion = false;
        for (const u of Object.values(s.units)) if (u.home === city.id) u.home = null;
      } else {
        return "There's nothing to capture here.";
      }
      unit.done = true;
      unit.mp = 0;
      tx.seen([unit.at], { type: "capture", at: unit.at, by: me });
      return null;
    }

    case "heal": {
      const unit = ownUnit(s, me, action.unit);
      if (!unit || unit.done || unit.moved || unit.attacked) return "That unit has already acted.";
      if (unit.hp >= unit.maxHp) return "That unit is already healthy.";
      const amount = Math.min(unit.maxHp - unit.hp, tileOwner(s, unit.at) === me ? HEAL_HOME : HEAL);
      unit.hp += amount;
      unit.done = true;
      unit.mp = 0;
      tx.seen([unit.at], { type: "heal", at: unit.at, amount });
      return null;
    }

    case "promote": {
      const unit = ownUnit(s, me, action.unit);
      if (!unit || unit.veteran || unit.kills < VETERAN_KILLS) return "Not ready for promotion.";
      unit.veteran = true;
      unit.maxHp += VETERAN_HP;
      unit.hp += VETERAN_HP;
      return null;
    }

    case "sabotage": {
      const unit = ownUnit(s, me, action.unit);
      const tile = unit ? s.tiles[unit.at]! : null;
      const city = tile?.city ? s.cities[tile.city] : undefined;
      if (!unit || !UNITS[unit.type].stealth || unit.done || unit.vessel) return ILLEGAL;
      if (!city || !hostile(s, city.owner, me)) return "Infiltrators sabotage from inside a rival's city.";
      delete s.units[unit.id];
      city.sabotaged = true;
      // Up to two raiders on empty ground next to the city. Truly empty: a
      // hidden unit's tile is skipped without telling anyone why.
      const spots = neighbors(city.at, s.size).filter((i) => !truth.has(i) && canStand(s, me, i));
      for (const at of spots.slice(0, SABOTAGE_RAIDERS)) {
        spawnUnit(s, "raider", me, at, null);
        tx.seen([at], { type: "spawn", at });
      }
      tx.seen([city.at], { type: "sabotage", at: city.at, by: me });
      return null;
    }

    case "offer-peace": {
      const them = faction(s, action.to);
      if (!them || them.eliminated || them.id === me) return ILLEGAL;
      if (!f.techs.includes("diplomacy")) return "Research Diplomacy first.";
      if (!f.contacts?.includes(them.id)) return "You haven't met them yet.";
      if (allied(s, me, them.id) || atPeace(s, me, them.id)) return "You're already at peace.";
      const offers = (s.offers ??= []);
      // One offer at a time between any two empires.
      if (offers.some((o) => (o.from === me && o.to === them.id) || (o.from === them.id && o.to === me))) return "There's already an offer between you.";
      offers.push({ from: me, to: them.id, round: s.round });
      tx.only(me, { type: "peace-offered", from: me, to: them.id });
      tx.only(them.id, { type: "peace-offered", from: me, to: them.id });
      return null;
    }

    case "break-peace": {
      const t = treatyOf(s, me, action.with);
      if (!t || t.brokenBy) return "There's no peace to break.";
      t.brokenBy = me;
      tx.only(me, { type: "peace-broken", by: me, with: action.with });
      tx.only(action.with, { type: "peace-broken", by: me, with: action.with });
      return null;
    }

    case "embassy": {
      const them = faction(s, action.with);
      if (!them || them.eliminated || them.id === me) return ILLEGAL;
      if (!f.techs.includes("diplomacy")) return "Research Diplomacy first.";
      if (!f.contacts?.includes(them.id)) return "You haven't met them yet.";
      if (f.embassies?.includes(them.id)) return "You already have an embassy there.";
      if (f.credits < EMBASSY_COST) return "Not enough credits.";
      f.credits -= EMBASSY_COST;
      (f.embassies ??= []).push(them.id);
      tx.only(me, { type: "embassy", from: me, to: them.id });
      tx.only(them.id, { type: "embassy", from: me, to: them.id });
      return null;
    }

    case "answer-peace":
      return answerPeace(tx, me, action.from, action.accept);

    case "upgrade": {
      const unit = ownUnit(s, me, action.unit);
      const def = VESSELS[action.vessel];
      if (!unit || unit.vessel !== "transport" || unit.done || unit.attacked) return "Only a transport that hasn't acted can be refitted.";
      if (!f.techs.includes(def.needs)) return `Research ${TECHS[def.needs].name} first.`;
      if (f.credits < def.cost) return "Not enough credits.";
      f.credits -= def.cost;
      unit.vessel = action.vessel; // same health pool, same cargo
      unit.done = true;
      unit.mp = 0;
      tx.seen([unit.at], { type: "spawn", at: unit.at });
      return null;
    }

    case "disband": {
      const unit = ownUnit(s, me, action.unit);
      if (!unit) return ILLEGAL;
      if (!f.techs.includes("free_spirit")) return "Research Free Spirit first.";
      // Converted units refund nothing, so stealing and selling can't print money.
      const refund = unit.converted ? 0 : Math.floor(UNITS[unit.type].cost / 2);
      f.credits += refund;
      delete s.units[unit.id];
      tx.seen([unit.at], { type: "move", unit: unit.id, from: unit.at, to: null });
      return null;
    }

    case "mend": {
      const unit = ownUnit(s, me, action.unit);
      if (!unit || !UNITS[unit.type].sage || unit.done || unit.attacked) return ILLEGAL;
      const hurt = neighbors(unit.at, s.size)
        .map((i) => truth.get(i))
        .filter((u): u is Unit => !!u && allied(s, u.owner, me) && u.hp < u.maxHp);
      if (!hurt.length) return "Nobody nearby needs healing.";
      for (const u of hurt) {
        const amount = Math.min(MEND_HP, u.maxHp - u.hp);
        u.hp += amount;
        tx.seen([u.at], { type: "heal", at: u.at, amount });
      }
      unit.done = true;
      unit.mp = 0;
      return null;
    }

    case "convert": {
      const unit = ownUnit(s, me, action.unit);
      if (!unit || !UNITS[unit.type].sage || unit.done || unit.attacked) return ILLEGAL;
      const target = truth.get(action.target);
      if (
        !target ||
        !hostile(s, target.owner, me) ||
        !canSeeUnit(s, me, target, visionOf(s, me)) ||
        chebyshev(unit.at, target.at, s.size) > 1 ||
        UNITS[target.type].steadfast
      ) {
        return "Can't convert that.";
      }
      target.owner = me;
      target.home = null; // finds room in one of your cities at your next turn start
      target.converted = true;
      target.done = true;
      target.mp = 0;
      unit.done = true;
      unit.mp = 0;
      tx.seen([target.at], { type: "convert", at: target.at, by: me });
      return null;
    }

    case "monument": {
      const tile = s.tiles[action.tile];
      const city = tile?.claim ? s.cities[tile.claim] : undefined;
      if (!f.monuments?.unplaced) return "You have no monument to place.";
      if (!tile || !city || city.owner !== me || tile.city || tile.imp || tile.feat || tile.res || !TERRAIN[tile.t].land) {
        return "Place it on open land of yours.";
      }
      tile.imp = "monument";
      f.monuments.unplaced--;
      addPop(tx, city, MONUMENT_POP);
      tx.seen([action.tile], { type: "monument", at: action.tile });
      return null;
    }

    case "train": {
      const city = ownCity(s, me, action.city);
      const def = UNITS[action.unitType];
      if (!city || !TRAINABLE.includes(action.unitType)) return ILLEGAL;
      if (!hasTech(s, me, def.needs)) return `Research ${TECHS[def.needs!].name} first.`;
      if (isOccupied(city, truth)) return "An enemy is in the city.";
      if (truth.has(city.at)) return "Move the unit out of the city first.";
      if (homedUnits(s, city.id) >= capacity(city)) return "The city can't support more units. Grow it first.";
      if (f.credits < def.cost) return "Not enough credits.";
      f.credits -= def.cost;
      spawnUnit(s, action.unitType, me, city.at, city.id);
      tx.seen([city.at], { type: "spawn", at: city.at });
      return null;
    }

    case "research": {
      const tech = TECHS[action.tech];
      if (f.techs.includes(action.tech)) return "Already researched.";
      if (tech.parent && !f.techs.includes(tech.parent)) return `Needs ${TECHS[tech.parent].name}.`;
      const cost = techCost(action.tech, ownedCities(s, me).length, f.techs);
      if (f.credits < cost) return "Not enough credits.";
      f.credits -= cost;
      f.techs.push(action.tech);
      tx.only(me, { type: "research", tech: action.tech });
      return null;
    }

    case "develop":
      return develop(tx, me, action.tile, action.kind);

    case "reward": {
      const city = ownCity(s, me, action.city);
      const level = city?.pendingRewards[0];
      if (!city || level === undefined || !rewardChoices(level).includes(action.choice)) return ILLEGAL;
      city.pendingRewards.shift();
      applyReward(tx, city, action.choice);
      return null;
    }

    case "end-turn":
      advanceTurn(tx);
      return null;
  }
}

function develop(tx: Tx, me: string, at: number, kind: DevelopKind): string | null {
  const s = tx.state;
  const f = faction(s, me)!;
  const tile = s.tiles[at];
  if (!tile) return ILLEGAL;
  const owner = tileOwner(s, at);
  if (Object.values(s.units).some((u) => u.at === at && !allied(s, u.owner, me))) return ILLEGAL;
  const city = tile.claim ? s.cities[tile.claim] : undefined;
  const block = developBlock(kind, tile, {
    mine: owner === me && !!city,
    open: (owner === null || allied(s, owner, me)) && !!visionOf(s, me)[at],
    hasCity: tile.city !== null,
    techs: f.techs,
    credits: f.credits,
  });
  if (block === undefined) return "Can't do that there.";
  if (block) return `${block}.`;

  if (kind === "harvest") {
    const h = HARVEST[tile.res!]!;
    f.credits -= h.cost;
    tile.res = null;
    addPop(tx, city!, h.pop);
  } else if (kind === "demolish") {
    // The tile keeps its credit: population already earned stays, and
    // rebuilding the same thing won't pay again (§6).
    f.credits -= DEMOLISH_COST;
    tile.imp = null;
  } else if (kind === "road") {
    f.credits -= DEVELOP.road.cost;
    tile.road = true;
  } else {
    const def = DEVELOP[kind];
    if (def.unique && s.tiles.some((t) => t.claim === city!.id && t.imp === def.builds)) return `One ${def.name.toLowerCase()} per city.`;
    f.credits -= def.cost;
    tile.imp = def.builds!;
    tile.res = null;
    let pop = def.pop;
    if (def.adjacentPop) {
      pop += neighbors(at, s.size).filter((j) => s.tiles[j]!.claim === city!.id && s.tiles[j]!.imp === def.adjacentPop).length;
    }
    const credited = (tile.credited ??= []);
    if (credited.includes(def.builds!)) pop = 0;
    else credited.push(def.builds!);
    if (pop) addPop(tx, city!, pop);
  }
  tx.seen([at], { type: "develop", at, kind });
  return null;
}

/** Out of turn is fine: an answer spends nothing and moves nothing (§11). */
function answerPeace(tx: Tx, me: string, from: string, accept: boolean): string | null {
  const s = tx.state;
  const offer = s.offers?.find((o) => o.from === from && o.to === me);
  if (!offer) return "That offer has lapsed.";
  s.offers = s.offers!.filter((o) => o !== offer);
  if (accept) (s.treaties ??= []).push({ a: from, b: me, since: s.round });
  tx.only(from, { type: "peace-answered", from, to: me, accepted: accept });
  tx.only(me, { type: "peace-answered", from, to: me, accepted: accept });
  return null;
}

function surrender(tx: Tx, me: string): void {
  const s = tx.state;
  const f = faction(s, me)!;
  f.surrendered = true;
  // Cities stay standing, ownerless: up for grabs like villages.
  for (const c of ownedCities(s, me)) {
    c.owner = null;
    c.pendingRewards = [];
    c.pendingChampion = false;
  }
  eliminate(tx, me);
}

// ---------------------------------------------------------------------------
// Computer turns: a few actions per timer tick, decided from the bot's own view.
// ---------------------------------------------------------------------------

function runBot(tx: Tx): void {
  const s = tx.state;
  const f = current(s);
  if (s.phase !== "playing" || !f.bot) return;
  const rng = new Rng(s.rng.ai ?? streamSeed(s.seed, 3));
  const memory: BotMemory = { banned: new Set() };
  for (let n = 0; n < BOT_BATCH; n++) {
    const steps = (s.botSteps ?? 0) + 1;
    s.botSteps = steps;
    const action = steps > BOT_TURN_CAP ? ({ type: "end-turn", turn: s.turn } as const) : decide(projectFor(s, f.id), f.bot.level, rng, memory);
    if (action.type === "end-turn") {
      s.rng.ai = rng.state;
      advanceTurn(tx);
      return;
    }
    // Same path as a person's action; an illegal pick is simply never tried again.
    if (apply(tx, f.id, action)) memory.banned.add(JSON.stringify(action));
    if (s.phase !== "playing" || current(s).id !== f.id) break;
  }
  s.rng.ai = rng.state;
  if (s.phase === "playing" && current(s).id === f.id) {
    tx.timers.push({ kind: "set", timerId: BOT_TIMER, delayMs: BOT_STEP_MS });
  }
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

function pickKinds(settings: DominionSettings, n: number, ctx: GameContext): FactionKind[] {
  if (settings.factions !== "mixed") return Array.from({ length: n }, () => settings.factions as FactionKind);
  return Array.from({ length: n }, () => FACTION_KINDS[ctx.randomInt(FACTION_KINDS.length)]!);
}

/** Older stored states would be migrated here (additively). There are none yet. */
function upgrade(state: State): State {
  return state;
}

// ---------------------------------------------------------------------------
// Definition
// ---------------------------------------------------------------------------

export const dominionGame: GameDefinition<
  DominionState,
  DominionAction,
  DominionPublicState,
  DominionPrivateState,
  DominionSettings,
  DominionEvent
> = {
  manifest: dominionManifest,
  defaultSettings: DEFAULT_SETTINGS,
  parseSettings,
  parseAction,

  createGame(players, settings, match, ctx) {
    const humans = players.length;
    if (humans < dominionManifest.minPlayers || humans > dominionManifest.maxPlayers) {
      throw new Error(`dominion: needs ${dominionManifest.minPlayers}–${dominionManifest.maxPlayers} players, got ${humans}`);
    }
    // Turn order: seats rotated by the dealer seat, which the room randomises
    // once and then rotates between rematches (§3). Computers play after people.
    const start = ((match.dealerSeat % humans) + humans) % humans;
    const bots = Array.from({ length: resolveBots(settings.bots, humans) }, (_, k) => ({ id: `cpu${k + 1}`, bot: true }));
    const order: { id: string; bot?: boolean }[] = [...players.slice(start), ...players.slice(0, start), ...bots];
    const n = order.length;
    const teams = resolveTeams(settings.teams ?? 0, n);
    const kinds = pickKinds(settings, n, ctx);
    const seed = ctx.randomInt(2 ** 32);
    const size = resolveMapSize(settings.mapSize, n);
    const world = generateWorld(seed, size, kinds, { mapType: settings.mapType, resources: settings.resources });

    const state: State = {
      schemaVersion: SCHEMA_VERSION,
      rulesVersion: RULES_VERSION,
      contentVersion: CONTENT_VERSION,
      generatorVersion: GENERATOR_VERSION,
      settings,
      size,
      tiles: world.tiles,
      cities: {},
      units: {},
      factions: order.map((p, k) => ({
        id: p.id,
        kind: kinds[k]!,
        // People keep their seat order's colour; computers take what's left.
        color: p.bot ? humans + bots.indexOf(p as (typeof bots)[number]) : players.findIndex((x) => x.id === p.id),
        bot: p.bot ? { level: settings.botLevel, name: BOT_NAMES[bots.indexOf(p as (typeof bots)[number]) % BOT_NAMES.length]! } : null,
        credits: FACTIONS[kinds[k]!].openingCredits ?? OPENING_CREDITS,
        // Dealt round-robin in turn order, so teams interleave around the table.
        team: teams ? k % teams : null,
        monuments: { earned: [], unplaced: 0 },
        techs: [FACTIONS[kinds[k]!].startTech],
        eliminated: false,
        surrendered: false,
        kills: 0,
        memory: {
          codes: world.tiles.map((t) => (settings.fog === "terrain" ? encodeTerrain(t) : -1)),
          seen: world.tiles.map(() => -1),
          cities: {},
        },
      })),
      seed,
      rng: { ruins: streamSeed(seed, 1), names: streamSeed(seed, 2), ai: streamSeed(seed, 3) },
      revision: 0,
      phase: "playing",
      round: 1,
      turn: 1,
      current: 0,
      deadline: null,
      nextId: 1,
      outcome: null,
    };

    order.forEach((p, k) => {
      const capital = foundCity(state, world.starts[k]!, p.id, kinds[k]!, true);
      spawnUnit(state, "infantry", p.id, capital.at, capital.id);
    });

    const tx = new Tx(state, ctx);
    beginTurn(tx);
    return tx.finish();
  },

  handleAction(stored, playerId, action, ctx) {
    const prev = upgrade(stored);
    if (prev.phase !== "playing") return reject("game-finished", "The game is over.");
    const f = faction(prev, playerId);
    if (!f || f.eliminated) return reject("not-in-game", "You're not in this game.");

    const state = structuredClone(prev);
    const tx = new Tx(state, ctx);
    if (action.type === "surrender") {
      surrender(tx, playerId);
      return { ok: true, transition: tx.finish() };
    }
    if (action.type === "answer-peace") {
      const err = answerPeace(tx, playerId, action.from, action.accept);
      return err ? reject("illegal", err) : { ok: true, transition: tx.finish() };
    }
    if (current(prev).id !== playerId) return reject("not-your-turn", "It's not your turn.");
    if (action.turn !== prev.turn) return reject("stale", "That was for an earlier turn.");

    const err = apply(tx, playerId, action);
    if (err) return reject("illegal", err);
    return { ok: true, transition: tx.finish() };
  },

  onTimer(stored, timerId, ctx) {
    const prev = upgrade(stored);
    if (timerId === BOT_TIMER) {
      if (prev.phase !== "playing" || !current(prev).bot) return { state: prev, events: [] };
      const tx = new Tx(structuredClone(prev), ctx);
      runBot(tx);
      return tx.finish();
    }
    if (timerId !== TURN_TIMER || prev.phase !== "playing" || prev.deadline === null) return { state: prev, events: [] };
    // A duplicate or early alarm is harmless: only a due deadline ends a turn.
    if (ctx.now < prev.deadline - TIMER_SLACK_MS) {
      return { state: prev, events: [], timers: [{ kind: "set", timerId: TURN_TIMER, delayMs: prev.deadline - ctx.now }] };
    }
    const tx = new Tx(structuredClone(prev), ctx);
    advanceTurn(tx);
    return tx.finish();
  },

  skipTurn(stored, playerId, ctx) {
    const prev = upgrade(stored);
    if (prev.phase !== "playing" || current(prev).id !== playerId) return { state: prev, events: [] };
    const tx = new Tx(structuredClone(prev), ctx);
    advanceTurn(tx);
    return tx.finish();
  },

  /** A removal is a surrender: their cities go neutral rather than vanishing. */
  /**
   * A removed player's empire isn't deleted (§14): the computer keeps it
   * going, at normal skill, under their name. It finishes the turn if it was
   * theirs. Surrendering is still theirs to choose while they're here.
   */
  onPlayerRemoved(stored, playerId, ctx) {
    const prev = upgrade(stored);
    const f = faction(prev, playerId);
    if (prev.phase !== "playing" || !f || f.eliminated || f.bot) return { state: prev, events: [] };
    const tx = new Tx(structuredClone(prev), ctx);
    const g = faction(tx.state, playerId)!;
    g.bot = { level: "normal", name: "" };
    if (current(tx.state).id === playerId) {
      tx.state.deadline = null;
      tx.timers.push({ kind: "cancel", timerId: TURN_TIMER }, { kind: "set", timerId: BOT_TIMER, delayMs: BOT_START_MS });
    }
    return tx.finish();
  },

  getPublicState(stored) {
    const state = upgrade(stored);
    return {
      size: state.size,
      round: state.round,
      turn: state.turn,
      phase: state.phase,
      currentPlayerId: state.phase === "playing" ? current(state).id : null,
      deadline: state.deadline,
      roundLimit: state.settings.roundLimit,
      victory: state.settings.victory,
      players: state.factions.map((f) => ({
        id: f.id,
        kind: f.kind,
        color: f.color,
        eliminated: f.eliminated,
        team: f.team ?? null,
        ...(f.bot && (f.bot.name ? { name: f.bot.name, bot: f.bot.level } : { bot: f.bot.level, caretaker: true })),
      })),
    };
  },

  getPrivateState(stored, playerId) {
    return projectFor(upgrade(stored), playerId);
  },

  getAwaitedPlayerIds(state) {
    // A computer's turn waits on nobody in the room.
    return state.phase === "playing" && !current(state).bot ? [current(state).id] : [];
  },

  getResult(state) {
    if (state.phase !== "finished" || !state.outcome) return null;
    const scores = state.factions.map((f) => ({ id: f.id, score: scoreOf(state, f.id), out: f.eliminated }));
    const winners = new Set(state.outcome.winnerIds);
    scores.sort((a, b) => Number(winners.has(b.id)) - Number(winners.has(a.id)) || Number(a.out) - Number(b.out) || b.score - a.score);
    return {
      winnerIds: state.outcome.winnerIds,
      standings: scores.map((s) => ({ playerId: s.id, value: s.score, label: `${s.score} pts${s.out ? ", fell" : ""}` })),
      names: Object.fromEntries(state.factions.flatMap((f) => (f.bot?.name ? [[f.id, `${f.bot.name} (computer)`]] : []))),
    };
  },
};
