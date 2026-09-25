import { type GameContext, type GameDefinition, type GameEventEnvelope, type GameResult, type TimerRequest } from "@games/game-core";
import { passTheBombManifest } from "../shared/manifest.ts";
import { normalizeWord, ordinal, parseTyping, shapeProblem } from "../shared/rules.ts";
import {
  BOOM_MS,
  DEFAULT_SETTINGS,
  FUSE_MS,
  FUSE_OPTIONS,
  LIVES_OPTIONS,
  MAX_WORD,
  type PassTheBombAction,
  type PassTheBombEvent,
  type PassTheBombPlayerState,
  type PassTheBombPrivateState,
  type PassTheBombPublicState,
  type PassTheBombServerState,
  type PassTheBombSettings,
  type TypingData,
} from "../shared/types.ts";
import { CLUSTERS, isWord } from "./words.ts";

type State = PassTheBombServerState;
type Player = PassTheBombPlayerState;
type Events = GameEventEnvelope<PassTheBombEvent>[];

const pub = (event: PassTheBombEvent): GameEventEnvelope<PassTheBombEvent> => ({ visibility: { kind: "public" }, event });

const reject = (code: string, message: string): GameResult<State, PassTheBombEvent> => ({
  ok: false,
  error: { code, message },
});

/**
 * One timer, reused: while live it's the fuse, during the boom it's the next
 * round. Setting it again replaces it, so a pass never has to touch it.
 */
const FUSE = "fuse";

// ---------------------------------------------------------------------------
// Internals. Helpers mutate the state they're given; the public API always
// hands them a fresh clone. `Out` gathers what the transition says besides state.
// ---------------------------------------------------------------------------

interface Out {
  events: Events;
  timers: TimerRequest[];
}

const clone = (state: State): State => structuredClone(state);
const newOut = (): Out => ({ events: [], timers: [] });
const done = (state: State, out: Out) => ({ state, events: out.events, timers: out.timers });

const alive = (p: Player) => !p.removed && p.lives > 0;
const seatOf = (state: State, id: string) => state.players.findIndex((p) => p.id === id);

/** A cluster that isn't the one just played, when there's a choice. */
function pickCluster(state: State, ctx: GameContext): string {
  const pool = state.clusters.length > 1 ? state.clusters.filter((c) => c !== state.cluster) : state.clusters;
  return pool[ctx.randomInt(pool.length)]!;
}

/**
 * The next living seat after `from` (or `from` itself, with `self`),
 * preferring someone who's actually here: a bomb handed to a dropped
 * connection just burns down on them. If everyone else is away, so be it.
 */
function nextAlive(state: State, from: number, self = false): Player | null {
  const n = state.players.length;
  const order = Array.from({ length: self ? n : n - 1 }, (_, k) => state.players[(from + (self ? k : k + 1)) % n]!).filter(alive);
  return order.find((p) => !p.away) ?? order[0] ?? null;
}

function finish(state: State, out: Out): void {
  state.phase = "finished";
  state.typing = "";
  out.timers.push({ kind: "cancel", timerId: FUSE });
  out.events.push(pub({ type: "game-over", winnerId: state.players.find(alive)?.id ?? null }));
}

/** Ends the game if it's down to one, and says whether it did. */
function settled(state: State, out: Out): boolean {
  if (state.players.filter(alive).length > 1) return false;
  finish(state, out);
  return true;
}

function giveBomb(state: State, to: Player, ctx: GameContext): void {
  state.holderId = to.id;
  state.turn++;
  state.cluster = pickCluster(state, ctx);
  state.typing = "";
}

/** A fresh fuse, lit in the hands of whoever it last went off on (or the next one along). */
function startRound(state: State, ctx: GameContext, out: Out): void {
  const from = state.blownId ? seatOf(state, state.blownId) : seatOf(state, state.holderId);
  const holder = nextAlive(state, Math.max(from, 0), true);
  if (!holder) return finish(state, out);
  const [lo, hi] = FUSE_MS[state.settings.fuse];
  const fuse = lo + ctx.randomInt(hi - lo + 1);
  state.phase = "live";
  state.round++;
  state.blownId = null;
  giveBomb(state, holder, ctx);
  out.timers.push({ kind: "set", timerId: FUSE, delayMs: fuse });
  out.events.push(pub({ type: "round-started", round: state.round, holderId: holder.id }));
}

/** Hands the bomb on without touching the fuse. Null if there's nobody to take it. */
function pass(state: State, ctx: GameContext): Player | null {
  const next = nextAlive(state, seatOf(state, state.holderId));
  if (next) giveBomb(state, next, ctx);
  return next;
}

function explode(state: State, out: Out): void {
  const holder = state.players[seatOf(state, state.holderId)]!;
  holder.lives--;
  if (!holder.lives) state.outOrder.push(holder.id);
  state.phase = "boom";
  state.blownId = holder.id;
  state.typing = "";
  out.events.push(pub({ type: "boom", playerId: holder.id, lives: holder.lives }));
  if (!settled(state, out)) out.timers.push({ kind: "set", timerId: FUSE, delayMs: BOOM_MS });
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function parseSettings(input: unknown): PassTheBombSettings | null {
  if (input === undefined || input === null) return { ...DEFAULT_SETTINGS };
  if (typeof input !== "object" || Array.isArray(input)) return null;
  const s = { ...DEFAULT_SETTINGS, ...(input as Partial<PassTheBombSettings>) };
  if (!LIVES_OPTIONS.includes(s.lives) || !FUSE_OPTIONS.includes(s.fuse)) return null;
  return { lives: s.lives, fuse: s.fuse };
}

function parseAction(input: unknown): PassTheBombAction | null {
  if (typeof input !== "object" || input === null) return null;
  const a = input as Record<string, unknown>;
  if (a.type === "word" && typeof a.text === "string" && a.text.length <= MAX_WORD * 2) {
    const text = normalizeWord(a.text);
    return text ? { type: "word", text } : null;
  }
  return null;
}

/** Injected cluster lists (tests, dev tools): short lowercase letter runs. */
function normalizeClusters(input: unknown[]): string[] {
  const ok = input.every((c) => typeof c === "string" && /^[a-z]{1,4}$/.test(c));
  if (!input.length || !ok) throw new Error("A cluster list must be short lowercase letter runs, e.g. [\"ing\", \"tr\"].");
  return [...new Set(input as string[])];
}

// ---------------------------------------------------------------------------
// Definition
// ---------------------------------------------------------------------------

export const passTheBombGame: GameDefinition<
  PassTheBombServerState,
  PassTheBombAction,
  PassTheBombPublicState,
  PassTheBombPrivateState,
  PassTheBombSettings,
  PassTheBombEvent
> = {
  manifest: passTheBombManifest,
  defaultSettings: DEFAULT_SETTINGS,
  parseSettings,
  parseAction,

  createGame(players, settings, match, ctx, options) {
    const n = players.length;
    const { minPlayers, maxPlayers } = passTheBombManifest;
    if (n < minPlayers || n > maxPlayers) {
      throw new Error(`pass-the-bomb: needs ${minPlayers}–${maxPlayers} players, got ${n}`);
    }
    const dealer = ((match.dealerSeat % n) + n) % n;
    const state: State = {
      phase: "live",
      settings,
      players: players.map((p) => ({ id: p.id, lives: settings.lives, removed: false, away: false })),
      round: 0,
      turn: 0,
      // The dealer's left lights the first one.
      holderId: players[(dealer + 1) % n]!.id,
      cluster: "",
      blownId: null,
      lastWord: null,
      used: [],
      outOrder: [],
      clusters: options?.deck ? normalizeClusters(options.deck) : [...CLUSTERS],
      typing: "",
    };
    const out = newOut();
    startRound(state, ctx, out);
    return done(state, out);
  },

  handleAction(prev, playerId, action, ctx) {
    if (prev.phase === "finished") return reject("game-finished", "The game is over.");
    const me = prev.players.find((p) => p.id === playerId);
    if (!me || !alive(me)) return reject("not-in-game", "You're out. Heckle freely.");
    if (prev.phase !== "live") return reject("not-live", "Hang on, the next round's coming.");
    if (prev.holderId !== playerId) return reject("not-holding", "You're not holding the bomb.");

    const word = action.text;
    const problem = shapeProblem(word, prev.cluster);
    if (problem) return reject("bad-word", problem);
    if (prev.used.includes(word)) return reject("used", "Already played this game.");
    if (!isWord(word)) return reject("not-a-word", "Not in the dictionary.");

    const state = clone(prev);
    const out = newOut();
    state.used.push(word);
    state.lastWord = { playerId, word };
    const to = pass(state, ctx);
    // Only one alive means the game ended already; pass always finds someone.
    out.events.push(pub({ type: "passed", from: playerId, to: to!.id, word }));
    return { ok: true, transition: done(state, out) };
  },

  onTimer(prev, timerId, ctx) {
    if (prev.phase === "finished" || timerId !== FUSE) return { state: prev, events: [] };
    const state = clone(prev);
    const out = newOut();
    if (state.phase === "live") explode(state, out);
    else startRound(state, ctx, out);
    return done(state, out);
  },

  onPlayerDisconnected(prev, playerId) {
    const idx = seatOf(prev, playerId);
    if (prev.phase === "finished" || idx < 0) return { state: prev, events: [] };
    // Holding it doesn't get you out of it: the fuse keeps burning, and the
    // host can skip a dropped holder straight away (§12.2).
    const state = clone(prev);
    state.players[idx]!.away = true;
    return { state, events: [] };
  },

  onPlayerReconnected(prev, playerId) {
    const idx = seatOf(prev, playerId);
    if (idx < 0 || !prev.players[idx]!.away) return { state: prev, events: [] };
    const state = clone(prev);
    state.players[idx]!.away = false;
    return { state, events: [] };
  },

  onPlayerRemoved(prev, playerId, ctx) {
    const idx = seatOf(prev, playerId);
    if (prev.phase === "finished" || idx < 0 || prev.players[idx]!.removed) return { state: prev, events: [] };
    const state = clone(prev);
    const out = newOut();
    state.players[idx]!.removed = true;
    if (settled(state, out)) return done(state, out);
    // Walking out with it lit passes it on, fuse and all.
    const to = state.phase === "live" && state.holderId === playerId ? pass(state, ctx) : null;
    out.events.push(pub({ type: "left", playerId, to: to?.id ?? null }));
    return done(state, out);
  },

  skipTurn(prev, playerId, ctx) {
    if (prev.phase !== "live" || prev.holderId !== playerId) return { state: prev, events: [] };
    const state = clone(prev);
    const to = pass(state, ctx)!;
    return { state, events: [pub({ type: "skipped", from: playerId, to: to.id })] };
  },

  onStream(state, playerId, data) {
    const typing = parseTyping(data);
    if (!typing || state.phase !== "live" || state.holderId !== playerId || typing.turn !== state.turn) return null;
    return { state: { ...state, typing: typing.text }, relay: typing };
  },

  getStreamSnapshot(state): TypingData {
    return { turn: state.turn, text: state.typing };
  },

  getPublicState(state) {
    return {
      phase: state.phase,
      round: state.round,
      turn: state.turn,
      holderId: state.holderId,
      cluster: state.cluster,
      blownId: state.blownId,
      lastWord: state.lastWord,
      usedCount: state.used.length,
      maxLives: state.settings.lives,
      players: state.players.map((p) => ({ id: p.id, lives: p.lives, removed: p.removed })),
      outOrder: state.outOrder,
    };
  },

  getPrivateState(state, playerId) {
    return { holding: state.phase === "live" && state.holderId === playerId };
  },

  // The holder's who everyone's waiting on. Mostly the fuse sorts them out;
  // a dropped one can be skipped by the host.
  getAwaitedPlayerIds(state) {
    return state.phase === "live" ? [state.holderId] : [];
  },

  getResult(state) {
    if (state.phase !== "finished") return null;
    const winner = state.players.find(alive);
    // Last one standing, then the rest by how long they lasted, then leavers.
    const rank = (p: Player) => {
      const out = state.outOrder.indexOf(p.id);
      return alive(p) ? -1 : out >= 0 ? state.outOrder.length - out : 1000;
    };
    return {
      winnerIds: winner ? [winner.id] : [],
      standings: [...state.players]
        .sort((a, b) => rank(a) - rank(b))
        .map((p) => {
          const out = state.outOrder.indexOf(p.id);
          const label = alive(p)
            ? `${p.lives} ${p.lives === 1 ? "life" : "lives"} left`
            : out < 0
              ? "left"
              : out === 0
                ? "first out"
                : `out ${ordinal(out + 1)}`;
          return { playerId: p.id, value: p.lives, label };
        }),
    };
  },
};
