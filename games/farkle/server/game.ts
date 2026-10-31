import type { GameContext, GameDefinition, GameEventEnvelope, GameResult, TimerRequest } from "@games/game-core";
import { farkleManifest } from "../shared/manifest.ts";
import { bestSelection, diceToRoll, formatPoints, isFarkle, scoreDice } from "../shared/rules.ts";
import {
  BUST_MS,
  DEFAULT_SETTINGS,
  DICE,
  ENTRY_OPTIONS,
  TARGET_OPTIONS,
  THREE_FARKLE_PENALTY,
  type EndReason,
  type FarkleAction,
  type FarkleEvent,
  type FarklePlayerState,
  type FarklePrivateState,
  type FarklePublicState,
  type FarkleServerState,
  type FarkleSettings,
} from "../shared/types.ts";

type State = FarkleServerState;
type Player = FarklePlayerState;
type Events = GameEventEnvelope<FarkleEvent>[];

const pub = (event: FarkleEvent): GameEventEnvelope<FarkleEvent> => ({ visibility: { kind: "public" }, event });

const reject = (code: string, message: string): GameResult<State, FarkleEvent> => ({
  ok: false,
  error: { code, message },
});

/** One timer: the dead roll's time on the table. */
const BUST = "bust";

// ---------------------------------------------------------------------------
// Internals. Helpers mutate the state they're given; the public API always
// hands them a fresh clone. `Out` gathers what the transition says besides state.
// ---------------------------------------------------------------------------

interface Out {
  events: Events;
  timers: TimerRequest[];
}

const clone = (state: State): State => structuredClone(state);
const newOut = (events: Events = []): Out => ({ events, timers: [] });
const done = (state: State, out: Out) => ({ state, events: out.events, timers: out.timers });

const inGame = (p: Player) => !p.removed;
const current = (state: State): Player => state.players[state.turnIndex]!;

function rollDie(state: State, ctx: GameContext): number {
  return state.rigged.length ? state.rigged.shift()! : ctx.randomInt(6) + 1;
}

/** Rolls `n` dice for the current player. A dead roll is a bust, on show until the timer. */
function roll(state: State, n: number, fresh: boolean, ctx: GameContext, out: Out): void {
  const me = current(state);
  state.rollNumber++;
  state.roll = Array.from({ length: n }, () => rollDie(state, ctx));
  state.hot = !fresh && n === DICE;
  state.step = "rolled";
  out.events.push(pub({ type: "rolled", playerId: me.id, dice: state.roll, fresh, hot: state.hot }));
  if (!isFarkle(state.roll)) return;

  me.farkles++;
  let penalty = 0;
  if (state.settings.threeFarkles && me.farkles >= 3) {
    penalty = Math.min(me.score, THREE_FARKLE_PENALTY);
    me.score -= penalty;
    me.farkles = 0;
  }
  const lost = state.turnTotal;
  state.step = "bust";
  state.bustEndsAt = ctx.now + BUST_MS;
  state.lastTurn = { playerId: me.id, kind: "farkle", points: lost, penalty };
  out.timers.push({ kind: "set", timerId: BUST, delayMs: BUST_MS });
  out.events.push(pub({ type: "farkle", playerId: me.id, dice: state.roll, lost, penalty, score: me.score }));
}

function startTurn(state: State, ctx: GameContext, out: Out): void {
  state.kept = [];
  state.turnTotal = 0;
  roll(state, DICE, true, ctx, out);
}

function finish(state: State, reason: EndReason, out: Out): void {
  state.phase = "finished";
  state.endReason = reason;
  const left = state.players.filter(inGame);
  const top = Math.max(...left.map((p) => p.score));
  state.winnerIds = left.filter((p) => p.score === top).map((p) => p.id);
  state.roll = [];
  state.kept = [];
  state.turnTotal = 0;
  out.timers.push({ kind: "cancel", timerId: BUST });
  out.events.push(pub({ type: "game-over", winnerIds: state.winnerIds, reason }));
}

/**
 * The turn's over (banked, bust, or its player left). In the final round,
 * whoever's still owed a turn goes next; once nobody is, it's over.
 */
function endTurn(state: State, ctx: GameContext, out: Out): void {
  out.timers.push({ kind: "cancel", timerId: BUST });
  if (state.players.filter(inGame).length < 2) return finish(state, "abandoned", out);
  const fr = state.finalRound;
  if (fr) {
    fr.owed = fr.owed.filter((id) => id !== current(state).id);
    if (!fr.owed.length) return finish(state, "target", out);
  }
  const n = state.players.length;
  for (let step = 1; step <= n; step++) {
    const idx = (state.turnIndex + step) % n;
    const p = state.players[idx]!;
    if (inGame(p) && (!fr || fr.owed.includes(p.id))) {
      state.turnIndex = idx;
      break;
    }
  }
  startTurn(state, ctx, out);
}

/** Validated keep: unique indices of the current roll that all score. Returns the points or an error. */
function checkKeep(state: State, keep: number[]): number | GameResult<State, FarkleEvent> {
  if (new Set(keep).size !== keep.length || keep.some((i) => i >= state.roll.length)) {
    return reject("bad-dice", "Those dice are not in this roll.");
  }
  const points = scoreDice(keep.map((i) => state.roll[i]!));
  if (!points) return reject("non-scoring", "Every die you keep must score.");
  return points;
}

function keep(state: State, indices: number[], points: number, out: Out): void {
  const sorted = [...indices].sort((a, b) => a - b);
  const dice = sorted.map((i) => state.roll[i]!);
  state.kept.push({ dice, points });
  state.turnTotal += points;
  out.events.push(pub({ type: "kept", playerId: current(state).id, indices: sorted, dice, points, turnTotal: state.turnTotal }));
}

function bank(state: State, ctx: GameContext, out: Out): void {
  const me = current(state);
  const points = state.turnTotal;
  me.score += points;
  me.onBoard = true;
  me.farkles = 0;
  state.lastTurn = { playerId: me.id, kind: "banked", points, penalty: 0 };
  out.events.push(pub({ type: "banked", playerId: me.id, points, score: me.score }));
  if (!state.finalRound && me.score >= state.settings.target) {
    const n = state.players.length;
    const owed: string[] = [];
    for (let step = 1; step < n; step++) {
      const p = state.players[(state.turnIndex + step) % n]!;
      if (inGame(p)) owed.push(p.id);
    }
    state.finalRound = { triggerId: me.id, owed };
    out.events.push(pub({ type: "final-round", playerId: me.id, score: me.score, target: state.settings.target }));
  }
  endTurn(state, ctx, out);
}

/** Below the entry threshold and not on the board yet: banking isn't allowed. */
function bankTooLow(state: State, total: number): boolean {
  return !current(state).onBoard && total < state.settings.entry;
}

function keepAndRoll(state: State, indices: number[], points: number, ctx: GameContext, out: Out): void {
  const rolled = state.roll.length;
  keep(state, indices, points, out);
  roll(state, diceToRoll(rolled, indices.length), false, ctx, out);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function parseSettings(input: unknown): FarkleSettings | null {
  if (input === undefined || input === null) return { ...DEFAULT_SETTINGS };
  if (typeof input !== "object" || Array.isArray(input)) return null;
  const s = { ...DEFAULT_SETTINGS, ...(input as Partial<FarkleSettings>) };
  const ok =
    (TARGET_OPTIONS as readonly unknown[]).includes(s.target) &&
    (ENTRY_OPTIONS as readonly unknown[]).includes(s.entry) &&
    typeof s.threeFarkles === "boolean";
  return ok ? { target: s.target, entry: s.entry, threeFarkles: s.threeFarkles } : null;
}

function parseAction(input: unknown): FarkleAction | null {
  if (typeof input !== "object" || input === null) return null;
  const a = input as Record<string, unknown>;
  if (a.type !== "keep-and-roll" && a.type !== "keep-and-bank") return null;
  if (!Array.isArray(a.keep)) return null;
  const k = a.keep as unknown[];
  if (k.length < 1 || k.length > DICE || !k.every((i) => Number.isInteger(i) && (i as number) >= 0 && (i as number) < DICE)) return null;
  return { type: a.type, keep: k as number[] };
}

/** Injected rolls (tests, dev tools): faces 1–6, used in order before the RNG. */
function normalizeRigged(input: unknown[]): number[] {
  if (!input.every((f) => Number.isInteger(f) && (f as number) >= 1 && (f as number) <= 6)) {
    throw new Error("farkle: options.deck is a list of die faces, 1–6.");
  }
  return input as number[];
}

// ---------------------------------------------------------------------------
// Definition
// ---------------------------------------------------------------------------

export const farkleGame: GameDefinition<
  FarkleServerState,
  FarkleAction,
  FarklePublicState,
  FarklePrivateState,
  FarkleSettings,
  FarkleEvent
> = {
  manifest: farkleManifest,
  defaultSettings: DEFAULT_SETTINGS,
  parseSettings,
  parseAction,

  createGame(players, settings, match, ctx, options) {
    const n = players.length;
    const { minPlayers, maxPlayers } = farkleManifest;
    if (n < minPlayers || n > maxPlayers) {
      throw new Error(`farkle: needs ${minPlayers}–${maxPlayers} players, got ${n}`);
    }
    const state: State = {
      phase: "playing",
      step: "rolled",
      settings,
      players: players.map((p) => ({ id: p.id, score: 0, onBoard: false, farkles: 0, removed: false })),
      // Whoever starts moves round the table from one game to the next.
      turnIndex: ((match.dealerSeat % n) + n) % n,
      rollNumber: 0,
      roll: [],
      kept: [],
      turnTotal: 0,
      hot: false,
      bustEndsAt: 0,
      finalRound: null,
      lastTurn: null,
      winnerIds: [],
      endReason: null,
      rigged: options?.deck ? normalizeRigged(options.deck) : [],
    };
    const out = newOut();
    startTurn(state, ctx, out);
    return done(state, out);
  },

  handleAction(prev, playerId, action, ctx) {
    if (prev.phase !== "playing") return reject("game-finished", "The game is over.");
    const seat = prev.players.findIndex((p) => p.id === playerId);
    if (seat < 0 || prev.players[seat]!.removed) return reject("not-in-game", "You're not in this game.");
    if (seat !== prev.turnIndex) return reject("not-your-turn", "It's not your turn.");
    if (prev.step !== "rolled") return reject("bust", "That roll is a farkle. Your turn is over.");
    if (!action.keep.length) return reject("keep-something", "Keep at least one scoring die.");

    const points = checkKeep(prev, action.keep);
    if (typeof points !== "number") return points;
    const state = clone(prev);
    const out = newOut();
    if (action.type === "keep-and-bank") {
      if (bankTooLow(state, state.turnTotal + points)) {
        return reject("below-entry", `You must bank ${formatPoints(state.settings.entry)} or more first. Keep rolling.`);
      }
      keep(state, action.keep, points, out);
      bank(state, ctx, out);
    } else keepAndRoll(state, action.keep, points, ctx, out);
    return { ok: true, transition: done(state, out) };
  },

  onTimer(prev, timerId, ctx) {
    if (prev.phase !== "playing" || prev.step !== "bust" || timerId !== BUST) return { state: prev, events: [] };
    const state = clone(prev);
    const out = newOut();
    endTurn(state, ctx, out);
    return done(state, out);
  },

  /**
   * The host moves an idle player on: keep the best scoring selection and
   * bank it, or roll on if that's not enough to get on the board.
   */
  skipTurn(prev, playerId, ctx) {
    if (prev.phase !== "playing" || prev.step !== "rolled" || current(prev).id !== playerId) return { state: prev, events: [] };
    const state = clone(prev);
    const out = newOut([pub({ type: "turn-skipped", playerId })]);
    const best = bestSelection(state.roll);
    if (bankTooLow(state, state.turnTotal + best.points)) keepAndRoll(state, best.indices, best.points, ctx, out);
    else {
      keep(state, best.indices, best.points, out);
      bank(state, ctx, out);
    }
    return done(state, out);
  },

  /**
   * Out of the rotation. On their turn, it ends with nothing banked. A final
   * round they started still runs; one they were owed a turn in stops waiting.
   */
  onPlayerRemoved(prev, playerId, ctx) {
    const idx = prev.players.findIndex((p) => p.id === playerId);
    if (prev.phase !== "playing" || idx < 0 || prev.players[idx]!.removed) return { state: prev, events: [] };
    const state = clone(prev);
    const out = newOut([pub({ type: "player-removed", playerId })]);
    state.players[idx]!.removed = true;
    const fr = state.finalRound;
    if (state.players.filter(inGame).length < 2) finish(state, "abandoned", out);
    else if (idx === state.turnIndex) endTurn(state, ctx, out);
    // The player on turn is always still owed theirs, so this never empties the list.
    else if (fr) fr.owed = fr.owed.filter((id) => id !== playerId);
    return done(state, out);
  },

  /**
   * The roller's picks, live, so everyone watches the dice get chosen. Not
   * kept in state: the next update or roll makes them stale anyway.
   */
  onStream(state, playerId, data) {
    if (state.phase !== "playing" || state.step !== "rolled" || current(state).id !== playerId) return null;
    const d = data as { roll?: unknown; picked?: unknown } | null;
    if (!d || d.roll !== state.rollNumber || !Array.isArray(d.picked) || d.picked.length > state.roll.length) return null;
    const picked = d.picked as unknown[];
    if (!picked.every((i) => Number.isInteger(i) && (i as number) >= 0 && (i as number) < state.roll.length)) return null;
    if (new Set(picked).size !== picked.length) return null;
    return { state, relay: { roll: state.rollNumber, picked }, persist: false };
  },

  getPublicState(state) {
    const playing = state.phase === "playing";
    return {
      players: state.players.map((p) => ({ id: p.id, score: p.score, onBoard: p.onBoard, farkles: p.farkles, removed: p.removed })),
      currentPlayerId: playing ? current(state).id : null,
      step: playing ? state.step : "finished",
      rollNumber: state.rollNumber,
      roll: state.roll,
      kept: state.kept,
      turnTotal: state.turnTotal,
      hot: state.hot,
      bustEndsAt: state.bustEndsAt,
      settings: state.settings,
      finalRound: state.finalRound,
      lastTurn: state.lastTurn,
      winnerIds: state.winnerIds,
      endReason: state.endReason,
    };
  },

  getPrivateState() {
    return {};
  },

  // During a bust nobody's holding things up: the timer is.
  getAwaitedPlayerIds(state) {
    return state.phase === "playing" && state.step === "rolled" ? [current(state).id] : [];
  },

  getResult(state) {
    if (state.phase !== "finished") return null;
    const rank = (p: Player) => (p.removed ? -1 : p.score);
    return {
      winnerIds: state.winnerIds,
      standings: [...state.players]
        .sort((a, b) => rank(b) - rank(a))
        .map((p) => ({
          playerId: p.id,
          value: p.score,
          label: p.removed ? "left" : `${formatPoints(p.score)} pts`,
        })),
    };
  },
};
