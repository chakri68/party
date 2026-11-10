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
  READY_TIMEOUT_MS,
  type Phase,
  type THAction,
  type THEvent,
  type THPlayer,
  type THPrivate,
  type THPublic,
  type THReveal,
  type THSettings,
  type TreasureLayout,
} from "../shared/types.ts";
import {
  CLAIM_CHECK,
  COUNTDOWN_MS,
  HEIGHT_TOL,
  JUMP_GRACE_MS,
  MAX_SPEED,
  POS_HZ,
  POS_STALE_MS,
  REVEAL_RADIUS,
} from "../shared/world.ts";
import type { Cache } from "./caches.ts";
import { makeHunt } from "./hunt.ts";

// The Timed round (§3, §6.3–6.4, §8):
//
//   generating  every client builds the map and says ready. At the timeout,
//               if anyone is ready, the rest become spectators; if nobody
//               is, the timer re-arms and the room keeps waiting. Pools are
//               dealt here, and again on the way out, once the spectators
//               are known.
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

const READY_TIMER = "ready-timeout";
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
  for (const timerId of [READY_TIMER, COUNTDOWN_TIMER, ROUND_TIMER]) timers.push({ kind: "cancel", timerId });
  events.push(pub({ type: "ended" }));
}

/** Every hunter still here has cleared their pool (or none is left). */
const allDone = (s: THState) => hunters(s).every((p) => p.found.length >= p.pool.length);

/** Everyone still here is ready: the countdown starts. Nobody here at all: it is over. */
function startIfReady(s: THState, ctx: GameContext, events: Events, timers: TimerRequest[]): void {
  if (s.phase !== "generating") return;
  const here = active(s);
  if (!here.length) return finish(s, ctx, events, timers);
  if (!here.every((p) => p.ready)) return;
  countdown(s, ctx, events, timers);
}

function countdown(s: THState, ctx: GameContext, events: Events, timers: TimerRequest[]): void {
  // Safety net: a round nobody can play is over before it starts.
  if (!hunters(s).length) return finish(s, ctx, events, timers);
  s.phase = "countdown";
  s.countdownEndsAt = ctx.now + COUNTDOWN_MS;
  deal(s);
  timers.push({ kind: "cancel", timerId: READY_TIMER }, { kind: "set", timerId: COUNTDOWN_TIMER, delayMs: COUNTDOWN_MS });
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

export const treasureHuntGame: GameDefinition<THState, THAction, THPublic, THPrivate, THSettings, THEvent> = {
  manifest: treasureHuntManifest,

  defaultSettings: DEFAULT_SETTINGS,
  parseSettings: parseTHSettings,
  parseAction(input) {
    if (typeof input !== "object" || input === null) return null;
    const a = input as Record<string, unknown>;
    if (a.type === "ready" || a.type === "end") return { type: a.type };
    if (a.type === "claim" && typeof a.cacheId === "string" && a.cacheId.length <= 16) return { type: "claim", cacheId: a.cacheId };
    return null;
  },

  createGame(players, settings, _match, ctx) {
    const { layout, caches } = makeHunt(ctx.randomInt(2 ** 31));
    const state: THState = {
      phase: "generating",
      seed: layout.seed,
      settings: parseTHSettings(settings) ?? DEFAULT_SETTINGS,
      layout,
      caches,
      players: players.map((p) => ({
        id: p.id,
        ready: false,
        spectator: false,
        removed: false,
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
    deal(state);
    return out(state, [], [{ kind: "set", timerId: READY_TIMER, delayMs: READY_TIMEOUT_MS }]);
  },

  handleAction(state, playerId, action, ctx) {
    if (action.type === "claim") return claim(state, playerId, action.cacheId, ctx);
    const s = clone(state);
    const events: Events = [];
    const timers: TimerRequest[] = [];
    if (action.type === "ready") {
      // A slow tab can send this at any time. Anything but a first ready in generating is a no-op.
      const me = s.players.find((p) => p.id === playerId);
      if (s.phase !== "generating" || !me || me.removed || me.ready) return ok(s, events, timers);
      me.ready = true;
      startIfReady(s, ctx, events, timers);
      return ok(s, events, timers);
    }
    if (ctx.hostId !== playerId) return reject("not-host", "Only the host can end the round.");
    if (s.phase !== "hunting") return reject("not-hunting", "The hunt is not on yet.");
    finish(s, ctx, events, timers);
    return ok(s, events, timers);
  },

  onTimer(state, timerId, ctx) {
    const s = clone(state);
    const events: Events = [];
    const timers: TimerRequest[] = [];
    if (timerId === READY_TIMER && s.phase === "generating") {
      const here = active(s);
      if (!here.length) {
        finish(s, ctx, events, timers);
      } else if (!here.some((p) => p.ready)) {
        // Nobody has loaded yet (a slow first download): keep waiting rather
        // than turn the whole table into spectators of an empty round.
        timers.push({ kind: "set", timerId: READY_TIMER, delayMs: READY_TIMEOUT_MS });
      } else {
        for (const p of here) if (!p.ready) p.spectator = true;
        countdown(s, ctx, events, timers);
      }
    } else if (timerId === COUNTDOWN_TIMER && s.phase === "countdown") {
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
    if (s.phase === "generating") startIfReady(s, ctx, events, timers);
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
    layout: s.layout,
    players: s.players.map((p) => ({
      id: p.id,
      ready: p.ready,
      spectator: p.spectator,
      removed: p.removed,
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

  getAwaitedPlayerIds: (s) => (s.phase === "generating" ? active(s).filter((p) => !p.ready).map((p) => p.id) : []),

  getResult: (s) => (s.phase === "finished" ? result(s) : null),
};
