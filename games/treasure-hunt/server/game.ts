import type {
  GameContext,
  GameDefinition,
  GameEventEnvelope,
  GameOutcome,
  GameResult,
  GameTransition,
  StreamRelay,
  TimerRequest,
} from "@games/game-core";
import { buggySlots } from "../shared/buggies.ts";
import { macroHeight } from "../shared/generate.ts";
import { treasureHuntManifest } from "../shared/manifest.ts";
import {
  DEFAULT_SETTINGS,
  parseTHSettings,
  type Phase,
  type Pin,
  type THAction,
  type THCarry,
  type THEvent,
  type THPlayer,
  type THPrivate,
  type THPublic,
  type THPosRelay,
  type THReplay,
  type THReveal,
  type THSettings,
  type THTeam,
  type TreasureLayout,
  type Seat,
  type Vehicle,
} from "../shared/types.ts";
import { isTeamColorKey, TEAM_COLORS, teamColor, type TeamColorKey } from "../shared/teams.ts";
import {
  CLAIM_CHECK,
  COUNTDOWN_MS,
  HEIGHT_TOL,
  JUMP_GRACE_MS,
  MAX_SPEED,
  MAX_TEAMS,
  PIN_CAP,
  POS_HZ,
  POS_STALE_MS,
  RACE_OPEN_START,
  REVEAL_RADIUS,
  SEAT_RANGE,
  SEAT_STALE_MS,
  TRACK_CAP,
  TRACK_MIN_M,
  TRACK_MIN_MS,
  UNSEAT_Y_SLACK,
} from "../shared/world.ts";
import { rng } from "../shared/noise.ts";
import type { Cache } from "./caches.ts";
import { startMinOf } from "../shared/sky.ts";
import { makeHunt } from "./hunt.ts";

// The Timed round (§3, §6.3–6.4, §8):
//
//   teams       every client builds the map and says ready. Players pick
//               teams (up to MAX_TEAMS, one per colour); the host can move
//               anyone. The host starts: whoever isn't ready yet becomes a
//               spectator, and a team left with no hunters gets no pool.
//               Every pool is empty here: they're dealt per team at start,
//               once the spectators are known.
//   countdown   COUNTDOWN_MS. Positions stream in, nobody moves (R8).
//   hunting     minutes × 60 000. Positions stream in and reveal pool caches
//               within REVEAL_RADIUS to the hunter's whole team. Any hunter on
//               a team can claim its caches. Claims are checked against the
//               claimer's last position. Ends on the timer, the host's end,
//               or when every team in play has cleared its pool.
//   finished    teams ranked by found count, then difficulty, then who
//               finished first. Each player's row is their team's.
//
// Race to N (§6.3, §8) runs the same phases, with one shared list instead of
// pools. Every cache goes into a seeded release order at start. The first
// RACE_OPEN_START + (claims by every team) are open, for every team alike. A
// claimed cache stays on the list, shown found or taken, and is never
// revealed again. The first team to `target` wins at once; the timer still
// caps the round, and then the Timed ranking decides.
//
// Buggies (§7.2): one parked by the spawn per team in play, plus a few loose
// ones by set pieces, all placed at start. Two seats each, taken in hunting
// only. The driver's stream moves the buggy; getting out sets where it rests.
// Seats free when their player leaves; the round ending frees nothing.
//
// "In play" means the team has a hunter: a member still here, not watching.
// A team whose hunters all leave mid-round keeps its finds and its place in
// the result. Spectators see their team's board and reveals, but never claim.
//
// Cache x/z never reach the public state. A player learns a cache's spot from
// its reveal relay or their private state, and only for their team's pool.

const COUNTDOWN_TIMER = "countdown";
const ROUND_TIMER = "round";

/** The last position a player streamed. In memory: it persists with the next real write. */
export interface THPos {
  x: number;
  y: number;
  z: number;
  foot: boolean;
  at: number;
}

export interface THServerTeam extends THTeam {
  /** Timed: cache ids, same size and difficulty mix for every team in play; empty for the rest. Race: always empty. */
  pool: string[];
  found: string[];
  /** Revealed to the team, by whichever member got close first. */
  revealed: string[];
  lastClaimAt: number | null;
}

export interface THServerPlayer extends THPlayer {
  pos: THPos | null;
  /** When the last too-fast move was seen. Claims wait JUMP_GRACE_MS after it. */
  jumpAt: number;
  /** Route points: [s since start, x, z], ints. Hunting only, thinned at TRACK_CAP. */
  route: [number, number, number][];
  /** The last route point's real time and spot. In memory. */
  routeLast: { at: number; x: number; z: number } | null;
  /** Points are kept TRACK_MIN_MS × this apart. Doubles each time the route hits TRACK_CAP. `?? 1` on old rooms. */
  routeStep: number;
}

/** A claim, kept for the replay. */
export interface THFind {
  cacheId: string;
  teamId: number;
  playerId: string;
  /** Seconds since the start. */
  t: number;
  x: number;
  z: number;
}

export interface THState {
  phase: Phase;
  seed: number;
  settings: THSettings;
  /** Resolved once at createGame, so "random" is the same for everyone. */
  sky: { startMin: number };
  layout: TreasureLayout;
  /** Server only. Never in public state. */
  caches: Cache[];
  /** Race: every cache id in release order, set at start. Empty in Timed and before start. */
  release: string[];
  /** In id order. Every player's teamId is one of these, until they leave in the teams phase. */
  teams: THServerTeam[];
  players: THServerPlayer[];
  finds: THFind[];
  /** Set at start: a team slot per team in play, then every loose slot. Empty before. */
  vehicles: Vehicle[];
  /** Every team's pins, oldest first. `?? []`: rooms saved before pins. */
  pins: (Pin & { team: number })[];
  /** Next pin id is "q" + this. `?? 0` on old rooms. */
  pinSeq: number;
  startedAt: number | null;
  endedAt: number | null;
  endsAt: number | null;
  countdownEndsAt: number | null;
  /** When a stream snapshot last asked for a write. In memory; a reload just writes a little early. */
  lastPersistAt?: number;
}

type Events = GameEventEnvelope<THEvent>[];

const NEVER = Number.MIN_SAFE_INTEGER;
const MAX_POOL = 8;

const pub = (event: THEvent): GameEventEnvelope<THEvent> => ({ visibility: { kind: "public" }, event });
const reject = (code: string, message: string): GameResult<THState, THEvent> => ({ ok: false, error: { code, message } });

const clone = (s: THState): THState => structuredClone(s);
const active = (s: THState) => s.players.filter((p) => !p.removed);
/** Still here and hunting: the players the round waits on. */
const hunters = (s: THState) => s.players.filter((p) => !p.removed && !p.spectator);
const round1 = (v: number) => Math.round(v * 10) / 10;

/**
 * Deal pools: min(8, floor(caches / teams)) each, no cache in two pools.
 * Caches are sorted by difficulty and the ones dealt are spread evenly over
 * that order, so a small table still gets the map's mix rather than its
 * easiest caches. Each round of n caches then goes out hardest first to the
 * lowest running total: snake order, steered by the totals, which keeps them
 * within 1 of each other on nearly every map.
 */
export function dealPools(caches: Cache[], ids: number[]): Record<number, string[]> {
  const pools: Record<number, string[]> = Object.fromEntries(ids.map((id) => [id, []]));
  const n = ids.length;
  if (!n) return pools;
  const size = Math.min(MAX_POOL, Math.floor(caches.length / n));
  const sorted = [...caches].sort((a, b) => a.difficulty - b.difficulty);
  const m = size * n;
  const dealt = Array.from({ length: m }, (_, k) => sorted[Math.floor(((k + 0.5) * sorted.length) / m)]!);
  const totals = ids.map(() => 0);
  for (let r = 0; r < size; r++) {
    const hand = dealt.slice(r * n, r * n + n).reverse();
    const order = ids.map((_, i) => i).sort((a, b) => totals[a]! - totals[b]! || a - b);
    order.forEach((i, k) => {
      pools[ids[i]!]!.push(hand[k]!.id);
      totals[i]! += hand[k]!.difficulty;
    });
  }
  return pools;
}

const members = (s: THState, teamId: number) => s.players.filter((p) => p.teamId === teamId);
/** Has a hunter right now. */
const inPlay = (s: THState, t: THTeam) => members(s, t.id).some((p) => !p.removed && !p.spectator);
/** Had a hunter when the round started, even if they have all left since. */
const ranked = (s: THState, t: THTeam) => members(s, t.id).some((p) => !p.spectator);
const teamOf = (s: THState, p: THPlayer) => s.teams.find((t) => t.id === p.teamId);

/** Every cache in a Fisher–Yates shuffle seeded from the map: the same seed, the same order. */
export function releaseOrder(caches: Cache[], seed: number): string[] {
  const r = rng(seed ^ 0x52414345);
  const ids = caches.map((c) => c.id);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
  }
  return ids;
}

const race = (s: THState) => s.settings.mode === "race";
const totalClaims = (s: THState) => s.teams.reduce((n, t) => n + t.found.length, 0);
/** Race: the caches open right now, the same for every team. slice caps it at every cache. `?? []`: rooms saved before Race. */
const openIds = (s: THState) => (s.release ?? []).slice(0, RACE_OPEN_START + totalClaims(s));
const claimedBy = (s: THState, cacheId: string) => s.teams.find((t) => t.found.includes(cacheId));
/** The caches a team hunts: its pool in Timed, the open list in Race. */
const board = (s: THState, t: THServerTeam) => (race(s) ? openIds(s) : t.pool);

function deal(s: THState): void {
  if (race(s)) {
    s.release = releaseOrder(s.caches, s.layout.seed);
    for (const t of s.teams) t.pool = [];
    return;
  }
  const pools = dealPools(s.caches, s.teams.filter((t) => inPlay(s, t)).map((t) => t.id));
  for (const t of s.teams) t.pool = pools[t.id] ?? [];
}

function finish(s: THState, ctx: GameContext, events: Events, timers: TimerRequest[]): void {
  s.phase = "finished";
  s.endedAt = ctx.now;
  for (const timerId of [COUNTDOWN_TIMER, ROUND_TIMER]) timers.push({ kind: "cancel", timerId });
  events.push(pub({ type: "ended" }));
}

/**
 * The round is over. Timed: every team in play has cleared its pool (or none
 * is left). Race: a team hit the target, every cache is claimed, or no team is
 * left in play.
 */
function allDone(s: THState): boolean {
  const live = s.teams.filter((t) => inPlay(s, t));
  if (!race(s)) return live.every((t) => t.found.length >= t.pool.length);
  return !live.length || s.teams.some((t) => t.found.length >= s.settings.target) || totalClaims(s) >= s.caches.length;
}

// --- Teams -----------------------------------------------------------------

const freeColor = (teams: THTeam[]): TeamColorKey | null => TEAM_COLORS.find((c) => !teams.some((t) => t.color === c.key))?.key ?? null;
const freeId = (teams: THTeam[]): number => {
  let id = 1;
  while (teams.some((t) => t.id === id)) id++;
  return id;
};

/** A new team in the first free colour, or null when all MAX_TEAMS are in use. */
function newTeam(s: THState, color: TeamColorKey | null = null): THServerTeam | null {
  if (s.teams.length >= MAX_TEAMS) return null;
  const c = color && !s.teams.some((t) => t.color === color) ? color : freeColor(s.teams);
  if (!c) return null;
  const team: THServerTeam = { id: freeId(s.teams), color: c, pool: [], found: [], revealed: [], lastClaimAt: null };
  s.teams.push(team);
  s.teams.sort((a, b) => a.id - b.id);
  return team;
}

/** Drops teams nobody (still here) is on. Their colours are free again. */
function prune(s: THState): void {
  s.teams = s.teams.filter((t) => s.players.some((p) => !p.removed && p.teamId === t.id));
}

function move(s: THState, playerId: string, teamId: number): void {
  s.players.find((p) => p.id === playerId)!.teamId = teamId;
  prune(s);
}

/** Back to the carried teams; anyone the carry doesn't place gets a team of their own. */
function seatTeams(s: THState, carry: unknown): void {
  const c = carry as Partial<THCarry> | null | undefined;
  const placed = new Set<string>();
  if (c && typeof c === "object" && Array.isArray(c.teams)) {
    for (const t of c.teams) {
      if (!t || typeof t !== "object" || !Array.isArray(t.members)) continue;
      const members = s.players.filter((p) => !placed.has(p.id) && t.members.includes(p.id));
      if (!members.length) continue;
      const team = newTeam(s, isTeamColorKey(t.color) ? t.color : null);
      if (!team) break;
      for (const p of members) {
        p.teamId = team.id;
        placed.add(p.id);
      }
    }
  }
  for (const p of s.players) {
    if (placed.has(p.id)) continue;
    // maxPlayers is MAX_TEAMS, so this never runs out; if it does, share the first team.
    p.teamId = (newTeam(s) ?? s.teams[0]!).id;
  }
}

/** Team slots go t0, t1, … to the teams in play, in team order. Loose slots are for anyone. */
function park(s: THState): void {
  const slots = buggySlots(s.layout);
  const team = slots.filter((x) => x.id.startsWith("t")).slice(0, s.teams.filter((t) => inPlay(s, t)).length);
  const loose = slots.filter((x) => x.id.startsWith("l"));
  s.vehicles = [...team, ...loose].map(({ id, x, z, yaw }) => ({ id, x, y: null, z, yaw, driver: null, passenger: null }));
}

function countdown(s: THState, ctx: GameContext, events: Events, timers: TimerRequest[]): void {
  // Safety net: a round nobody can play is over before it starts.
  if (!hunters(s).length) return finish(s, ctx, events, timers);
  s.phase = "countdown";
  s.countdownEndsAt = ctx.now + COUNTDOWN_MS;
  deal(s);
  park(s);
  timers.push({ kind: "set", timerId: COUNTDOWN_TIMER, delayMs: COUNTDOWN_MS });
  events.push(pub({ type: "countdown", spectators: s.players.filter((p) => p.spectator && !p.removed).map((p) => p.id) }));
}

function hunt(s: THState, ctx: GameContext, events: Events, timers: TimerRequest[]): void {
  if (!hunters(s).length) return finish(s, ctx, events, timers);
  const ms = s.settings.minutes * 60_000;
  s.phase = "hunting";
  s.startedAt = ctx.now;
  s.endsAt = ctx.now + ms;
  timers.push({ kind: "set", timerId: ROUND_TIMER, delayMs: ms });
  events.push(pub({ type: "hunt-start" }));
}

/** Hunters' routes, removed ones included, and every find. Spectators never hunted. */
function replay(s: THState): THReplay {
  return {
    durationS: s.startedAt === null || s.endedAt === null ? 0 : Math.round((s.endedAt - s.startedAt) / 1000),
    tracks: s.players.filter((p) => !p.spectator && p.teamId !== null).map((p) => ({ playerId: p.id, teamId: p.teamId!, points: (p.route ?? []).map((r) => [...r] as [number, number, number]) })),
    finds: (s.finds ?? []).map((f) => ({ ...f })),
  };
}

const out = (state: THState, events: Events, timers: TimerRequest[]): GameTransition<THState, THEvent> => ({ state, events, timers });
const ok = (state: THState, events: Events, timers: TimerRequest[]): GameResult<THState, THEvent> => ({ ok: true, transition: out(state, events, timers) });

/** Far past the edge ring (±950): anything bigger is junk, not a place. */
const POS_LIMIT = 2000;

const round2 = (v: number) => Math.round(v * 100) / 100;

function parsePos(data: unknown): (Omit<THPos, "at"> & { yaw: number; v: string | null }) | null {
  if (typeof data !== "object" || data === null) return null;
  const d = data as Record<string, unknown>;
  if (d.t !== "pos" || typeof d.foot !== "boolean") return null;
  const { x, y, z } = d;
  if (![x, y, z].every((v) => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= POS_LIMIT)) return null;
  // Godot sends the M2 shape until the client catches up: no yaw, no v.
  const yaw = d.yaw ?? 0;
  if (typeof yaw !== "number" || !Number.isFinite(yaw)) return null;
  const v = d.v ?? null;
  if (v !== null && (typeof v !== "string" || v.length < 1 || v.length > 8)) return null;
  return { x: x as number, y: y as number, z: z as number, foot: d.foot, yaw, v };
}

function claim(s: THState, playerId: string, cacheId: string, ctx: GameContext): GameResult<THState, THEvent> {
  if (s.phase !== "hunting") return reject("not-hunting", "The hunt is not on.");
  const me = s.players.find((p) => p.id === playerId);
  const team = me && teamOf(s, me);
  const cache = s.caches.find((c) => c.id === cacheId);
  // Spectators watch: their team's list is not theirs to claim from.
  if (!me || me.removed || me.spectator || !team || !cache || !board(s, team).includes(cacheId)) {
    return reject("not-yours", "That cache is not on your team's list.");
  }
  const by = claimedBy(s, cacheId);
  if (by && by.id !== team.id) return reject("taken", "Another team found this cache first.");
  if (team.found.includes(cacheId)) return reject("already-found", "Your team already found this cache.");
  const pos = me.pos;
  if (!pos || ctx.now - pos.at > POS_STALE_MS) return reject("no-position", "We lost your position. Try again.");
  if (!pos.foot) return reject("in-vehicle", "Get out of the buggy first.");
  const far = Math.hypot(pos.x - cache.x, pos.z - cache.z) > CLAIM_CHECK || Math.abs(pos.y - macroHeight(s.layout, cache.x, cache.z)) > HEIGHT_TOL;
  if (far) return reject("too-far", "You are too far from the cache.");
  if (ctx.now - me.jumpAt < JUMP_GRACE_MS) return reject("moved-too-fast", "You moved too fast. Wait a few seconds.");

  const next = clone(s);
  const t = next.teams.find((x) => x.id === team.id)!;
  t.found.push(cacheId);
  t.lastClaimAt = ctx.now;
  (next.finds ??= []).push({ cacheId, teamId: team.id, playerId, t: Math.round((ctx.now - (s.startedAt ?? ctx.now)) / 1000), x: Math.round(cache.x), z: Math.round(cache.z) });
  const events: Events = [pub({ type: "claimed", playerId, foundCount: t.found.length })];
  const timers: TimerRequest[] = [];
  if (allDone(next)) finish(next, ctx, events, timers);
  return ok(next, events, timers);
}

const PIN_LIMIT = 950;

/** Pins are a hunter's, in countdown and hunting. A team's pins are its own: the cap is per player. */
function pinAction(s: THState, playerId: string, action: Extract<THAction, { type: "pin" | "unpin" }>): GameResult<THState, THEvent> {
  if (s.phase !== "countdown" && s.phase !== "hunting") return reject("not-hunting", "The hunt is not on.");
  const me = s.players.find((p) => p.id === playerId);
  if (!me || me.removed || me.spectator || me.teamId === null) return reject("not-in-game", "You are not in this game.");
  const next = clone(s);
  next.pins ??= [];
  next.pinSeq ??= 0;
  if (action.type === "unpin") {
    const pin = next.pins.find((p) => p.id === action.pinId);
    if (!pin) return reject("no-pin", "That pin is gone.");
    if (pin.by !== playerId) return reject("not-your-pin", "You can only remove your own pins.");
    next.pins = next.pins.filter((p) => p !== pin);
    return ok(next, [], []);
  }
  const { x, z } = action;
  if (!Number.isFinite(x) || !Number.isFinite(z) || Math.abs(x) > PIN_LIMIT || Math.abs(z) > PIN_LIMIT)
    return reject("bad-pin", "You can't put a pin there.");
  next.pins.push({ id: `q${next.pinSeq++}`, by: playerId, x: round1(x), z: round1(z), team: me.teamId });
  const own = next.pins.filter((p) => p.by === playerId);
  if (own.length > PIN_CAP) next.pins = next.pins.filter((p) => p !== own[0]);
  return ok(next, [], []);
}

/** The vehicle I hold a seat in, and which seat. `?? []`: rooms saved before buggies. */
function seatOf(s: THState, playerId: string): { v: Vehicle; seat: Seat } | null {
  for (const v of s.vehicles ?? []) {
    if (v.driver === playerId) return { v, seat: "driver" };
    if (v.passenger === playerId) return { v, seat: "passenger" };
  }
  return null;
}

type SeatAction = Extract<THAction, { type: "seat" | "unseat" }>;

/** How far (XZ) a driver can get out from where the buggy last streamed. */
const UNSEAT_SLACK = 5;

function seatAction(s: THState, playerId: string, action: SeatAction, ctx: GameContext): GameResult<THState, THEvent> {
  if (s.phase !== "hunting") return reject("not-hunting", "The hunt is not on.");
  const me = s.players.find((p) => p.id === playerId);
  if (!me || me.removed || me.spectator) return reject("not-in-game", "You are not in this game.");
  const next = clone(s);
  next.vehicles ??= [];
  const held = seatOf(next, playerId);

  if (action.type === "unseat") {
    if (!held) return reject("not-seated", "You are not in a buggy.");
    const { v, seat } = held;
    v[seat] = null;
    // Only the driver moved it. Trust the sent pose, but only within reach of the last streamed one.
    if (seat === "driver") {
      const dx = action.x - v.x;
      const dz = action.z - v.z;
      const d = Math.hypot(dx, dz);
      const k = d > UNSEAT_SLACK ? UNSEAT_SLACK / d : 1;
      v.x = round2(v.x + dx * k);
      v.z = round2(v.z + dz * k);
      // Never driven: no streamed y to hold it to, so the ground under it will do.
      const y0 = v.y ?? macroHeight(s.layout, v.x, v.z);
      const slack = v.y === null ? UNSEAT_Y_SLACK : HEIGHT_TOL;
      v.y = round2(Math.min(y0 + slack, Math.max(y0 - slack, action.y)));
      v.yaw = round2(action.yaw);
    }
    return ok(next, [], []);
  }

  const v = next.vehicles.find((x) => x.id === action.vehicleId);
  if (!v) return reject("no-vehicle", "That buggy is not here.");
  const pos = me.pos;
  if (!pos || ctx.now - pos.at > POS_STALE_MS) return reject("no-position", "We lost your position. Try again.");
  if (held) return reject("in-vehicle", "Get out of the buggy first.");
  if (Math.hypot(pos.x - v.x, pos.z - v.z) > SEAT_RANGE) return reject("too-far-seat", "Go closer to the buggy.");
  // A holder who stopped streaming (a closed tab, a sleeping laptop) has left it.
  // Seats don't free on disconnect: a page reload would lose them.
  const holder = v[action.seat];
  const theirs = holder === null ? null : next.players.find((p) => p.id === holder)?.pos;
  if (holder !== null && theirs && ctx.now - theirs.at <= SEAT_STALE_MS) return reject("seat-taken", "Someone is already in that seat.");
  // Taking it clears the stale holder.
  v[action.seat] = playerId;
  return ok(next, [], []);
}

function difficultyFound(s: THState, t: THServerTeam): number {
  return t.found.reduce((n, id) => n + (s.caches.find((c) => c.id === id)?.difficulty ?? 0), 0);
}

const teamName = (t: THTeam) => teamColor(t.color).name;

function result(s: THState): GameOutcome {
  // Spectators watched: they get no row. Hunters who left keep theirs.
  const rows = s.teams
    .filter((t) => ranked(s, t))
    .map((t) => ({
      team: t,
      ids: members(s, t.id).filter((p) => !p.spectator).map((p) => p.id),
      n: t.found.length,
      d: difficultyFound(s, t),
      last: t.lastClaimAt ?? Number.MAX_SAFE_INTEGER,
    }));
  // Most found, then the hardest finds, then whoever claimed their last one first.
  const cmp = (a: (typeof rows)[number], b: (typeof rows)[number]) => b.n - a.n || b.d - a.d || a.last - b.last;
  rows.sort(cmp);
  const top = rows[0];
  const winners = top && top.n > 0 ? rows.filter((r) => cmp(r, top) === 0) : [];
  const headline = !winners.length ? "Nobody found a cache." : winners.length > 1 ? "It's a tie." : `Team ${teamName(winners[0]!.team)} wins`;
  return {
    winnerIds: winners.flatMap((r) => r.ids),
    standings: rows.flatMap((r) => r.ids.map((playerId) => ({ playerId, value: r.n, label: `${r.n} found · ${teamName(r.team)}` }))),
    headline,
  };
}

const isTeamId = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 99;

type TeamAction = Extract<THAction, { type: "team.join" | "team.new" | "team.assign" | "start" }>;

/** Team picks and the host's start: all in the teams phase. `s` is already a clone. */
function teamAction(s: THState, playerId: string, action: TeamAction, ctx: GameContext): GameResult<THState, THEvent> {
  const events: Events = [];
  const timers: TimerRequest[] = [];
  const me = s.players.find((p) => p.id === playerId);
  if (!me || me.removed) return reject("not-in-game", "You are not in this game.");
  const host = ctx.hostId === playerId;
  if ((action.type === "start" || action.type === "team.assign") && !host) {
    return reject("not-host", action.type === "start" ? "Only the host can start the round." : "Only the host can move players.");
  }
  if (s.phase !== "teams") return reject("wrong-phase", "Teams are picked before the hunt.");

  switch (action.type) {
    case "team.join": {
      if (!s.teams.some((t) => t.id === action.teamId)) return reject("no-such-team", "That team does not exist.");
      if (me.teamId === action.teamId) return reject("already-there", "You are already on that team.");
      move(s, playerId, action.teamId);
      break;
    }
    case "team.new": {
      const team = newTeam(s);
      if (!team) return reject("too-many-teams", `There are already ${MAX_TEAMS} teams.`);
      move(s, playerId, team.id);
      break;
    }
    case "team.assign": {
      const them = s.players.find((p) => p.id === action.playerId);
      if (!them || them.removed) return reject("not-in-game", "That player is not in this game.");
      if (!s.teams.some((t) => t.id === action.teamId)) return reject("no-such-team", "That team does not exist.");
      move(s, action.playerId, action.teamId);
      break;
    }
    case "start": {
      const here = active(s);
      if (!here.some((p) => p.ready)) return reject("nobody-ready", "Wait until someone has loaded the map.");
      for (const p of here) if (!p.ready) p.spectator = true;
      countdown(s, ctx, events, timers);
      break;
    }
  }
  return ok(s, events, timers);
}

export const treasureHuntGame: GameDefinition<THState, THAction, THPublic, THPrivate, THSettings, THEvent> = {
  manifest: treasureHuntManifest,

  defaultSettings: DEFAULT_SETTINGS,
  parseSettings: parseTHSettings,
  parseAction(input) {
    if (typeof input !== "object" || input === null) return null;
    const a = input as Record<string, unknown>;
    if (a.type === "ready" || a.type === "end") return { type: a.type };
    if (a.type === "claim" && typeof a.cacheId === "string" && a.cacheId.length <= 16) return { type: "claim", cacheId: a.cacheId };
    if (a.type === "team.new" || a.type === "start") return { type: a.type };
    if (a.type === "team.join" && isTeamId(a.teamId)) return { type: "team.join", teamId: a.teamId };
    if (a.type === "team.assign" && isTeamId(a.teamId) && typeof a.playerId === "string" && a.playerId.length <= 64)
      return { type: "team.assign", playerId: a.playerId, teamId: a.teamId };
    if (a.type === "seat" && typeof a.vehicleId === "string" && a.vehicleId.length >= 1 && a.vehicleId.length <= 8 && (a.seat === "driver" || a.seat === "passenger"))
      return { type: "seat", vehicleId: a.vehicleId, seat: a.seat };
    if (a.type === "pin" && typeof a.x === "number" && typeof a.z === "number") return { type: "pin", x: a.x, z: a.z };
    if (a.type === "unpin" && typeof a.pinId === "string" && a.pinId.length <= 8) return { type: "unpin", pinId: a.pinId };
    if (a.type === "unseat") {
      const { x, y, z, yaw } = a;
      const place = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= POS_LIMIT;
      if (place(x) && place(y) && place(z) && typeof yaw === "number" && Number.isFinite(yaw)) return { type: "unseat", x, y, z, yaw };
    }
    return null;
  },

  createGame(players, settings, match, ctx) {
    const parsed = parseTHSettings(settings) ?? DEFAULT_SETTINGS;
    const carried = (match.carry as Partial<THCarry> | null | undefined)?.seed;
    const s = parsed.map === "same" && typeof carried === "number" && Number.isInteger(carried) ? carried : ctx.randomInt(2 ** 31);
    const startMin = startMinOf(parsed.time, s);
    const { layout, caches } = makeHunt(s, { startMin, minutes: parsed.minutes, race: parsed.mode === "race" });
    const state: THState = {
      phase: "teams",
      seed: layout.seed,
      settings: parsed,
      sky: { startMin },
      layout,
      caches,
      release: [],
      teams: [],
      players: players.map((p) => ({
        id: p.id,
        ready: false,
        spectator: false,
        removed: false,
        teamId: null,
        pos: null,
        jumpAt: NEVER,
        route: [],
        routeLast: null,
        routeStep: 1,
      })),
      finds: [],
      vehicles: [],
      pins: [],
      pinSeq: 0,
      startedAt: null,
      endedAt: null,
      endsAt: null,
      countdownEndsAt: null,
    };
    // No deal yet: pools are dealt at start, so a lobby team switch can't show a rival's clues.
    seatTeams(state, match.carry);
    return out(state, [], []);
  },

  handleAction(state, playerId, action, ctx) {
    if (action.type === "claim") return claim(state, playerId, action.cacheId, ctx);
    if (action.type === "pin" || action.type === "unpin") return pinAction(state, playerId, action);
    if (action.type === "seat" || action.type === "unseat") return seatAction(state, playerId, action, ctx);
    const s = clone(state);
    const events: Events = [];
    const timers: TimerRequest[] = [];
    if (action.type === "ready") {
      // A slow tab can send this at any time. Anything but a first ready in teams is a no-op.
      // It never starts the round: the host does.
      const me = s.players.find((p) => p.id === playerId);
      if (s.phase !== "teams" || !me || me.removed || me.ready) return ok(s, events, timers);
      me.ready = true;
      return ok(s, events, timers);
    }
    if (action.type === "end") {
      if (ctx.hostId !== playerId) return reject("not-host", "Only the host can end the round.");
      if (s.phase !== "hunting") return reject("not-hunting", "The hunt is not on yet.");
      finish(s, ctx, events, timers);
      return ok(s, events, timers);
    }
    return teamAction(s, playerId, action, ctx);
  },

  onTimer(state, timerId, ctx) {
    const s = clone(state);
    const events: Events = [];
    const timers: TimerRequest[] = [];
    if (timerId === COUNTDOWN_TIMER && s.phase === "countdown") {
      hunt(s, ctx, events, timers);
    } else if (timerId === ROUND_TIMER && s.phase === "hunting") {
      finish(s, ctx, events, timers);
    }
    return out(s, events, timers);
  },

  onPlayerRemoved(state, playerId, ctx) {
    const s = clone(state);
    const events: Events = [];
    const timers: TimerRequest[] = [];
    const p = s.players.find((x) => x.id === playerId);
    if (!p || p.removed) return out(s, events, timers);
    p.removed = true;
    // Their seats free. A driven buggy rests at its last streamed pose.
    for (const v of s.vehicles ?? []) {
      if (v.driver === playerId) v.driver = null;
      if (v.passenger === playerId) v.passenger = null;
    }
    // Pins only exist in countdown and hunting; outside them this finds none.
    s.pins = (s.pins ?? []).filter((x) => x.by !== playerId);
    events.push(pub({ type: "player-removed", playerId }));
    if (s.phase === "teams") {
      // Their team goes with them if they were its last member. Nobody left at all: it is over.
      p.teamId = null;
      prune(s);
      if (!active(s).length) finish(s, ctx, events, timers);
    }
    // Gone mid-round: they stop counting toward "everyone is done".
    else if ((s.phase === "countdown" || s.phase === "hunting") && allDone(s)) finish(s, ctx, events, timers);
    return out(s, events, timers);
  },

  // 10 Hz per player: a shallow copy, never a structuredClone of the whole map.
  onStream(state, playerId, data, ctx) {
    if (!ctx || (state.phase !== "countdown" && state.phase !== "hunting")) return null;
    const me = state.players.find((p) => p.id === playerId);
    if (!me || me.removed || me.spectator) return null;
    const snap = parsePos(data);
    // In a buggy and on foot at once: one of them is a lie.
    if (!snap || (snap.v !== null && snap.foot)) return null;
    // The seat is the server's: the stream's foot and v only had to agree with each other.
    const held = seatOf(state, playerId);
    const next = { x: snap.x, y: snap.y, z: snap.z, foot: !held };
    const now = ctx.now;

    let jumpAt = me.jumpAt;
    const prev = me.pos;
    if (prev) {
      const gap = now - prev.at;
      // Messages can arrive bunched: never judge a gap shorter than one send interval.
      const secs = Math.max(gap, 1000 / POS_HZ) / 1000;
      if (gap < 2000 && Math.hypot(next.x - prev.x, next.z - prev.z) > MAX_SPEED * secs) jumpAt = now;
    }

    const relays: StreamRelay[] = [];
    const team = teamOf(state, me);
    const revealed = [...(team?.revealed ?? [])];
    // A jump, or the grace after one, reveals nothing: a spoofed sweep of the
    // map would otherwise hand over every cache in the pool.
    const jumping = now - jumpAt < JUMP_GRACE_MS;
    // The whole team watches, spectators too.
    const to = team ? members(state, team.id).filter((p) => !p.removed).map((p) => p.id) : [];
    for (const id of jumping || !team ? [] : board(state, team)) {
      // In Race a claimed cache is gone: nobody gets it revealed after that.
      if (revealed.includes(id) || (race(state) && claimedBy(state, id))) continue;
      const c = state.caches.find((x) => x.id === id);
      if (!c || Math.hypot(c.x - next.x, c.z - next.z) > REVEAL_RADIUS) continue;
      revealed.push(id);
      const data: THReveal = { t: "reveal", id, x: round1(c.x), z: round1(c.z), dy: c.dy };
      relays.push({ to, data });
    }

    // A route point: at most one per TRACK_MIN_MS × routeStep, and only after TRACK_MIN_M of walking.
    // At TRACK_CAP every other point goes (both ends stay) and the step doubles, so a long
    // round keeps its whole route at a lower rate. `?? []`, `?? 1`: rooms saved before these.
    let route = me.route ?? [];
    let routeLast = me.routeLast ?? null;
    let routeStep = me.routeStep ?? 1;
    if (state.phase === "hunting" && state.startedAt !== null) {
      const last = routeLast;
      if (!last || (now - last.at >= TRACK_MIN_MS * routeStep && Math.hypot(next.x - last.x, next.z - last.z) >= TRACK_MIN_M)) {
        route = [...route, [Math.round((now - state.startedAt) / 1000), Math.round(next.x), Math.round(next.z)]];
        routeLast = { at: now, x: next.x, z: next.z };
        if (route.length >= TRACK_CAP) {
          route = route.filter((_, i) => i % 2 === 0 || i === route.length - 1);
          routeStep *= 2;
        }
      }
    }

    const player: THServerPlayer = { ...me, pos: { ...next, at: now }, jumpAt, route, routeLast, routeStep };
    const players = state.players.map((p) => (p.id === playerId ? player : p));
    const relay: THPosRelay = { t: "pos", x: round2(snap.x), y: round2(snap.y), z: round2(snap.z), yaw: round2(snap.yaw), foot: !held, v: held?.v.id ?? null };
    const teams = relays.length ? state.teams.map((t) => (t === team ? { ...t, revealed } : t)) : state.teams;
    // The driver's snapshot is the buggy's pose. In memory, like everything here, until the next write.
    const vehicles =
      held?.seat !== "driver" ? state.vehicles : state.vehicles.map((v) => (v === held.v ? { ...v, x: relay.x, y: relay.y, z: relay.z, yaw: relay.yaw } : v));
    // One write a second for the whole room (§9), plus one for every reveal: a reveal must survive a restart.
    const persist = relays.length > 0 || now - (state.lastPersistAt ?? NEVER) >= TRACK_MIN_MS;
    return {
      state: { ...state, players, teams, vehicles, ...(persist ? { lastPersistAt: now } : {}) },
      relay,
      ...(relays.length ? { relays } : {}),
      persist,
    };
  },

  getPublicState: (s) => ({
    phase: s.phase,
    mode: s.settings.mode,
    target: s.settings.target,
    sky: { startMin: s.sky.startMin },
    seed: s.layout.seed,
    teams: s.teams.map((t) => ({ id: t.id, color: t.color, foundCount: t.found.length, poolSize: race(s) ? s.settings.target : t.pool.length })),
    players: s.players.map((p) => ({ id: p.id, ready: p.ready, spectator: p.spectator, removed: p.removed, teamId: p.teamId })),
    startedAt: s.startedAt,
    endsAt: s.endsAt,
    countdownEndsAt: s.countdownEndsAt,
    replay: s.phase === "finished" ? replay(s) : null,
    vehicles: (s.vehicles ?? []).map((v) => ({ ...v })),
  }),

  getPrivateState(s, playerId) {
    const me = s.players.find((p) => p.id === playerId);
    const team = me && !me.removed ? teamOf(s, me) : undefined;
    if (!team) return { teamId: null, clues: [], revealed: [], pins: [] };
    const cache = (id: string) => s.caches.find((c) => c.id === id)!;
    // Spectators get the same board: they watch, they can't claim.
    return {
      teamId: team.id,
      clues: board(s, team).map((id) => {
        const c = cache(id);
        const by = claimedBy(s, id);
        // Only a board cache's pose goes out: Race's unreleased ones never reach here. `?? null`: caches saved before photos.
        return { id, clues: c.clues, difficulty: c.difficulty, found: by === team, taken: !!by && by !== team, photo: c.photo ?? null };
      }),
      revealed: team.revealed.map((id) => {
        const c = cache(id);
        return { id, x: round1(c.x), z: round1(c.z), dy: c.dy };
      }),
      pins: (s.pins ?? []).filter((p) => p.team === team.id).map(({ id, by, x, z }) => ({ id, by, x, z })),
    };
  },

  getAwaitedPlayerIds: (s) => (s.phase === "teams" ? active(s).filter((p) => !p.ready).map((p) => p.id) : []),

  getResult: (s) => (s.phase === "finished" ? result(s) : null),

  carryOver: (s): THCarry => ({
    seed: s.layout.seed,
    teams: s.teams
      .map((t) => ({ color: t.color, members: members(s, t.id).filter((p) => !p.removed).map((p) => p.id) }))
      .filter((t) => t.members.length),
  }),
};
