import type { GameContext, GameDefinition, GameEventEnvelope, GameResult, TimerRequest } from "@games/game-core";
import { liarsDiceManifest } from "../shared/manifest.ts";
import { countMatches, isLegalBid, onesAreWild, ordinal, skipBid, smallestRaise } from "../shared/rules.ts";
import {
  DEFAULT_SETTINGS,
  REVEAL_MS,
  STARTING_DICE_OPTIONS,
  type CallKind,
  type Face,
  type LiarsDiceAction,
  type LiarsDiceEvent,
  type LiarsDicePlayerState,
  type LiarsDicePrivateState,
  type LiarsDicePublicState,
  type LiarsDiceServerState,
  type LiarsDiceSettings,
  type Reveal,
  type RollReason,
} from "../shared/types.ts";

type State = LiarsDiceServerState;
type Player = LiarsDicePlayerState;
type Events = GameEventEnvelope<LiarsDiceEvent>[];

const pub = (event: LiarsDiceEvent): GameEventEnvelope<LiarsDiceEvent> => ({ visibility: { kind: "public" }, event });
const only = (playerId: string, event: LiarsDiceEvent): GameEventEnvelope<LiarsDiceEvent> => ({
  visibility: { kind: "private", playerId },
  event,
});

const reject = (code: string, message: string): GameResult<State, LiarsDiceEvent> => ({ ok: false, error: { code, message } });

/** One timer: the pause on a reveal before the next round rolls. */
const REVEAL = "reveal";

/** Biggest quantity anyone could type: eight players, five dice each. */
const MAX_QUANTITY = 8 * 5;

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

/** Still in it: seated and holding dice. */
const inPlay = (p: Player) => !p.removed && p.count > 0;

const totalDice = (state: State) => state.players.reduce((n, p) => n + (inPlay(p) ? p.count : 0), 0);

/** The first player still in, starting at seat `from` (`self`) or the seat after it, clockwise. */
function nextInPlay(state: State, from: number, self = false): number {
  const n = state.players.length;
  for (let step = self ? 0 : 1; step <= n; step++) {
    const idx = (from + step) % n;
    if (inPlay(state.players[idx]!)) return idx;
  }
  return from;
}

function rollDie(state: State, ctx: GameContext): Face {
  return state.rigged.length ? state.rigged.shift()! : ((ctx.randomInt(6) + 1) as Face);
}

/**
 * Everyone still in rolls, and `starter` opens. The roll goes out privately;
 * the table only hears how many dice each cup holds.
 */
function rollRound(state: State, starter: number, reason: RollReason, ctx: GameContext, out: Out): void {
  state.round++;
  state.phase = "bidding";
  state.bid = null;
  state.history = [];
  state.ready = [];
  state.revealEndsAt = 0;
  state.turnIndex = nextInPlay(state, starter, true);
  for (const p of state.players) p.dice = inPlay(p) ? Array.from({ length: p.count }, () => rollDie(state, ctx)) : [];
  out.timers.push({ kind: "cancel", timerId: REVEAL });
  out.events.push(
    pub({
      type: "rolled",
      round: state.round,
      counts: Object.fromEntries(state.players.filter(inPlay).map((p) => [p.id, p.count])),
      starterId: state.players[state.turnIndex]!.id,
      reason,
    }),
  );
  for (const p of state.players.filter(inPlay)) out.events.push(only(p.id, { type: "you-rolled", dice: sorted(p.dice) }));
}

const sorted = (dice: Face[]) => [...dice].sort((a, b) => a - b);

function finish(state: State, out: Out): void {
  const left = state.players.filter(inPlay);
  state.phase = "over";
  state.winnerId = left.length === 1 ? left[0]!.id : null;
  out.timers.push({ kind: "cancel", timerId: REVEAL });
  out.events.push(pub({ type: "game-over", winnerId: state.winnerId }));
}

/** Done with a reveal: everyone who's still in and here has tapped through. */
function allReady(state: State): boolean {
  return state.players.filter((p) => inPlay(p) && !p.away).every((p) => state.ready.includes(p.id));
}

/**
 * The cups come up. Count, settle the bet, and hold the reveal until the
 * timer or everyone's tap. The die changes land now, so the counts on screen
 * already show who paid.
 */
function call(state: State, kind: CallKind, ctx: GameContext, out: Out): void {
  const caller = state.players[state.turnIndex]!;
  const bid = state.bid!;
  const { wildOnes, startingDice } = state.settings;
  const dice = Object.fromEntries(state.players.filter(inPlay).map((p) => [p.id, sorted(p.dice)]));
  const count = countMatches(Object.values(dice).flat(), bid.face, wildOnes);
  const success = kind === "liar" ? count < bid.quantity : count === bid.quantity;

  let loser: Player | null = null;
  let gainer: Player | null = null;
  if (kind === "liar") loser = success ? state.players.find((p) => p.id === bid.playerId)! : caller;
  else if (success) gainer = caller.count < startingDice ? caller : null;
  else loser = caller;

  if (loser) loser.count--;
  if (gainer) gainer.count++;
  const eliminated = loser && loser.count === 0 ? loser : null;
  if (eliminated) state.outOrder.push(eliminated.id);

  const reveal: Reveal = {
    call: kind,
    callerId: caller.id,
    bid,
    dice,
    count,
    wild: onesAreWild(bid.face, wildOnes),
    success,
    loserId: loser?.id ?? null,
    gainerId: gainer?.id ?? null,
    eliminatedId: eliminated?.id ?? null,
  };
  state.reveal = reveal;
  out.events.push(pub({ type: "called", ...reveal }));

  if (state.players.filter(inPlay).length < 2) {
    finish(state, out);
    return;
  }
  // Whoever paid starts. A spot-on hit means the caller does. Out? Their left.
  const starter = state.players.indexOf(loser ?? caller);
  state.turnIndex = nextInPlay(state, starter, true);
  state.phase = "reveal";
  state.ready = [];
  state.revealEndsAt = ctx.now + REVEAL_MS;
  out.timers.push({ kind: "set", timerId: REVEAL, delayMs: REVEAL_MS });
}

/** Rigged dice for tests: faces 1–6, used in order before any random roll. */
function normalizeRigged(input: unknown[]): Face[] {
  if (!input.every((d) => Number.isInteger(d) && (d as number) >= 1 && (d as number) <= 6)) {
    throw new Error("Rigged dice must be faces 1–6.");
  }
  return input as Face[];
}

function parseSettings(input: unknown): LiarsDiceSettings | null {
  if (input === undefined || input === null) return { ...DEFAULT_SETTINGS };
  if (typeof input !== "object" || Array.isArray(input)) return null;
  const s = { ...DEFAULT_SETTINGS, ...(input as Partial<LiarsDiceSettings>) };
  const ok =
    typeof s.wildOnes === "boolean" &&
    typeof s.spotOn === "boolean" &&
    (STARTING_DICE_OPTIONS as readonly unknown[]).includes(s.startingDice);
  return ok ? { wildOnes: s.wildOnes, spotOn: s.spotOn, startingDice: s.startingDice } : null;
}

function parseAction(input: unknown): LiarsDiceAction | null {
  if (typeof input !== "object" || input === null) return null;
  const a = input as Record<string, unknown>;
  if (a.type === "liar" || a.type === "spot-on" || a.type === "ready") return { type: a.type };
  if (a.type !== "bid") return null;
  const q = a.quantity;
  const f = a.face;
  if (!Number.isInteger(q) || (q as number) < 1 || (q as number) > MAX_QUANTITY) return null;
  if (!Number.isInteger(f) || (f as number) < 1 || (f as number) > 6) return null;
  return { type: "bid", quantity: q as number, face: f as Face };
}

// ---------------------------------------------------------------------------
// Definition
// ---------------------------------------------------------------------------

export const liarsDiceGame: GameDefinition<
  LiarsDiceServerState,
  LiarsDiceAction,
  LiarsDicePublicState,
  LiarsDicePrivateState,
  LiarsDiceSettings,
  LiarsDiceEvent
> = {
  manifest: liarsDiceManifest,
  defaultSettings: DEFAULT_SETTINGS,
  parseSettings,
  parseAction,

  createGame(players, settings, match, ctx, options) {
    const n = players.length;
    const { minPlayers, maxPlayers } = liarsDiceManifest;
    if (n < minPlayers || n > maxPlayers) throw new Error(`liars-dice: needs ${minPlayers}–${maxPlayers} players, got ${n}`);
    const state: State = {
      phase: "bidding",
      settings,
      players: players.map((p) => ({ id: p.id, count: settings.startingDice, dice: [], removed: false, away: false })),
      round: 0,
      turnIndex: 0,
      bid: null,
      history: [],
      reveal: null,
      revealEndsAt: 0,
      ready: [],
      outOrder: [],
      winnerId: null,
      rigged: options?.deck ? normalizeRigged(options.deck) : [],
    };
    const out = newOut();
    // The seat after the dealer opens, same as the deal in the card games.
    rollRound(state, (((match.dealerSeat + 1) % n) + n) % n, "start", ctx, out);
    // Nothing to cancel on a fresh game.
    out.timers = [];
    return done(state, out);
  },

  handleAction(prev, playerId, action, ctx) {
    if (prev.phase === "over") return reject("game-finished", "The game is over.");
    const seat = prev.players.findIndex((p) => p.id === playerId);
    if (seat < 0 || prev.players[seat]!.removed) return reject("not-in-game", "You're not in this game.");

    if (action.type === "ready") {
      if (prev.phase !== "reveal") return reject("not-now", "The round has already started.");
      if (prev.ready.includes(playerId)) return { ok: true, transition: { state: prev, events: [] } };
      const state = clone(prev);
      const out = newOut([pub({ type: "ready", playerId })]);
      state.ready.push(playerId);
      if (allReady(state)) rollRound(state, state.turnIndex, "next", ctx, out);
      return { ok: true, transition: done(state, out) };
    }

    if (prev.phase !== "bidding") return reject("not-now", "Wait. The next round has not started yet.");
    if (prev.players[seat]!.count === 0) return reject("out", "You're out of dice.");
    if (seat !== prev.turnIndex) return reject("not-your-turn", "It's not your turn.");

    switch (action.type) {
      case "bid": {
        const total = totalDice(prev);
        if (action.quantity > total) return reject("bad-bid", `There are only ${total} dice on the table.`);
        if (!isLegalBid(prev.bid, action, prev.settings.wildOnes, total)) return reject("bad-bid", "Your bid must be higher than the last bid.");
        const state = clone(prev);
        const out = newOut();
        placeBid(state, action.quantity, action.face, out);
        return { ok: true, transition: done(state, out) };
      }
      case "liar":
      case "spot-on": {
        if (!prev.bid) return reject("no-bid", "Nobody has made a bid yet. You make the first bid.");
        if (action.type === "spot-on" && !prev.settings.spotOn) return reject("no-spot-on", "The host turned off Spot on for this game.");
        const state = clone(prev);
        const out = newOut();
        call(state, action.type, ctx, out);
        return { ok: true, transition: done(state, out) };
      }
    }
  },

  onTimer(prev, timerId, ctx) {
    if (prev.phase !== "reveal" || timerId !== REVEAL) return { state: prev, events: [] };
    const state = clone(prev);
    const out = newOut();
    rollRound(state, state.turnIndex, "next", ctx, out);
    return done(state, out);
  },

  /**
   * The host moves an idle bidder along with the mildest bid going: one of
   * their best face to open, else the least raise on it, else the least raise
   * at all. Never a call: a skip shouldn't decide a round. The one exception
   * is a bid nothing can beat, where calling liar is the only move left.
   */
  skipTurn(prev, playerId, ctx) {
    if (prev.phase !== "bidding" || prev.players[prev.turnIndex]!.id !== playerId) return { state: prev, events: [] };
    const state = clone(prev);
    const out = newOut([pub({ type: "turn-skipped", playerId })]);
    const me = state.players[state.turnIndex]!;
    const bid = skipBid(me.dice, state.bid, state.settings.wildOnes, totalDice(state));
    if (bid) placeBid(state, bid.quantity, bid.face, out);
    else call(state, "liar", ctx, out);
    return done(state, out);
  },

  onPlayerDisconnected(prev, playerId, ctx) {
    const idx = prev.players.findIndex((p) => p.id === playerId);
    if (prev.phase === "over" || idx < 0 || prev.players[idx]!.away) return { state: prev, events: [] };
    const state = clone(prev);
    const out = newOut();
    state.players[idx]!.away = true;
    // They were the last tap the reveal was waiting on.
    if (state.phase === "reveal" && allReady(state)) rollRound(state, state.turnIndex, "next", ctx, out);
    return done(state, out);
  },

  onPlayerReconnected(prev, playerId) {
    const idx = prev.players.findIndex((p) => p.id === playerId);
    if (idx < 0 || !prev.players[idx]!.away) return { state: prev, events: [] };
    const state = clone(prev);
    state.players[idx]!.away = false;
    return { state, events: [] };
  },

  /**
   * A leaver's dice leave the table. Mid-round that changes what's under the
   * cups, so the round is void: everyone re-rolls and the next player after
   * them opens. During a reveal the round's already settled, so it stands.
   */
  onPlayerRemoved(prev, playerId, ctx) {
    const idx = prev.players.findIndex((p) => p.id === playerId);
    if (prev.phase === "over" || idx < 0 || prev.players[idx]!.removed) return { state: prev, events: [] };
    const state = clone(prev);
    const leaver = state.players[idx]!;
    const hadDice = leaver.count > 0;
    const voided = state.phase === "bidding" && hadDice;
    const out = newOut([pub({ type: "player-removed", playerId, voided })]);
    leaver.removed = true;
    leaver.count = 0;
    leaver.dice = [];
    state.ready = state.ready.filter((id) => id !== playerId);

    if (state.players.filter(inPlay).length < 2) finish(state, out);
    else if (voided) rollRound(state, nextInPlay(state, idx), "void", ctx, out);
    else if (state.phase === "reveal") {
      if (state.turnIndex === idx) state.turnIndex = nextInPlay(state, idx);
      if (allReady(state)) rollRound(state, state.turnIndex, "next", ctx, out);
    }
    return done(state, out);
  },

  getPublicState(state) {
    const revealing = state.phase === "reveal";
    return {
      phase: state.phase,
      players: state.players.map((p) => ({
        id: p.id,
        diceCount: p.count,
        removed: p.removed,
        out: !p.removed && p.count === 0,
        ready: revealing && state.ready.includes(p.id),
      })),
      round: state.round,
      currentPlayerId: state.phase === "bidding" ? state.players[state.turnIndex]!.id : null,
      nextStarterId: revealing ? state.players[state.turnIndex]!.id : null,
      totalDice: totalDice(state),
      bid: state.bid,
      history: state.history,
      reveal: state.reveal,
      revealEndsAt: revealing ? state.revealEndsAt : null,
      revealMs: REVEAL_MS,
      settings: state.settings,
      winnerId: state.winnerId,
      outOrder: state.outOrder,
    };
  },

  getPrivateState(state, playerId) {
    const p = state.players.find((x) => x.id === playerId);
    const none: LiarsDicePrivateState = { dice: [], canBid: false, canCallLiar: false, canSpotOn: false, canReady: false };
    if (!p || p.removed) return none;
    const myTurn = state.phase === "bidding" && state.players[state.turnIndex]!.id === playerId && p.count > 0;
    return {
      dice: sorted(p.dice),
      canBid: myTurn && smallestRaise(state.bid, state.settings.wildOnes, totalDice(state)) !== null,
      canCallLiar: myTurn && !!state.bid,
      canSpotOn: myTurn && !!state.bid && state.settings.spotOn,
      canReady: state.phase === "reveal" && p.count > 0 && !state.ready.includes(playerId),
    };
  },

  // A reveal runs on its own clock; nobody's holding it up.
  getAwaitedPlayerIds(state) {
    return state.phase === "bidding" ? [state.players[state.turnIndex]!.id] : [];
  },

  getResult(state) {
    if (state.phase !== "over") return null;
    // The winner, then the latest out first, then leavers.
    const outAt = (p: Player) => state.outOrder.indexOf(p.id);
    const rank = (p: Player) => (p.id === state.winnerId ? -1 : p.removed ? 1000 : inPlay(p) ? 0 : 100 - outAt(p));
    return {
      winnerIds: state.winnerId ? [state.winnerId] : [],
      standings: [...state.players]
        .sort((a, b) => rank(a) - rank(b))
        .map((p) => {
          const label = p.removed
            ? "left"
            : p.count > 0
              ? `${p.count} ${p.count === 1 ? "die" : "dice"} left`
              : `out ${ordinal(outAt(p) + 1)}`;
          return { playerId: p.id, value: p.count, label };
        }),
    };
  },
};

function placeBid(state: State, quantity: number, face: Face, out: Out): void {
  const me = state.players[state.turnIndex]!;
  const bid = { playerId: me.id, quantity, face };
  state.bid = bid;
  state.history.push(bid);
  state.turnIndex = nextInPlay(state, state.turnIndex);
  out.events.push(pub({ type: "bid", ...bid }));
}
