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
import { macroHeight } from "../shared/generate.ts";
import { treasureHuntManifest } from "../shared/manifest.ts";
import {
  DEFAULT_SETTINGS,
  parseTHSettings,
  type Phase,
  type THAction,
  type THCarry,
  type THEvent,
  type THPlayer,
  type THPrivate,
  type THPublic,
  type THReveal,
  type THSettings,
  type THTeam,
  type TreasureLayout,
} from "../shared/types.ts";
import { isTeamColorKey, TEAM_COLORS, type TeamColorKey } from "../shared/teams.ts";
import {
  CLAIM_CHECK,
  COUNTDOWN_MS,
  HEIGHT_TOL,
  JUMP_GRACE_MS,
  MAX_SPEED,
  MAX_TEAMS,
  POS_HZ,
  POS_STALE_MS,
  REVEAL_RADIUS,
} from "../shared/world.ts";
import type { Cache } from "./caches.ts";
import { makeHunt } from "./hunt.ts";

// The Timed round (§3, §6.3–6.4, §8):
//
//   teams       every client builds the map and says ready. Players pick
//               teams (up to MAX_TEAMS, one per colour); the host can move
//               anyone. The host starts: whoever isn't ready yet becomes a
//               spectator, and a team left with no hunters gets no pool.
//               Pools are dealt here, and again on the way out, once the
//               spectators are known.
//   countdown   COUNTDOWN_MS. Positions stream in, nobody moves (R8).
//   hunting     minutes × 60 000. Positions stream in and reveal pool caches
//               within REVEAL_RADIUS to their owner only. Claims are checked
//               against the last position. Ends on the timer, the host's end,
//               or when every hunter has cleared their pool.
//   finished    standings by found count, then difficulty, then who finished
//               first.
//
// Cache x/z never reach the public state. A player learns a cache's spot from
// its reveal relay or their private state, and only for their own pool.

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

export interface THServerPlayer extends THPlayer {
  /** Cache ids. Same size and difficulty mix for every hunter; empty for spectators. */
  pool: string[];
  found: string[];
  revealed: string[];
  lastClaimAt: number | null;
  pos: THPos | null;
  /** When the last too-fast move was seen. Claims wait JUMP_GRACE_MS after it. */
  jumpAt: number;
}

export interface THState {
  phase: Phase;
  seed: number;
  settings: THSettings;
  layout: TreasureLayout;
  /** Server only. Never in public state. */
  caches: Cache[];
  /** In id order. Every player's teamId is one of these, until they leave in the teams phase. */
  teams: THTeam[];
  players: THServerPlayer[];
  startedAt: number | null;
  endedAt: number | null;
  endsAt: number | null;
  countdownEndsAt: number | null;
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
 * Deal pools: min(8, floor(caches / players)) each, no cache in two pools.
 * Caches are sorted by difficulty and the ones dealt are spread evenly over
 * that order, so a small table still gets the map's mix rather than its
 * easiest caches. Each round of n caches then goes out hardest first to the
 * lowest running total: snake order, steered by the totals, which keeps them
 * within 1 of each other on nearly every map.
 */
export function dealPools(caches: Cache[], ids: string[]): Record<string, string[]> {
  const pools: Record<string, string[]> = Object.fromEntries(ids.map((id) => [id, []]));
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

function deal(s: THState): void {
  const ids = hunters(s).map((p) => p.id);
  const pools = dealPools(s.caches, ids);
  for (const p of s.players) p.pool = pools[p.id] ?? [];
}

function finish(s: THState, ctx: GameContext, events: Events, timers: TimerRequest[]): void {
  s.phase = "finished";
  s.endedAt = ctx.now;
  for (const timerId of [COUNTDOWN_TIMER, ROUND_TIMER]) timers.push({ kind: "cancel", timerId });
  events.push(pub({ type: "ended" }));
}

/** Every hunter still here has cleared their pool (or none is left). */
const allDone = (s: THState) => hunters(s).every((p) => p.found.length >= p.pool.length);

// --- Teams -----------------------------------------------------------------

const freeColor = (teams: THTeam[]): TeamColorKey | null => TEAM_COLORS.find((c) => !teams.some((t) => t.color === c.key))?.key ?? null;
const freeId = (teams: THTeam[]): number => {
  let id = 1;
  while (teams.some((t) => t.id === id)) id++;
  return id;
};

/** A new team in the first free colour, or null when all MAX_TEAMS are in use. */
function newTeam(s: THState, color: TeamColorKey | null = null): THTeam | null {
  if (s.teams.length >= MAX_TEAMS) return null;
  const c = color && !s.teams.some((t) => t.color === color) ? color : freeColor(s.teams);
  if (!c) return null;
  const team = { id: freeId(s.teams), color: c };
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

const members = (s: THState, teamId: number) => s.players.filter((p) => p.teamId === teamId);

function countdown(s: THState, ctx: GameContext, events: Events, timers: TimerRequest[]): void {
  // Safety net: a round nobody can play is over before it starts.
  if (!hunters(s).length) return finish(s, ctx, events, timers);
  s.phase = "countdown";
  s.countdownEndsAt = ctx.now + COUNTDOWN_MS;
  deal(s);
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

const out = (state: THState, events: Events, timers: TimerRequest[]): GameTransition<THState, THEvent> => ({ state, events, timers });
const ok = (state: THState, events: Events, timers: TimerRequest[]): GameResult<THState, THEvent> => ({ ok: true, transition: out(state, events, timers) });

/** Far past the edge ring (±950): anything bigger is junk, not a place. */
const POS_LIMIT = 2000;

function parsePos(data: unknown): Omit<THPos, "at"> | null {
  if (typeof data !== "object" || data === null) return null;
  const d = data as Record<string, unknown>;
  if (d.t !== "pos" || typeof d.foot !== "boolean") return null;
  const { x, y, z } = d;
  if (![x, y, z].every((v) => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= POS_LIMIT)) return null;
  return { x: x as number, y: y as number, z: z as number, foot: d.foot };
}

function claim(s: THState, playerId: string, cacheId: string, ctx: GameContext): GameResult<THState, THEvent> {
  if (s.phase !== "hunting") return reject("not-hunting", "The hunt is not on.");
  const me = s.players.find((p) => p.id === playerId);
  const cache = s.caches.find((c) => c.id === cacheId);
  if (!me || me.removed || !cache || !me.pool.includes(cacheId)) return reject("not-yours", "That cache is not on your list.");
  if (me.found.includes(cacheId)) return reject("already-found", "You already found this cache.");
  const pos = me.pos;
  if (!pos || ctx.now - pos.at > POS_STALE_MS) return reject("no-position", "We lost your position. Try again.");
  if (!pos.foot) return reject("in-vehicle", "Get out of the buggy first.");
  const far = Math.hypot(pos.x - cache.x, pos.z - cache.z) > CLAIM_CHECK || Math.abs(pos.y - macroHeight(s.layout, cache.x, cache.z)) > HEIGHT_TOL;
  if (far) return reject("too-far", "You are too far from the cache.");
  if (ctx.now - me.jumpAt < JUMP_GRACE_MS) return reject("moved-too-fast", "You moved too fast. Wait a few seconds.");

  const next = clone(s);
  const p = next.players.find((x) => x.id === playerId)!;
  p.found.push(cacheId);
  p.lastClaimAt = ctx.now;
  const events: Events = [pub({ type: "claimed", playerId, foundCount: p.found.length })];
  const timers: TimerRequest[] = [];
  if (allDone(next)) finish(next, ctx, events, timers);
  return ok(next, events, timers);
}

function difficultyFound(s: THState, p: THServerPlayer): number {
  return p.found.reduce((t, id) => t + (s.caches.find((c) => c.id === id)?.difficulty ?? 0), 0);
}

function result(s: THState): GameOutcome {
  const rows = s.players
    .filter((p) => !p.spectator)
    .map((p) => ({ id: p.id, n: p.found.length, d: difficultyFound(s, p), last: p.lastClaimAt ?? Number.MAX_SAFE_INTEGER }));
  // Most found, then the hardest finds, then whoever claimed their last one first.
  const cmp = (a: (typeof rows)[number], b: (typeof rows)[number]) => b.n - a.n || b.d - a.d || a.last - b.last;
  rows.sort(cmp);
  const top = rows[0];
  const winnerIds = top && top.n > 0 ? rows.filter((r) => cmp(r, top) === 0).map((r) => r.id) : [];
  return {
    winnerIds,
    standings: rows.map((r) => ({ playerId: r.id, value: r.n, label: `${r.n} found` })),
    ...(winnerIds.length ? {} : { headline: "Nobody found a cache." }),
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
    return null;
  },

  createGame(players, settings, match, ctx) {
    const { layout, caches } = makeHunt(ctx.randomInt(2 ** 31));
    const state: THState = {
      phase: "teams",
      seed: layout.seed,
      settings: parseTHSettings(settings) ?? DEFAULT_SETTINGS,
      layout,
      caches,
      teams: [],
      players: players.map((p) => ({
        id: p.id,
        ready: false,
        spectator: false,
        removed: false,
        teamId: null,
        pool: [],
        found: [],
        revealed: [],
        lastClaimAt: null,
        pos: null,
        jumpAt: NEVER,
      })),
      startedAt: null,
      endedAt: null,
      endsAt: null,
      countdownEndsAt: null,
    };
    seatTeams(state, match.carry);
    deal(state);
    return out(state, [], []);
  },

  handleAction(state, playerId, action, ctx) {
    if (action.type === "claim") return claim(state, playerId, action.cacheId, ctx);
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

  // 4 Hz per player: a shallow copy, never a structuredClone of the whole map.
  onStream(state, playerId, data, ctx) {
    if (!ctx || (state.phase !== "countdown" && state.phase !== "hunting")) return null;
    const me = state.players.find((p) => p.id === playerId);
    if (!me || me.removed || me.spectator) return null;
    const next = parsePos(data);
    if (!next) return null;
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
    const revealed = [...me.revealed];
    // A jump, or the grace after one, reveals nothing: a spoofed sweep of the
    // map would otherwise hand over every cache in the pool.
    const jumping = now - jumpAt < JUMP_GRACE_MS;
    for (const id of jumping ? [] : me.pool) {
      if (revealed.includes(id)) continue;
      const c = state.caches.find((x) => x.id === id);
      if (!c || Math.hypot(c.x - next.x, c.z - next.z) > REVEAL_RADIUS) continue;
      revealed.push(id);
      const data: THReveal = { t: "reveal", id, x: round1(c.x), z: round1(c.z), dy: c.dy };
      relays.push({ to: [playerId], data });
    }

    const player: THServerPlayer = { ...me, pos: { ...next, at: now }, jumpAt, revealed };
    const s: THState = { ...state, players: state.players.map((p) => (p.id === playerId ? player : p)) };
    return relays.length ? { state: s, relays } : { state: s, persist: false };
  },

  getPublicState: (s) => ({
    phase: s.phase,
    seed: s.layout.seed,
    teams: s.teams.map((t) => {
      const on = members(s, t.id);
      return { ...t, foundCount: on.reduce((n, p) => n + p.found.length, 0), poolSize: on.reduce((n, p) => n + p.pool.length, 0) };
    }),
    players: s.players.map((p) => ({
      id: p.id,
      ready: p.ready,
      spectator: p.spectator,
      removed: p.removed,
      teamId: p.teamId,
      foundCount: p.found.length,
      poolSize: p.pool.length,
    })),
    startedAt: s.startedAt,
    endsAt: s.endsAt,
    countdownEndsAt: s.countdownEndsAt,
  }),

  getPrivateState(s, playerId) {
    const me = s.players.find((p) => p.id === playerId);
    if (!me || me.removed) return { clues: [], revealed: [] };
    const cache = (id: string) => s.caches.find((c) => c.id === id)!;
    return {
      clues: me.pool.map((id) => {
        const c = cache(id);
        return { id, clues: c.clues, difficulty: c.difficulty, found: me.found.includes(id) };
      }),
      revealed: me.revealed.map((id) => {
        const c = cache(id);
        return { id, x: round1(c.x), z: round1(c.z), dy: c.dy };
      }),
    };
  },

  getAwaitedPlayerIds: (s) => (s.phase === "teams" ? active(s).filter((p) => !p.ready).map((p) => p.id) : []),

  getResult: (s) => (s.phase === "finished" ? result(s) : null),

  carryOver: (s): THCarry => ({
    teams: s.teams
      .map((t) => ({ color: t.color, members: members(s, t.id).filter((p) => !p.removed).map((p) => p.id) }))
      .filter((t) => t.members.length),
  }),
};
