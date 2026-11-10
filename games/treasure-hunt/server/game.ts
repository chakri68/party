import type { GameContext, GameDefinition, GameEventEnvelope, GameResult, GameTransition, TimerRequest } from "@games/game-core";
import { makeLayout } from "../shared/generate.ts";
import { treasureHuntManifest } from "../shared/manifest.ts";
import { READY_TIMEOUT_MS, type THAction, type THEvent, type THPublic, type THSettings, type THState } from "../shared/types.ts";

type Events = GameEventEnvelope<THEvent>[];

const READY_TIMER = "ready-timeout";

const pub = (event: THEvent): GameEventEnvelope<THEvent> => ({ visibility: { kind: "public" }, event });
const reject = (code: string, message: string): GameResult<THState, THEvent> => ({ ok: false, error: { code, message } });

const clone = (s: THState): THState => structuredClone(s);
const active = (s: THState) => s.players.filter((p) => !p.removed);

function finish(s: THState, ctx: GameContext, events: Events, timers: TimerRequest[]): void {
  s.phase = "finished";
  s.endedAt = ctx.now;
  timers.push({ kind: "cancel", timerId: READY_TIMER });
  events.push(pub({ type: "ended" }));
}

/** Everyone still here is ready: the round starts. Nobody here at all: it is over. */
function startIfReady(s: THState, ctx: GameContext, events: Events, timers: TimerRequest[]): void {
  if (s.phase !== "generating") return;
  const here = active(s);
  if (!here.length) return finish(s, ctx, events, timers);
  if (!here.every((p) => p.ready)) return;
  begin(s, ctx, events, timers);
}

function begin(s: THState, ctx: GameContext, events: Events, timers: TimerRequest[]): void {
  s.phase = "exploring";
  s.startedAt = ctx.now;
  timers.push({ kind: "cancel", timerId: READY_TIMER });
  events.push(pub({ type: "explore-start", spectators: s.players.filter((p) => p.spectator && !p.removed).map((p) => p.id) }));
}

const out = (state: THState, events: Events, timers: TimerRequest[]): GameTransition<THState, THEvent> => ({ state, events, timers });

export const treasureHuntGame: GameDefinition<THState, THAction, THPublic, Record<string, never>, THSettings, THEvent> = {
  manifest: treasureHuntManifest,

  defaultSettings: {},
  parseSettings: (input) => (input === undefined || input === null || (typeof input === "object" && !Array.isArray(input)) ? {} : null),
  parseAction(input) {
    if (typeof input !== "object" || input === null) return null;
    const type = (input as Record<string, unknown>).type;
    return type === "ready" || type === "end" ? { type } : null;
  },

  createGame(players, _settings, _match, ctx) {
    const seed = ctx.randomInt(2 ** 31);
    const state: THState = {
      phase: "generating",
      seed,
      layout: makeLayout(seed),
      players: players.map((p) => ({ id: p.id, ready: false, spectator: false, removed: false })),
      startedAt: null,
      endedAt: null,
    };
    return out(state, [], [{ kind: "set", timerId: READY_TIMER, delayMs: READY_TIMEOUT_MS }]);
  },

  handleAction(state, playerId, action, ctx) {
    const s = clone(state);
    const events: Events = [];
    const timers: TimerRequest[] = [];
    if (action.type === "ready") {
      // A slow tab can send this at any time. Anything but a first ready in generating is a no-op.
      const me = s.players.find((p) => p.id === playerId);
      if (s.phase !== "generating" || !me || me.removed || me.ready) return { ok: true, transition: out(s, events, timers) };
      me.ready = true;
      startIfReady(s, ctx, events, timers);
      return { ok: true, transition: out(s, events, timers) };
    }
    if (ctx.hostId !== playerId) return reject("not-host", "Only the host can end the round.");
    if (s.phase !== "exploring") return reject("not-exploring", "The round is not on yet.");
    finish(s, ctx, events, timers);
    return { ok: true, transition: out(s, events, timers) };
  },

  onTimer(state, timerId, ctx) {
    const s = clone(state);
    const events: Events = [];
    const timers: TimerRequest[] = [];
    if (timerId === READY_TIMER && s.phase === "generating") {
      for (const p of s.players) if (!p.removed && !p.ready) p.spectator = true;
      begin(s, ctx, events, timers);
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
    else if (s.phase === "exploring" && !active(s).length) finish(s, ctx, events, timers);
    return out(s, events, timers);
  },

  getPublicState: (s) => ({ phase: s.phase, layout: s.layout, players: s.players, startedAt: s.startedAt }),
  getPrivateState: () => ({}),
  getAwaitedPlayerIds: (s) => (s.phase === "generating" ? active(s).filter((p) => !p.ready).map((p) => p.id) : []),

  getResult(s) {
    if (s.phase !== "finished") return null;
    return { winnerIds: [], standings: [], headline: "Exploring is over." };
  },
};
