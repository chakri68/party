import { shuffle, type GameContext, type GameDefinition, type GameEventEnvelope, type GameResult, type TimerRequest } from "@games/game-core";
import { overheatManifest } from "../shared/manifest.ts";
import { bankScore, buildDeck, cardFromCode, isAimed } from "../shared/rules.ts";
import {
  DEFAULT_SETTINGS,
  GAUGE_MAX,
  GAUGE_MIN,
  HEATWAVE_DROP,
  ROUND_END_MS,
  TARGET_OPTIONS,
  VENT_HEAT,
  type Card,
  type EndReason,
  type NumberCard,
  type OverheatAction,
  type OverheatEvent,
  type OverheatPlayerState,
  type OverheatPrivateState,
  type OverheatPublicState,
  type OverheatServerState,
  type OverheatSettings,
  type Pending,
  type PowerCard,
} from "../shared/types.ts";

type State = OverheatServerState;
type Player = OverheatPlayerState;
type Events = GameEventEnvelope<OverheatEvent>[];

const pub = (event: OverheatEvent): GameEventEnvelope<OverheatEvent> => ({ visibility: { kind: "public" }, event });

const reject = (code: string, message: string): GameResult<State, OverheatEvent> => ({
  ok: false,
  error: { code, message },
});

/** One timer: the pause between rounds. */
const NEXT_ROUND = "next-round";

// ---------------------------------------------------------------------------
// Internals. Helpers mutate the state they're given; the public API always
// hands them a fresh clone. `Out` gathers what the transition says besides state.
// ---------------------------------------------------------------------------

export interface Out {
  events: Events;
  timers: TimerRequest[];
}

const clone = (state: State): State => structuredClone(state);
const newOut = (events: Events = []): Out => ({ events, timers: [] });
const done = (state: State, out: Out) => ({ state, events: out.events, timers: out.timers });

const inGame = (p: Player) => !p.removed;
const current = (state: State): Player => state.players[state.turnIndex]!;

/** Top card of the deck. An empty deck is refilled from the discard. Null when both are empty. */
function draw(state: State, ctx: GameContext, out: Out): Card | null {
  if (!state.deck.length && state.discard.length) {
    state.deck = shuffle(state.discard, ctx.randomInt);
    state.discard = [];
    out.events.push(pub({ type: "reshuffle", deckCount: state.deck.length }));
  }
  return state.deck.shift() ?? null;
}

/** Bust or redline for player `idx`, after any change to their heat. Redline banks. */
function check(state: State, idx: number, out: Out): void {
  const p = state.players[idx]!;
  if (p.status !== "flipping") return;
  if (p.heat > p.gauge) {
    p.status = "busted";
    p.roundPoints = 0;
    out.events.push(pub({ type: "bust", playerId: p.id, heat: p.heat, gauge: p.gauge }));
  } else if (p.heat === p.gauge) {
    p.redline = true;
    out.events.push(pub({ type: "redline", playerId: p.id }));
    bank(state, idx, out);
  }
}

function bank(state: State, idx: number, out: Out): void {
  const p = state.players[idx]!;
  p.roundPoints = bankScore(p.engine, p.redline);
  p.score += p.roundPoints;
  p.status = "banked";
  out.events.push(pub({ type: "bank", playerId: p.id, points: p.roundPoints, score: p.score, redline: p.redline }));
}

/** Rolls a fresh gauge, clears the table into the discard, and starts the first turn. */
function startRound(state: State, ctx: GameContext, out: Out): void {
  for (const p of state.players) {
    for (const e of p.engine) state.discard.push(e.card);
    p.engine = [];
  }
  state.gauge = GAUGE_MIN + ctx.randomInt(GAUGE_MAX - GAUGE_MIN + 1);
  state.step = "turn";
  state.pending = null;
  state.turnIndex = state.firstIndex;
  for (const p of state.players) {
    if (p.removed) continue;
    Object.assign(p, {
      status: "flipping",
      engine: [],
      heat: 0,
      gauge: state.gauge,
      fuses: 0,
      turbo: false,
      flipped: false,
      redline: false,
      roundPoints: 0,
    } satisfies Partial<Player>);
  }
  out.events.push(pub({ type: "round-start", round: state.round, gauge: state.gauge, firstPlayerId: current(state).id }));
}

function finish(state: State, reason: EndReason, out: Out): void {
  state.phase = "finished";
  state.endReason = reason;
  const left = state.players.filter(inGame);
  const top = Math.max(...left.map((p) => p.score));
  state.winnerIds = left.filter((p) => p.score === top).map((p) => p.id);
  out.timers.push({ kind: "cancel", timerId: NEXT_ROUND });
  out.events.push(pub({ type: "game-over", winnerIds: state.winnerIds, reason }));
}

function endRound(state: State, ctx: GameContext, out: Out): void {
  out.events.push(pub({ type: "round-end", round: state.round }));
  if (state.players.some((p) => inGame(p) && p.score >= state.settings.target)) return finish(state, "target", out);
  state.step = "round-end";
  state.roundEndsAt = ctx.now + ROUND_END_MS;
  out.timers.push({ kind: "set", timerId: NEXT_ROUND, delayMs: ROUND_END_MS });
}

/**
 * A flip, bank or choice has resolved: the turn goes to the next player still
 * flipping, in seat order after `turnIndex`. That can be the same player.
 * Their Fuses tick before they act; a tick that busts or banks them moves the
 * turn on again. Each seat is looked at once, so a seat ticks at most once.
 * Nobody left means the round is over.
 */
function advance(state: State, ctx: GameContext, out: Out): void {
  const n = state.players.length;
  const from = state.turnIndex;
  for (let step = 1; step <= n; step++) {
    const idx = (from + step) % n;
    const p = state.players[idx]!;
    if (p.status !== "flipping") continue;
    state.turnIndex = idx;
    if (p.fuses > 0) {
      p.heat += p.fuses;
      out.events.push(pub({ type: "fuse-tick", playerId: p.id, heat: p.heat, fuses: p.fuses }));
      check(state, idx, out);
      if (p.status !== "flipping") continue;
    }
    return;
  }
  endRound(state, ctx, out);
}

/** A number card lands in player `idx`'s engine. A waiting Turbo doubles it. */
function place(state: State, idx: number, card: NumberCard, out: Out, by?: string): void {
  const p = state.players[idx]!;
  const mult = p.turbo ? 2 : 1;
  p.turbo = false;
  p.engine.push({ card, mult });
  p.heat += card.value * mult;
  out.events.push(pub({ type: "flip", playerId: p.id, card, mult, heat: p.heat, ...(by ? { by } : {}) }));
  check(state, idx, out);
}

/**
 * Who `chooserIdx` may aim a `kind` card at: other players still flipping.
 * Wrench also needs a card in both engines.
 */
export function validTargets(state: State, chooserIdx: number, kind: Pending["kind"]): number[] {
  if (kind === "wrench" && !state.players[chooserIdx]!.engine.length) return [];
  const out: number[] = [];
  state.players.forEach((p, i) => {
    if (i === chooserIdx || p.status !== "flipping") return;
    if (kind === "wrench" && !p.engine.length) return;
    out.push(i);
  });
  return out;
}

/**
 * Player `idx` resolves a power card as its flipper (their own flip, or a
 * Shove's). Aimed cards with someone to aim at open a choice and wait in
 * `pending`; everything else goes straight to the discard.
 */
export function resolvePower(state: State, idx: number, card: PowerCard, _ctx: GameContext, out: Out): void {
  const me = state.players[idx]!;
  const power = card.power;
  if (isAimed(power)) {
    const kind = power as Pending["kind"];
    if (!validTargets(state, idx, kind).length) {
      out.events.push(pub({ type: "fizzle", playerId: me.id, card }));
      state.discard.push(card);
      return;
    }
    state.step = "choosing";
    state.pending = { kind, chooserId: me.id, card };
    return;
  }
  state.discard.push(card);
  if (power === "vent") {
    me.heat = Math.max(0, me.heat - VENT_HEAT);
    out.events.push(pub({ type: "vent", playerId: me.id, heat: me.heat }));
    check(state, idx, out);
  } else if (power === "turbo") {
    me.turbo = true;
    out.events.push(pub({ type: "turbo", playerId: me.id }));
  } else {
    // Heatwave: every player still flipping, in seat order from the resolver.
    const n = state.players.length;
    const hit: number[] = [];
    for (let step = 0; step < n; step++) {
      const i = (idx + step) % n;
      if (state.players[i]!.status === "flipping") hit.push(i);
    }
    for (const i of hit) state.players[i]!.gauge -= HEATWAVE_DROP;
    out.events.push(pub({ type: "heatwave", playerId: me.id, hit: hit.map((i) => state.players[i]!.id) }));
    for (const i of hit) check(state, i, out);
  }
}

/** Player `idx` turns over a card as its flipper. False when there was nothing to draw. */
function flipInto(state: State, idx: number, ctx: GameContext, out: Out, by?: string): boolean {
  const card = draw(state, ctx, out);
  if (!card) return false;
  if (card.kind === "number") {
    place(state, idx, card, out, by);
    return true;
  }
  const p = state.players[idx]!;
  out.events.push(pub({ type: "flip", playerId: p.id, card, mult: 1, heat: p.heat, ...(by ? { by } : {}) }));
  resolvePower(state, idx, card, ctx, out);
  return true;
}

/** The current player flips one card. With nothing left to draw they bank instead. */
function flip(state: State, ctx: GameContext, out: Out): void {
  const idx = state.turnIndex;
  const me = state.players[idx]!;
  me.flipped = true;
  if (!flipInto(state, idx, ctx, out)) {
    out.events.push(pub({ type: "fizzle", playerId: me.id, card: null }));
    bank(state, idx, out);
  }
  if (state.step === "turn") advance(state, ctx, out);
}

type Choice = Extract<OverheatAction, { type: "target" | "wrench" }>;

/** Checks a choice against the pending card. A rejection code, or null if it's legal. */
function badChoice(state: State, seat: number, action: Choice): [string, string] | null {
  const pending = state.pending;
  const notChoosing: [string, string] = ["not-choosing", "You have no card to play."];
  if (state.step !== "choosing" || !pending || state.players[seat]!.id !== pending.chooserId) return notChoosing;
  if ((action.type === "wrench") !== (pending.kind === "wrench")) return notChoosing;
  const target = state.players.findIndex((p) => p.id === action.targetId);
  if (target < 0 || !validTargets(state, seat, pending.kind).includes(target)) {
    return ["bad-target", "You can't aim at that player."];
  }
  if (action.type === "wrench") {
    const has = (i: number, id: number) => state.players[i]!.engine.some((e) => e.card.id === id);
    if (!has(seat, action.mine) || !has(target, action.theirs)) return ["bad-card", "Pick one card from each engine."];
  }
  return null;
}

/** Plays the pending card with a checked choice. It can open a new choice (Shove into an aimed card). */
function choose(state: State, seat: number, action: Choice, ctx: GameContext, out: Out): void {
  const { kind, card } = state.pending!;
  const me = state.players[seat]!;
  const target = state.players.findIndex((p) => p.id === action.targetId);
  const them = state.players[target]!;
  state.step = "turn";
  state.pending = null;

  if (kind === "fuse") {
    them.fuses++;
    out.events.push(pub({ type: "fuse", playerId: me.id, targetId: them.id, fuses: them.fuses }));
    state.discard.push(card);
  } else if (kind === "wrench" && action.type === "wrench") {
    const a = me.engine.findIndex((e) => e.card.id === action.mine);
    const b = them.engine.findIndex((e) => e.card.id === action.theirs);
    const gave = me.engine[a]!;
    const got = them.engine[b]!;
    const worth = (e: typeof gave) => e.card.value * e.mult;
    me.engine[a] = got;
    them.engine[b] = gave;
    me.heat = Math.max(0, me.heat - worth(gave) + worth(got));
    them.heat = Math.max(0, them.heat - worth(got) + worth(gave));
    out.events.push(pub({ type: "wrench", playerId: me.id, targetId: them.id, gave, got }));
    state.discard.push(card);
    check(state, seat, out);
    check(state, target, out);
  } else {
    out.events.push(pub({ type: "shove", playerId: me.id, targetId: them.id }));
    // Draw before the Shove hits the discard, so a reshuffle can't hand it back.
    const drew = flipInto(state, target, ctx, out, me.id);
    if (!drew) out.events.push(pub({ type: "fizzle", playerId: me.id, card: null }));
    state.discard.push(card);
  }
  if (state.step === "turn") advance(state, ctx, out);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function parseSettings(input: unknown): OverheatSettings | null {
  if (input === undefined || input === null) return { ...DEFAULT_SETTINGS };
  if (typeof input !== "object" || Array.isArray(input)) return null;
  const s = { ...DEFAULT_SETTINGS, ...(input as Partial<OverheatSettings>) };
  const ok = (TARGET_OPTIONS as readonly unknown[]).includes(s.target) && (s.powers === "off" || s.powers === "classic");
  return ok ? { target: s.target, powers: s.powers } : null;
}

function parseAction(input: unknown): OverheatAction | null {
  if (typeof input !== "object" || input === null) return null;
  const a = input as Record<string, unknown>;
  if (a.type === "flip" || a.type === "bank") return { type: a.type };
  if (typeof a.targetId !== "string") return null;
  if (a.type === "target") return { type: "target", targetId: a.targetId };
  if (a.type === "wrench" && Number.isInteger(a.mine) && Number.isInteger(a.theirs)) {
    return { type: "wrench", targetId: a.targetId, mine: a.mine as number, theirs: a.theirs as number };
  }
  return null;
}

/** Injected deck (tests, dev tools): card codes, top first. */
function rigDeck(codes: unknown[]): Card[] {
  return codes.map((code, id) => {
    const card = typeof code === "string" ? cardFromCode(code, id) : null;
    if (!card) throw new Error(`overheat: bad card code in options.deck: ${String(code)}`);
    return card;
  });
}

/** Who the game waits on: the turn owner, or the chooser of a pending card. */
function awaited(state: State): string[] {
  if (state.phase !== "playing") return [];
  if (state.step === "turn") return [current(state).id];
  if (state.step === "choosing" && state.pending) return [state.pending.chooserId];
  return [];
}

// ---------------------------------------------------------------------------
// Definition
// ---------------------------------------------------------------------------

export const overheatGame: GameDefinition<
  OverheatServerState,
  OverheatAction,
  OverheatPublicState,
  OverheatPrivateState,
  OverheatSettings,
  OverheatEvent
> = {
  manifest: overheatManifest,
  defaultSettings: DEFAULT_SETTINGS,
  parseSettings,
  parseAction,

  createGame(players, settings, match, ctx, options) {
    const n = players.length;
    const { minPlayers, maxPlayers } = overheatManifest;
    if (n < minPlayers || n > maxPlayers) {
      throw new Error(`overheat: needs ${minPlayers}–${maxPlayers} players, got ${n}`);
    }
    const first = ((match.dealerSeat % n) + n) % n;
    const state: State = {
      phase: "playing",
      step: "turn",
      settings,
      players: players.map((p) => ({
        id: p.id,
        score: 0,
        removed: false,
        status: "flipping",
        engine: [],
        heat: 0,
        gauge: 0,
        fuses: 0,
        turbo: false,
        flipped: false,
        redline: false,
        roundPoints: 0,
      })),
      round: 1,
      gauge: 0,
      firstIndex: first,
      turnIndex: first,
      pending: null,
      deck: options?.deck ? rigDeck(options.deck) : shuffle(buildDeck(settings.powers), ctx.randomInt),
      discard: [],
      roundEndsAt: 0,
      winnerIds: [],
      endReason: null,
    };
    const out = newOut();
    startRound(state, ctx, out);
    return done(state, out);
  },

  handleAction(prev, playerId, action, ctx) {
    if (prev.phase !== "playing") return reject("game-finished", "The game is over.");
    const seat = prev.players.findIndex((p) => p.id === playerId);
    if (seat < 0 || prev.players[seat]!.removed) return reject("not-in-game", "You are not in this game.");
    if (prev.step === "round-end") return reject("round-over", "This round is over. Wait for the next one.");
    if (action.type === "target" || action.type === "wrench") {
      const bad = badChoice(prev, seat, action);
      if (bad) return reject(...bad);
      const state = clone(prev);
      const out = newOut();
      choose(state, seat, action, ctx, out);
      return { ok: true, transition: done(state, out) };
    }
    if (prev.step === "choosing") return reject("choosing", "Wait for the card to be played.");
    if (seat !== prev.turnIndex) return reject("not-your-turn", "It is not your turn.");
    if (action.type === "bank" && !prev.players[seat]!.flipped) return reject("must-flip", "Flip a card first.");

    const state = clone(prev);
    const out = newOut();
    if (action.type === "flip") flip(state, ctx, out);
    else {
      bank(state, seat, out);
      advance(state, ctx, out);
    }
    return { ok: true, transition: done(state, out) };
  },

  onTimer(prev, timerId, ctx) {
    if (prev.phase !== "playing" || prev.step !== "round-end" || timerId !== NEXT_ROUND) return { state: prev, events: [] };
    const state = clone(prev);
    const out = newOut();
    const n = state.players.length;
    for (let step = 1; step <= n; step++) {
      const idx = (state.firstIndex + step) % n;
      if (inGame(state.players[idx]!)) {
        state.firstIndex = idx;
        break;
      }
    }
    state.round++;
    startRound(state, ctx, out);
    return done(state, out);
  },

  getPublicState(state) {
    const playing = state.phase === "playing";
    return {
      players: state.players,
      step: playing ? state.step : "finished",
      round: state.round,
      gauge: state.gauge,
      currentPlayerId: playing ? current(state).id : null,
      pending: state.pending,
      awaitedId: playing ? (awaited(state)[0] ?? null) : null,
      deckCount: state.deck.length,
      discardCount: state.discard.length,
      roundEndsAt: state.roundEndsAt,
      settings: state.settings,
      winnerIds: state.winnerIds,
      endReason: state.endReason,
    };
  },

  getPrivateState() {
    return {};
  },

  getAwaitedPlayerIds: awaited,

  getResult(state) {
    if (state.phase !== "finished") return null;
    const rank = (p: Player) => (p.removed ? -1 : p.score);
    return {
      winnerIds: state.winnerIds,
      standings: [...state.players]
        .sort((a, b) => rank(b) - rank(a))
        .map((p) => ({ playerId: p.id, value: p.score, label: p.removed ? "left" : `${p.score} pts` })),
    };
  },
};
