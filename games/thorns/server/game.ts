import type { GameContext, GameDefinition, GameEventEnvelope, GameResult, TimerRequest } from "@games/game-core";
import { thornsManifest } from "../shared/manifest.ts";
import { discCount, handOf, lostDiscAt } from "../shared/rules.ts";
import {
  DEFAULT_SETTINGS,
  FLIP_PACE_MS,
  POINTS_OPTIONS,
  RESULT_MS,
  START_ROSES,
  type Disc,
  type EndReason,
  type RoundResult,
  type ThornsAction,
  type ThornsEvent,
  type ThornsPlayerState,
  type ThornsPrivateState,
  type ThornsPublicState,
  type ThornsServerState,
  type ThornsSettings,
} from "../shared/types.ts";

type State = ThornsServerState;
type Player = ThornsPlayerState;
type Events = GameEventEnvelope<ThornsEvent>[];

const pub = (event: ThornsEvent): GameEventEnvelope<ThornsEvent> => ({ visibility: { kind: "public" }, event });
const only = (playerId: string, event: ThornsEvent): GameEventEnvelope<ThornsEvent> => ({
  visibility: { kind: "private", playerId },
  event,
});

const reject = (code: string, message: string): GameResult<State, ThornsEvent> => ({
  ok: false,
  error: { code, message },
});

/** One timer: the result pause before the next round. */
const RESULT = "result";

// ---------------------------------------------------------------------------
// Internals. Helpers mutate the state they're given; the public API always
// hands them a fresh clone. `Out` gathers what the transition says besides state.
// ---------------------------------------------------------------------------

interface Out {
  events: Events;
  timers: TimerRequest[];
  /** Discs turned over in this transition: the result waits for the client to act them out. */
  flips: number;
}

const clone = (state: State): State => structuredClone(state);
const newOut = (events: Events = []): Out => ({ events, timers: [], flips: 0 });
const done = (state: State, out: Out) => ({ state, events: out.events, timers: out.timers });

/** Still seated, still holding something. */
const active = (p: Player) => !p.removed && discCount(p) > 0;

const activePlayers = (state: State) => state.players.filter(active);

function current(state: State): Player {
  return state.players[state.turnIndex]!;
}

/** First seat after `from`, clockwise, that passes `ok`. Falls back to `from`. */
function nextSeat(state: State, from: number, ok: (p: Player) => boolean): number {
  const n = state.players.length;
  for (let step = 1; step <= n; step++) {
    const idx = (from + step) % n;
    if (ok(state.players[idx]!)) return idx;
  }
  return from;
}

function tableTotal(state: State): number {
  return state.players.reduce((sum, p) => sum + (p.removed ? 0 : p.stack.length), 0);
}

function flipsFrom(state: State, ownerId: string): number {
  return state.challenge?.flips.filter((f) => f.owner === ownerId).length ?? 0;
}

/** Mats the challenger could flip next. Their own stack goes by itself, so it's never one. */
function flippable(state: State): string[] {
  const c = state.challenge;
  if (state.phase !== "flipping" || !c) return [];
  return state.players
    .filter((p) => active(p) && p.id !== c.challengerId && p.stack.length > flipsFrom(state, p.id))
    .map((p) => p.id);
}

function finish(state: State, winnerId: string | null, reason: EndReason, out: Out): void {
  state.phase = "over";
  state.winnerId = winnerId;
  state.endReason = reason;
  out.timers.push({ kind: "cancel", timerId: RESULT });
  out.events.push(pub({ type: "game-over", winnerId, reason }));
}

/** Discs go back to hands; everyone puts one down to start. */
function startRound(state: State, startFrom: number, out: Out): void {
  for (const p of state.players) {
    p.stack = [];
    p.passed = false;
    p.ready = false;
    p.lostDisc = null;
  }
  const start = active(state.players[startFrom]!) ? startFrom : nextSeat(state, startFrom, active);
  state.phase = "placing-first";
  state.round++;
  state.startIndex = start;
  state.turnIndex = start;
  state.bid = null;
  state.challenge = null;
  state.result = null;
  state.resultEndsAt = 0;
  state.resultMs = 0;
  out.timers.push({ kind: "cancel", timerId: RESULT });
  out.events.push(pub({ type: "round-start", round: state.round, startId: state.players[start]!.id }));
}

function place(state: State, p: Player, disc: Disc, out: Out): void {
  p.stack.push(disc);
  out.events.push(pub({ type: "placed", playerId: p.id, height: p.stack.length }), only(p.id, { type: "you-placed", disc }));
  if (state.phase === "placing-first") {
    if (activePlayers(state).every((x) => x.stack.length > 0)) {
      state.phase = "turns";
      state.turnIndex = state.startIndex;
    }
  } else state.turnIndex = nextSeat(state, state.turnIndex, active);
}

/** Bidding ends when everyone but the top bidder has passed. */
function nobodyElseBidding(state: State): boolean {
  return activePlayers(state).every((x) => x.passed || x.id === state.bid?.bidderId);
}

function bid(state: State, p: Player, amount: number, ctx: GameContext, out: Out): void {
  state.bid = { amount, bidderId: p.id };
  state.phase = "bidding";
  out.events.push(pub({ type: "bid", playerId: p.id, amount }));
  if (amount >= tableTotal(state) || nobodyElseBidding(state)) startChallenge(state, ctx, out);
  else state.turnIndex = nextSeat(state, state.turnIndex, (x) => active(x) && !x.passed);
}

function pass(state: State, p: Player, ctx: GameContext, out: Out): void {
  p.passed = true;
  out.events.push(pub({ type: "passed", playerId: p.id }));
  if (nobodyElseBidding(state)) startChallenge(state, ctx, out);
  else state.turnIndex = nextSeat(state, state.turnIndex, (x) => active(x) && !x.passed);
}

/** The top bidder flips. Their own stack goes first, by itself, top down. */
function startChallenge(state: State, ctx: GameContext, out: Out): void {
  const { amount, bidderId } = state.bid!;
  const idx = state.players.findIndex((p) => p.id === bidderId);
  const me = state.players[idx]!;
  state.phase = "flipping";
  state.turnIndex = idx;
  state.challenge = { challengerId: bidderId, amount, flips: [] };
  out.events.push(pub({ type: "challenge", challengerId: bidderId, amount }));
  const own = Math.min(amount, me.stack.length);
  for (let j = 0; j < own; j++) {
    if (flip(state, me, ctx, out)) return;
  }
}

/** Turns the owner's top unflipped disc over. True once the challenge is settled. */
function flip(state: State, owner: Player, ctx: GameContext, out: Out): boolean {
  const c = state.challenge!;
  const disc = owner.stack[owner.stack.length - 1 - flipsFrom(state, owner.id)]!;
  c.flips.push({ owner: owner.id, disc });
  out.flips++;
  out.events.push(pub({ type: "flipped", challengerId: c.challengerId, owner: owner.id, disc, count: c.flips.length }));
  if (disc === "thorn") {
    fail(state, owner.id, ctx, out);
    return true;
  }
  if (c.flips.length >= c.amount) {
    succeed(state, ctx, out);
    return true;
  }
  return false;
}

function succeed(state: State, ctx: GameContext, out: Out): void {
  const c = state.challenge!;
  const me = state.players.find((p) => p.id === c.challengerId)!;
  me.points++;
  out.events.push(pub({ type: "success", challengerId: me.id, points: me.points }));
  if (me.points >= state.settings.pointsToWin) {
    state.result = { outcome: "success", challengerId: me.id, amount: c.amount, thornOwnerId: null, nextStartId: null, eliminated: false };
    finish(state, me.id, "points", out);
    return;
  }
  showResult(state, { outcome: "success", challengerId: me.id, amount: c.amount, thornOwnerId: null, nextStartId: me.id, eliminated: false }, ctx, out);
}

/**
 * A thorn. The challenger loses one disc, picked by the server from
 * everything they own. Everyone hears that they lost one; only they hear which.
 */
function fail(state: State, thornOwnerId: string, ctx: GameContext, out: Out): void {
  const c = state.challenge!;
  const idx = state.players.findIndex((p) => p.id === c.challengerId);
  const me = state.players[idx]!;
  const lost = lostDiscAt(me, ctx.randomInt(discCount(me)));
  if (lost === "rose") me.roses--;
  else me.thorn = false;
  me.lostDisc = lost;
  const eliminated = discCount(me) === 0;
  out.events.push(
    pub({ type: "failure", challengerId: me.id, thornOwnerId, discsLeft: discCount(me), eliminated }),
    only(me.id, { type: "you-lost", lostDisc: lost }),
  );
  const left = activePlayers(state);
  const result: RoundResult = { outcome: "failure", challengerId: me.id, amount: c.amount, thornOwnerId, nextStartId: null, eliminated };
  if (left.length < 2) {
    state.result = result;
    finish(state, left[0]?.id ?? null, "last-standing", out);
    return;
  }
  // Their own thorn, or someone else's: whoever owned it starts. Out? The next one along.
  const ownerIdx = state.players.findIndex((p) => p.id === thornOwnerId);
  const startIdx = active(state.players[ownerIdx]!) ? ownerIdx : nextSeat(state, ownerIdx, active);
  result.nextStartId = state.players[startIdx]!.id;
  showResult(state, result, ctx, out);
}

function showResult(state: State, result: RoundResult, ctx: GameContext, out: Out): void {
  state.phase = "result";
  state.result = result;
  state.resultMs = RESULT_MS + FLIP_PACE_MS * out.flips;
  state.resultEndsAt = ctx.now + state.resultMs;
  out.timers.push({ kind: "set", timerId: RESULT, delayMs: state.resultMs });
}

/** Everyone still playing and connected has tapped Ready. */
function allReady(state: State): boolean {
  return activePlayers(state).every((p) => p.ready || p.away);
}

function nextRound(state: State, out: Out): void {
  const id = state.result?.nextStartId;
  const idx = state.players.findIndex((p) => p.id === id);
  startRound(state, idx < 0 ? state.startIndex : idx, out);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function parseSettings(input: unknown): ThornsSettings | null {
  if (input === undefined || input === null) return { ...DEFAULT_SETTINGS };
  if (typeof input !== "object" || Array.isArray(input)) return null;
  const s = { ...DEFAULT_SETTINGS, ...(input as Partial<ThornsSettings>) };
  return (POINTS_OPTIONS as readonly unknown[]).includes(s.pointsToWin) ? { pointsToWin: s.pointsToWin } : null;
}

function parseAction(input: unknown): ThornsAction | null {
  if (typeof input !== "object" || input === null) return null;
  const a = input as Record<string, unknown>;
  switch (a.type) {
    case "place":
      return a.disc === "rose" || a.disc === "thorn" ? { type: "place", disc: a.disc } : null;
    case "bid":
      return Number.isInteger(a.amount) && (a.amount as number) >= 1 && (a.amount as number) <= 99 ? { type: "bid", amount: a.amount as number } : null;
    case "pass":
      return { type: "pass" };
    case "flip":
      return typeof a.owner === "string" && a.owner.length <= 64 ? { type: "flip", owner: a.owner } : null;
    case "ready":
      return { type: "ready" };
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Definition
// ---------------------------------------------------------------------------

export const thornsGame: GameDefinition<
  ThornsServerState,
  ThornsAction,
  ThornsPublicState,
  ThornsPrivateState,
  ThornsSettings,
  ThornsEvent
> = {
  manifest: thornsManifest,
  defaultSettings: DEFAULT_SETTINGS,
  parseSettings,
  parseAction,

  createGame(players, settings, match) {
    const n = players.length;
    const { minPlayers, maxPlayers } = thornsManifest;
    if (n < minPlayers || n > maxPlayers) {
      throw new Error(`thorns: needs ${minPlayers}–${maxPlayers} players, got ${n}`);
    }
    const state: State = {
      phase: "placing-first",
      settings,
      players: players.map((p) => ({
        id: p.id,
        roses: START_ROSES,
        thorn: true,
        stack: [],
        points: 0,
        passed: false,
        ready: false,
        removed: false,
        away: false,
        lostDisc: null,
      })),
      round: 0,
      startIndex: 0,
      turnIndex: 0,
      bid: null,
      challenge: null,
      result: null,
      resultEndsAt: 0,
      resultMs: 0,
      winnerId: null,
      endReason: null,
    };
    const out = newOut();
    startRound(state, ((match.dealerSeat % n) + n) % n, out);
    // Nothing to cancel on a fresh game.
    return { state, events: out.events };
  },

  handleAction(prev, playerId, action, ctx) {
    if (prev.phase === "over") return reject("game-finished", "The game is over.");
    const seat = prev.players.findIndex((p) => p.id === playerId);
    if (seat < 0 || prev.players[seat]!.removed) return reject("not-in-game", "You're not in this game.");
    const p = prev.players[seat]!;
    if (!active(p)) return reject("out", "You're out of discs. Enjoy the show.");
    const isTurn = seat === prev.turnIndex;

    switch (action.type) {
      case "place": {
        if (prev.phase === "placing-first") {
          if (p.stack.length) return reject("already-placed", "You've put your first disc down. Waiting on the others.");
        } else if (prev.phase === "turns") {
          if (!isTurn) return reject("not-your-turn", "It's not your turn.");
        } else if (prev.phase === "result") return reject("between-rounds", "Hang on: the next round's about to start.");
        else return reject("no-placing", "Someone's bid: no more placing this round.");
        const hand = handOf(p);
        if (!hand.length) return reject("empty-hand", "Your hand's empty: you have to bid.");
        if (!hand.includes(action.disc)) return reject("disc-not-in-hand", `You don't have ${action.disc === "rose" ? "a rose" : "your thorn"} in hand.`);
        const state = clone(prev);
        const out = newOut();
        place(state, state.players[seat]!, action.disc, out);
        return { ok: true, transition: done(state, out) };
      }
      case "bid": {
        if (prev.phase !== "turns" && prev.phase !== "bidding") return reject("no-bidding", "You can't bid right now.");
        if (!isTurn) return reject("not-your-turn", "It's not your turn.");
        const min = prev.bid ? prev.bid.amount + 1 : 1;
        const max = tableTotal(prev);
        if (action.amount < min || action.amount > max) {
          return reject("bad-bid", min === max ? `The bid has to be ${min}.` : `Bid between ${min} and ${max}.`);
        }
        const state = clone(prev);
        const out = newOut();
        bid(state, state.players[seat]!, action.amount, ctx, out);
        return { ok: true, transition: done(state, out) };
      }
      case "pass": {
        if (prev.phase !== "bidding") return reject("no-passing", prev.phase === "turns" ? "Place a disc or bid." : "Nothing to pass on.");
        if (!isTurn) return reject("not-your-turn", "It's not your turn.");
        const state = clone(prev);
        const out = newOut();
        pass(state, state.players[seat]!, ctx, out);
        return { ok: true, transition: done(state, out) };
      }
      case "flip": {
        if (prev.phase !== "flipping") return reject("not-flipping", "Nothing to flip right now.");
        if (prev.challenge?.challengerId !== playerId) return reject("not-challenger", "Only the top bidder flips.");
        if (action.owner === playerId) return reject("own-stack", "Your own stack's already turned over.");
        if (!flippable(prev).includes(action.owner)) return reject("cant-flip", "Nothing left to flip on that mat.");
        const state = clone(prev);
        const out = newOut();
        flip(state, state.players.find((x) => x.id === action.owner)!, ctx, out);
        return { ok: true, transition: done(state, out) };
      }
      case "ready": {
        if (prev.phase !== "result") return reject("not-result", "Nothing to wait for.");
        if (p.ready) return { ok: true, transition: { state: prev, events: [] } };
        const state = clone(prev);
        const out = newOut([pub({ type: "ready", playerId })]);
        state.players[seat]!.ready = true;
        if (allReady(state)) nextRound(state, out);
        return { ok: true, transition: done(state, out) };
      }
    }
  },

  onTimer(prev, timerId) {
    if (timerId !== RESULT || prev.phase !== "result") return { state: prev, events: [] };
    const state = clone(prev);
    const out = newOut();
    nextRound(state, out);
    return done(state, out);
  },

  /**
   * The least damaging move. Placing: a rose if there is one. Place-or-bid:
   * a rose, else the lowest bid. Bidding: pass. Flipping: the tallest stack
   * left to flip, first one clockwise on a tie.
   */
  skipTurn(prev, playerId, ctx) {
    const seat = prev.players.findIndex((p) => p.id === playerId);
    const noop = { state: prev, events: [] };
    if (seat < 0 || !active(prev.players[seat]!)) return noop;
    const p = prev.players[seat]!;
    const hand = handOf(p);
    const isTurn = seat === prev.turnIndex;
    const state = clone(prev);
    const me = state.players[seat]!;
    const out = newOut([pub({ type: "turn-skipped", playerId })]);

    if (prev.phase === "placing-first") {
      if (p.stack.length || !hand.length) return noop;
      place(state, me, hand.includes("rose") ? "rose" : "thorn", out);
    } else if (prev.phase === "turns" && isTurn) {
      // Whatever's left goes down face down. Bidding instead would tell the
      // table the skipped player's hand is just the thorn.
      if (hand.length) place(state, me, hand.includes("rose") ? "rose" : "thorn", out);
      else bid(state, me, 1, ctx, out);
    } else if (prev.phase === "bidding" && isTurn) {
      pass(state, me, ctx, out);
    } else if (prev.phase === "flipping" && prev.challenge?.challengerId === playerId) {
      const left = (id: string) => {
        const x = prev.players.find((q) => q.id === id)!;
        return x.stack.length - flipsFrom(prev, id);
      };
      const order = flippable(prev).sort((a, b) => {
        const by = left(b) - left(a);
        if (by) return by;
        const n = prev.players.length;
        const dist = (id: string) => (prev.players.findIndex((q) => q.id === id) - seat + n) % n;
        return dist(a) - dist(b);
      });
      if (!order[0]) return noop;
      flip(state, state.players.find((x) => x.id === order[0])!, ctx, out);
    } else return noop;
    return done(state, out);
  },

  onPlayerDisconnected(prev, playerId) {
    const idx = prev.players.findIndex((p) => p.id === playerId);
    if (prev.phase === "over" || idx < 0 || prev.players[idx]!.away) return { state: prev, events: [] };
    const state = clone(prev);
    const out = newOut();
    state.players[idx]!.away = true;
    // They were the last one the result was waiting on.
    if (state.phase === "result" && allReady(state)) nextRound(state, out);
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
   * Their stack leaves the table. Mid-round, the round is void: discs go back
   * to hands and the next active player after them starts again. During a
   * result, the next round just starts without them.
   */
  onPlayerRemoved(prev, playerId) {
    const idx = prev.players.findIndex((p) => p.id === playerId);
    if (prev.phase === "over" || idx < 0 || prev.players[idx]!.removed) return { state: prev, events: [] };
    const state = clone(prev);
    const out = newOut([pub({ type: "player-removed", playerId })]);
    const leaver = state.players[idx]!;
    leaver.removed = true;
    leaver.stack = [];

    const left = activePlayers(state);
    if (left.length < 2) {
      finish(state, left[0]?.id ?? null, "abandoned", out);
    } else if (state.phase === "result") {
      if (state.result?.nextStartId === playerId) state.result.nextStartId = state.players[nextSeat(state, idx, active)]!.id;
      if (allReady(state)) nextRound(state, out);
    } else {
      out.events.push(pub({ type: "round-void", playerId }));
      startRound(state, nextSeat(state, idx, active), out);
    }
    return done(state, out);
  },

  getPublicState(state) {
    const c = state.challenge;
    const phase = state.phase;
    return {
      phase,
      round: state.round,
      pointsToWin: state.settings.pointsToWin,
      players: state.players.map((p) => ({
        id: p.id,
        discs: discCount(p),
        height: p.removed ? 0 : p.stack.length,
        points: p.points,
        out: !p.removed && discCount(p) === 0,
        removed: p.removed,
        passed: p.passed,
        ready: phase === "result" && p.ready,
      })),
      currentPlayerId: phase === "turns" || phase === "bidding" ? current(state).id : phase === "flipping" ? (c?.challengerId ?? null) : null,
      startId: state.players[state.startIndex]?.id ?? null,
      tableTotal: tableTotal(state),
      bid: state.bid,
      minBid: state.bid ? state.bid.amount + 1 : 1,
      challenge: c,
      result: state.result,
      resultEndsAt: state.resultEndsAt,
      resultMs: state.resultMs,
      winnerId: state.winnerId,
      endReason: state.endReason,
    };
  },

  getPrivateState(state, playerId) {
    const p = state.players.find((x) => x.id === playerId);
    const none: ThornsPrivateState = { hand: [], stack: [], canPlace: false, canBid: false, canPass: false, canFlip: [], canReady: false, lostDisc: null };
    if (!p || p.removed) return none;
    const phase = state.phase;
    // Between rounds (and after the last) everything you own is yours to hold again.
    const settled = phase === "result" || phase === "over";
    const hand = handOf(settled ? { ...p, stack: [] } : p);
    const playing = active(p);
    const isTurn = playing && current(state).id === playerId;
    const turns = phase === "turns" && isTurn;
    return {
      hand,
      stack: [...p.stack],
      canPlace: playing && hand.length > 0 && ((phase === "placing-first" && !p.stack.length) || turns),
      canBid: turns || (phase === "bidding" && isTurn),
      canPass: phase === "bidding" && isTurn,
      canFlip: state.challenge?.challengerId === playerId ? flippable(state) : [],
      canReady: phase === "result" && !p.ready,
      lostDisc: p.lostDisc,
    };
  },

  getAwaitedPlayerIds(state) {
    switch (state.phase) {
      case "placing-first":
        return activePlayers(state).filter((p) => !p.stack.length).map((p) => p.id);
      case "turns":
      case "bidding":
        return [current(state).id];
      case "flipping":
        return state.challenge ? [state.challenge.challengerId] : [];
      default:
        // The result runs on a clock; nobody's holding it up.
        return [];
    }
  },

  getResult(state) {
    if (state.phase !== "over") return null;
    const rank = (p: Player) => (p.removed ? 2000 : p.id === state.winnerId ? -1000 : discCount(p) === 0 ? 1000 : -p.points * 10 - discCount(p));
    return {
      winnerIds: state.winnerId ? [state.winnerId] : [],
      standings: [...state.players]
        .sort((a, b) => rank(a) - rank(b))
        .map((p) => {
          const n = discCount(p);
          const pts = `${p.points} ${p.points === 1 ? "point" : "points"}`;
          const label = p.removed
            ? "left"
            : p.id === state.winnerId && state.endReason !== "points"
              ? "last one standing"
              : n === 0
                ? "out of discs"
                : `${pts} · ${n} ${n === 1 ? "disc" : "discs"}`;
          return { playerId: p.id, value: p.points, label };
        }),
    };
  },
};
