import { type GameContext, type GameDefinition, type GameEventEnvelope, type GameResult, type TimerRequest } from "@games/game-core";
import { isWord } from "@games/words/dictionary";
import { chainWordsManifest } from "../shared/manifest.ts";
import { OPENERS } from "../shared/openers.ts";
import { lastLetter, MAX_WORD, normalizeWord, ordinal, parseTyping, shapeProblem, type TypingData } from "../shared/rules.ts";
import {
  CHAIN_SHOWN,
  type ChainWordsAction,
  type ChainWordsEvent,
  type ChainWordsPlayerState,
  type ChainWordsPrivateState,
  type ChainWordsPublicState,
  type ChainWordsServerState,
  type ChainWordsSettings,
  DEFAULT_SETTINGS,
  LIVES_OPTIONS,
  TURN_OPTIONS,
} from "../shared/types.ts";
import { LETTERS, wordsOn } from "./words.ts";

type State = ChainWordsServerState;
type Player = ChainWordsPlayerState;
type Events = GameEventEnvelope<ChainWordsEvent>[];

const pub = (event: ChainWordsEvent): GameEventEnvelope<ChainWordsEvent> => ({ visibility: { kind: "public" }, event });

const reject = (code: string, message: string): GameResult<State, ChainWordsEvent> => ({
  ok: false,
  error: { code, message },
});

/** One timer: the holder's clock. Setting it again replaces it. */
const TURN = "turn";
/** An alarm this early is a stray, not the deadline (Dominion's guard). */
const SLACK_MS = 500;

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
const used = (state: State) => state.chain.map((l) => l.word);
const turnMs = (state: State) => state.settings.turnSeconds * 1000;

/**
 * The next living seat after `from`, preferring someone who's actually here:
 * a turn handed to a dropped connection just runs out on them. If everyone
 * else is away, so be it. (The Bomb's rule, minus its `self` case.)
 */
function nextAlive(state: State, from: number): Player | null {
  const n = state.players.length;
  const order = Array.from({ length: n - 1 }, (_, k) => state.players[(from + k + 1) % n]!).filter(alive);
  return order.find((p) => !p.away) ?? order[0] ?? null;
}

function finish(state: State, out: Out): void {
  state.phase = "finished";
  state.typing = "";
  out.timers.push({ kind: "cancel", timerId: TURN });
  const left = state.players.filter(alive);
  out.events.push(pub({ type: "game-over", winnerId: left.length === 1 ? left[0]!.id : null }));
}

/** Ends the game if it's down to one, and says whether it did. */
function settled(state: State, out: Out): boolean {
  if (state.players.filter(alive).length > 1) return false;
  finish(state, out);
  return true;
}

/** Hands the turn to `to` with a full clock. */
function startTurn(state: State, to: Player, ctx: GameContext, out: Out): void {
  state.holderId = to.id;
  state.turn++;
  state.typing = "";
  state.deadline = ctx.now + turnMs(state);
  out.timers.push({ kind: "set", timerId: TURN, delayMs: turnMs(state) });
}

/**
 * Nothing left on the letter: swap it for one that has words, and say so.
 * False if the whole dictionary's gone, which ends the game.
 */
function rescue(state: State, ctx: GameContext, out: Out): boolean {
  const taken = used(state);
  if (wordsOn(state.letter, taken) > 0) return true;
  const open = [...LETTERS].filter((l) => wordsOn(l, taken) > 0);
  if (!open.length) {
    finish(state, out);
    return false;
  }
  const to = open[ctx.randomInt(open.length)]!;
  out.events.push(pub({ type: "rescued", from: state.letter, to }));
  state.letter = to;
  return true;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function parseSettings(input: unknown): ChainWordsSettings | null {
  if (input === undefined || input === null) return { ...DEFAULT_SETTINGS };
  if (typeof input !== "object" || Array.isArray(input)) return null;
  const s = { ...DEFAULT_SETTINGS, ...(input as Partial<ChainWordsSettings>) };
  if (!TURN_OPTIONS.includes(s.turnSeconds) || !LIVES_OPTIONS.includes(s.lives)) return null;
  return { turnSeconds: s.turnSeconds, lives: s.lives };
}

function parseAction(input: unknown): ChainWordsAction | null {
  if (typeof input !== "object" || input === null) return null;
  const a = input as Record<string, unknown>;
  if (a.type === "word" && typeof a.text === "string" && a.text.length <= MAX_WORD * 2) {
    const text = normalizeWord(a.text);
    return text ? { type: "word", text } : null;
  }
  return null;
}

/** Injected opener lists (tests, dev tools): lowercase words. */
function normalizeOpeners(input: unknown[]): string[] {
  const ok = input.every((w) => typeof w === "string" && /^[a-z]{3,30}$/.test(w));
  if (!input.length || !ok) throw new Error("An opener list must be lowercase words, e.g. [\"rocket\"].");
  return [...new Set(input as string[])];
}

// ---------------------------------------------------------------------------
// Definition
// ---------------------------------------------------------------------------

export const chainWordsGame: GameDefinition<
  ChainWordsServerState,
  ChainWordsAction,
  ChainWordsPublicState,
  ChainWordsPrivateState,
  ChainWordsSettings,
  ChainWordsEvent
> = {
  manifest: chainWordsManifest,
  defaultSettings: DEFAULT_SETTINGS,
  parseSettings,
  parseAction,

  createGame(players, settings, match, ctx, options) {
    const n = players.length;
    const { minPlayers, maxPlayers } = chainWordsManifest;
    if (n < minPlayers || n > maxPlayers) {
      throw new Error(`chain-words: needs ${minPlayers}–${maxPlayers} players, got ${n}`);
    }
    const openers = options?.deck ? normalizeOpeners(options.deck) : OPENERS;
    const word = openers[ctx.randomInt(openers.length)]!;
    const dealer = ((match.dealerSeat % n) + n) % n;
    const state: State = {
      phase: "live",
      settings,
      players: players.map((p) => ({ id: p.id, lives: settings.lives, removed: false, away: false, words: 0 })),
      turn: 0,
      holderId: "",
      letter: lastLetter(word),
      deadline: 0,
      chain: [{ playerId: null, word }],
      outOrder: [],
      typing: "",
    };
    const out = newOut();
    // The dealer's left goes first.
    const first = state.players[(dealer + 1) % n]!;
    out.events.push(pub({ type: "opened", word, holderId: first.id }));
    if (rescue(state, ctx, out)) startTurn(state, first, ctx, out);
    return done(state, out);
  },

  handleAction(prev, playerId, action, ctx) {
    if (prev.phase === "finished") return reject("game-finished", "The game is over.");
    const me = prev.players.find((p) => p.id === playerId);
    if (!me || !alive(me)) return reject("not-in-game", "You're out. You can still watch.");
    if (prev.holderId !== playerId) return reject("not-your-turn", "It is not your turn.");

    const word = action.text;
    const problem = shapeProblem(word, prev.letter);
    if (problem) return reject("bad-word", problem);
    if (prev.chain.some((l) => l.word === word)) return reject("used", "Someone already used this word.");
    if (!isWord(word)) return reject("not-a-word", "This word is not in the dictionary.");

    const state = clone(prev);
    const out = newOut();
    state.chain.push({ playerId, word });
    state.players[seatOf(state, playerId)]!.words++;
    state.letter = lastLetter(word);
    // Two or more are alive, or the game would be over: there's always a next.
    const next = nextAlive(state, seatOf(state, playerId))!;
    out.events.push(pub({ type: "played", playerId, word, to: next.id }));
    if (rescue(state, ctx, out)) startTurn(state, next, ctx, out);
    return { ok: true, transition: done(state, out) };
  },

  onTimer(prev, timerId, ctx) {
    if (prev.phase === "finished" || timerId !== TURN) return { state: prev, events: [] };
    // A duplicate or early alarm is harmless: only a due deadline costs a life.
    if (ctx.now < prev.deadline - SLACK_MS) {
      return { state: prev, events: [], timers: [{ kind: "set", timerId: TURN, delayMs: prev.deadline - ctx.now }] };
    }
    const state = clone(prev);
    const out = newOut();
    const seat = seatOf(state, state.holderId);
    const holder = state.players[seat]!;
    holder.lives--;
    if (!holder.lives) state.outOrder.push(holder.id);
    const next = state.players.filter(alive).length > 1 ? nextAlive(state, seat) : null;
    out.events.push(pub({ type: "timeout", playerId: holder.id, lives: holder.lives, to: next?.id ?? null }));
    // Same letter for the next one: timing out isn't a way to dodge it.
    if (next) startTurn(state, next, ctx, out);
    else finish(state, out);
    return done(state, out);
  },

  onPlayerDisconnected(prev, playerId) {
    const idx = seatOf(prev, playerId);
    if (prev.phase === "finished" || idx < 0) return { state: prev, events: [] };
    // Holding the turn doesn't get you out of it: the clock keeps running, and
    // the host can skip a dropped holder straight away.
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
    // Walking out on your turn hands it on, with a full clock for whoever's next.
    const to = state.holderId === playerId ? nextAlive(state, idx) : null;
    if (to) startTurn(state, to, ctx, out);
    out.events.push(pub({ type: "left", playerId, to: to?.id ?? null }));
    return done(state, out);
  },

  skipTurn(prev, playerId, ctx) {
    if (prev.phase !== "live" || prev.holderId !== playerId) return { state: prev, events: [] };
    const state = clone(prev);
    const out = newOut();
    const to = nextAlive(state, seatOf(state, playerId))!;
    startTurn(state, to, ctx, out);
    out.events.push(pub({ type: "skipped", from: playerId, to: to.id }));
    return done(state, out);
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
      turn: state.turn,
      holderId: state.holderId,
      letter: state.letter,
      deadline: state.deadline,
      turnMs: turnMs(state),
      chain: state.chain.slice(-CHAIN_SHOWN),
      chainLength: state.chain.length,
      maxLives: state.settings.lives,
      players: state.players.map((p) => ({ id: p.id, lives: p.lives, removed: p.removed, words: p.words })),
      outOrder: state.outOrder,
    };
  },

  getPrivateState(state, playerId) {
    return { holding: state.phase === "live" && state.holderId === playerId };
  },

  // The holder's who everyone's waiting on. The clock sorts them out; a
  // dropped one can be skipped by the host.
  getAwaitedPlayerIds(state) {
    return state.phase === "live" ? [state.holderId] : [];
  },

  getResult(state) {
    if (state.phase !== "finished") return null;
    // Last one standing (or everyone left, if the dictionary ran dry), then
    // the rest by how long they lasted, then leavers.
    const rank = (p: Player) => {
      const out = state.outOrder.indexOf(p.id);
      return alive(p) ? -1 : out >= 0 ? state.outOrder.length - out : 1000;
    };
    return {
      winnerIds: state.players.filter(alive).map((p) => p.id),
      standings: [...state.players]
        .sort((a, b) => rank(a) - rank(b))
        .map((p) => {
          const out = state.outOrder.indexOf(p.id);
          const how = alive(p)
            ? `${p.lives} ${p.lives === 1 ? "life" : "lives"} left`
            : out < 0
              ? "left the game"
              : out === 0
                ? "first out"
                : `out ${ordinal(out + 1)}`;
          return { playerId: p.id, value: p.lives, label: `${how}, ${p.words} ${p.words === 1 ? "word" : "words"}` };
        }),
    };
  },
};
