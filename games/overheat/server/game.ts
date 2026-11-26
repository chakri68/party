import { bumpStat, shuffle, type GameContext, type GameDefinition, type GameEventEnvelope, type GameResult, type TimerRequest } from "@games/game-core";
import { overheatManifest } from "../shared/manifest.ts";
import { overheatBot } from "./bot.ts";
import { aimTargets, auditIndex, bankScore, buildDeck, cardFromCode, isAimed } from "../shared/rules.ts";
import {
  BOUNTY,
  DEFAULT_SETTINGS,
  GAUGE_MAX,
  GAUGE_MIN,
  HAND_MAX,
  HEATWAVE_DROP,
  ROUND_END_MS,
  TARGET_OPTIONS,
  VENT_HEAT,
  type Card,
  type EndReason,
  type EngineCard,
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
const priv = (playerId: string, event: OverheatEvent): GameEventEnvelope<OverheatEvent> => ({
  visibility: { kind: "private", playerId },
  event,
});

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
const anyFlipping = (state: State) => state.players.some((p) => p.status === "flipping");

/** Power cards go to hands only in Cutthroat. */
export const isCutthroat = (state: State) => state.settings.powers === "cutthroat";

/** A player's hand, made if missing (games stored before hands). Mutates. */
function handOf(state: State, id: string): PowerCard[] {
  return ((state.hands ??= {})[id] ??= []);
}
/** A player's hand without touching the state. */
const peekHand = (state: State, id: string): PowerCard[] => state.hands?.[id] ?? [];

/** Top card of the deck. An empty deck is refilled from the discard. Null when both are empty. */
function draw(state: State, ctx: GameContext, out: Out): Card | null {
  if (!state.deck.length && state.discard.length) {
    state.deck = shuffle(state.discard, ctx.randomInt);
    state.discard = [];
    out.events.push(pub({ type: "reshuffle", deckCount: state.deck.length }));
  }
  return state.deck.shift() ?? null;
}

/**
 * Bust or redline for player `idx`, after any change to their heat. Redline banks.
 * `by` is whose card made the change. A bust they caused for someone else
 * counts for them, and in Cutthroat busting the leader pays the bounty.
 */
function check(state: State, idx: number, out: Out, by?: string): void {
  const p = state.players[idx]!;
  if (p.status !== "flipping") return;
  if (p.heat > p.gauge) {
    p.status = "busted";
    p.roundPoints = 0;
    out.events.push(pub({ type: "bust", playerId: p.id, heat: p.heat, gauge: p.gauge }));
    if (by && by !== p.id) credit(state, by, p.id, out);
  } else if (p.heat === p.gauge) {
    p.redline = true;
    out.events.push(pub({ type: "redline", playerId: p.id }));
    bank(state, idx, out);
  }
}

/** `by` made `targetId` go too hot. The leader can go too hot only once a round, so the bounty pays once. */
function credit(state: State, by: string, targetId: string, out: Out): void {
  bumpStat((state.stats ??= {}), by, "pushedOver");
  const hunter = state.players.find((p) => p.id === by);
  if (!isCutthroat(state) || targetId !== state.leaderId || !hunter || !inGame(hunter)) return;
  hunter.score += BOUNTY;
  out.events.push(pub({ type: "bounty", playerId: by, targetId, points: BOUNTY }));
}

function bank(state: State, idx: number, out: Out): void {
  const p = state.players[idx]!;
  p.roundPoints = bankScore(p.engine, p.redline);
  p.score += p.roundPoints;
  p.status = "banked";
  out.events.push(pub({ type: "bank", playerId: p.id, points: p.roundPoints, score: p.score, redline: p.redline }));
}

/**
 * Cutthroat: a saved player's row changed, so their round points are counted
 * again with the normal scoring (Perfect stays if they earned it), and their
 * score moves by the difference. Anyone not saved is left alone. Returns
 * their score now. No event when the round points stay the same.
 */
export function rescore(state: State, idx: number, out: Out): number {
  const p = state.players[idx]!;
  if (!isCutthroat(state) || p.status !== "banked") return p.score;
  const now = bankScore(p.engine, p.redline);
  if (now === p.roundPoints) return p.score;
  p.score += now - p.roundPoints;
  p.roundPoints = now;
  out.events.push(pub({ type: "rescore", playerId: p.id, roundPoints: p.roundPoints, score: p.score }));
  return p.score;
}

/** Cutthroat: the only top score among players still in, if above 0. Otherwise nobody. */
function findLeader(state: State): string | null {
  if (!isCutthroat(state)) return null;
  const left = state.players.filter(inGame);
  const top = Math.max(...left.map((p) => p.score));
  const at = left.filter((p) => p.score === top);
  return top > 0 && at.length === 1 ? at[0]!.id : null;
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
  state.played = false;
  state.turnIndex = state.firstIndex;
  state.leaderId = findLeader(state);
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
 * In Cutthroat a saved or too-hot player holding cards also gets a turn, but
 * only while someone still flips. Nobody flipping means the round is over.
 */
function advance(state: State, ctx: GameContext, out: Out): void {
  const n = state.players.length;
  const from = state.turnIndex;
  state.played = false;
  for (let step = 1; step <= n; step++) {
    const idx = (from + step) % n;
    const p = state.players[idx]!;
    if (p.status !== "flipping") {
      if (!anyFlipping(state)) break;
      if (isCutthroat(state) && !p.removed && peekHand(state, p.id).length) {
        state.turnIndex = idx;
        return;
      }
      continue;
    }
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

/**
 * A number card lands in player `idx`'s engine. A waiting Turbo doubles it.
 * `by` pushed it there; `credit` gets the credit if it makes them go too hot.
 */
function place(state: State, idx: number, card: NumberCard, out: Out, by?: string, credit = by): void {
  const p = state.players[idx]!;
  const mult = p.turbo ? 2 : 1;
  p.turbo = false;
  p.engine.push({ card, mult });
  p.heat += card.value * mult;
  out.events.push(pub({ type: "flip", playerId: p.id, card, mult, heat: p.heat, ...(by ? { by } : {}) }));
  check(state, idx, out, credit);
}

/** Who `chooserIdx` may aim a `kind` card at. See `aimTargets` for the rules. */
export function validTargets(state: State, chooserIdx: number, kind: Pending["kind"]): number[] {
  return aimTargets(state.players, chooserIdx, kind, isCutthroat(state));
}

/**
 * Player `idx` resolves a power card as its flipper (their own flip, or a
 * Shove's). Aimed cards with someone to aim at open a choice and wait in
 * `pending`; everything else goes straight to the discard. `by` is the pusher
 * when a Push turned the card up: they get the credit for what it does.
 */
export function resolvePower(
  state: State,
  idx: number,
  card: PowerCard,
  _ctx: GameContext,
  out: Out,
  { fromHand = false, by }: { fromHand?: boolean; by?: string } = {},
): void {
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
    state.pending = { kind, chooserId: me.id, card, fromHand, ...(by ? { by } : {}) };
    return;
  }
  state.discard.push(card);
  if (power === "block") {
    // Block only works from a hand. One that fires (full hand, or a Push turned it up) does nothing.
    out.events.push(pub({ type: "fizzle", playerId: me.id, card }));
  } else if (power === "vent") {
    me.heat = Math.max(0, me.heat - VENT_HEAT);
    out.events.push(pub({ type: "vent", playerId: me.id, heat: me.heat }));
    check(state, idx, out, by);
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
    for (const i of hit) check(state, i, out, by ?? me.id);
  }
}

/**
 * Player `idx` turns over a card as its flipper. False when there was nothing
 * to draw. In Cutthroat a power from your own flip goes to your hand while it
 * has room; one a Push turns up always fires. `fromHand` passes on to a choice
 * the card opens (a Push played from a hand). `credit` is who gets the credit
 * for what the card does: the pusher, or the first pusher of a chain.
 */
function flipInto(state: State, idx: number, ctx: GameContext, out: Out, by?: string, fromHand = false, credit = by): boolean {
  const card = draw(state, ctx, out);
  if (!card) return false;
  if (card.kind === "number") {
    place(state, idx, card, out, by, credit);
    return true;
  }
  const p = state.players[idx]!;
  const hand = handOf(state, p.id);
  if (!by && isCutthroat(state) && hand.length < HAND_MAX) {
    hand.push(card);
    out.events.push(pub({ type: "keep", playerId: p.id, count: hand.length }));
    out.events.push(priv(p.id, { type: "keep-card", playerId: p.id, card }));
    return true;
  }
  out.events.push(pub({ type: "flip", playerId: p.id, card, mult: 1, heat: p.heat, ...(by ? { by } : {}) }));
  resolvePower(state, idx, card, ctx, out, { fromHand, by: credit });
  return true;
}

/**
 * A card has resolved. After a hand card (or a choice it led to), a turn
 * owner who still flips keeps the turn: they must still flip or save.
 * Otherwise the turn moves on.
 */
function afterCard(state: State, fromHand: boolean, ctx: GameContext, out: Out): void {
  state.step = "turn";
  if (fromHand && current(state).status === "flipping") return;
  advance(state, ctx, out);
}

/** The current player banks, and the turn moves on. */
function bankTurn(state: State, ctx: GameContext, out: Out): void {
  bank(state, state.turnIndex, out);
  advance(state, ctx, out);
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

type Choice = Extract<OverheatAction, { type: "target" | "wrench" | "steal" | "dump" }>;

/** The action shape each pending card takes. Push, Burn and Audit take a plain target. */
const CHOICE_SHAPE: Record<Pending["kind"], Choice["type"]> = {
  shove: "target",
  fuse: "target",
  audit: "target",
  wrench: "wrench",
  steal: "steal",
  dump: "dump",
};

/** Checks a choice against the pending card. A rejection code, or null if it's legal. */
function badChoice(state: State, seat: number, action: Choice): [string, string] | null {
  const pending = state.pending;
  const notChoosing: [string, string] = ["not-choosing", "You have no card to play."];
  if (state.step !== "choosing" || !pending || state.players[seat]!.id !== pending.chooserId) return notChoosing;
  if (action.type !== CHOICE_SHAPE[pending.kind]) return notChoosing;
  const target = state.players.findIndex((p) => p.id === action.targetId);
  if (target < 0 || !validTargets(state, seat, pending.kind).includes(target)) {
    return ["bad-target", "You can't aim at that player."];
  }
  const has = (i: number, id: number) => state.players[i]!.engine.some((e) => e.card.id === id);
  if (action.type === "wrench" && (!has(seat, action.mine) || !has(target, action.theirs))) {
    return ["bad-card", "Pick one card from each row."];
  }
  if (action.type === "steal" && !has(target, action.theirs)) return ["bad-card", "Pick a card from their row."];
  if (action.type === "dump" && !has(seat, action.mine)) return ["bad-card", "Pick a card from your row."];
  return null;
}

const worth = (e: EngineCard) => e.card.value * e.mult;

/** Takes the card with id `id` out of player `idx`'s row. */
function takeCard(state: State, idx: number, id: number): EngineCard {
  const engine = state.players[idx]!.engine;
  return engine.splice(engine.findIndex((e) => e.card.id === id), 1)[0]!;
}

/**
 * Cutthroat: if the target holds a Block, it is spent and the card does
 * nothing. Only the blocker and the played card are named, never the rest of
 * their hand.
 */
function blocked(state: State, me: Player, them: Player, card: PowerCard, out: Out): boolean {
  if (!isCutthroat(state)) return false;
  const hand = handOf(state, them.id);
  const at = hand.findIndex((c) => c.power === "block");
  if (at < 0) return false;
  state.discard.push(hand.splice(at, 1)[0]!, card);
  out.events.push(pub({ type: "block", playerId: them.id, byId: me.id, card }));
  return true;
}

/** Plays the pending card with a checked choice. It can open a new choice (Shove into an aimed card). */
function choose(state: State, seat: number, action: Choice, ctx: GameContext, out: Out): void {
  const { kind, card, fromHand, by: pusher } = state.pending!;
  const me = state.players[seat]!;
  // Who gets the credit if this card makes someone go too hot.
  const by = pusher ?? me.id;
  const target = state.players.findIndex((p) => p.id === action.targetId);
  const them = state.players[target]!;
  state.step = "turn";
  state.pending = null;

  if (blocked(state, me, them, card, out)) {
    // Cancelled: no effect.
  } else if (kind === "fuse") {
    them.fuses++;
    out.events.push(pub({ type: "fuse", playerId: me.id, targetId: them.id, fuses: them.fuses }));
    state.discard.push(card);
  } else if (kind === "wrench" && action.type === "wrench") {
    const a = me.engine.findIndex((e) => e.card.id === action.mine);
    const b = them.engine.findIndex((e) => e.card.id === action.theirs);
    const gave = me.engine[a]!;
    const got = them.engine[b]!;
    me.engine[a] = got;
    them.engine[b] = gave;
    // In Cutthroat only players still flipping carry heat that matters.
    const moves = (p: Player) => !isCutthroat(state) || p.status === "flipping";
    if (moves(me)) me.heat = Math.max(0, me.heat - worth(gave) + worth(got));
    if (moves(them)) them.heat = Math.max(0, them.heat - worth(got) + worth(gave));
    out.events.push(pub({ type: "wrench", playerId: me.id, targetId: them.id, gave, got }));
    state.discard.push(card);
    rescore(state, seat, out);
    rescore(state, target, out);
    check(state, seat, out, by);
    check(state, target, out, by);
  } else if (kind === "steal" && action.type === "steal") {
    // A thief still flipping adds the card to their row; anyone else throws it away.
    const got = takeCard(state, target, action.theirs);
    const kept = me.status === "flipping";
    if (them.status === "flipping") them.heat = Math.max(0, them.heat - worth(got));
    out.events.push(pub({ type: "steal", playerId: me.id, targetId: them.id, card: got, kept }));
    rescore(state, target, out);
    if (kept) {
      me.engine.push(got);
      me.heat += worth(got);
    } else state.discard.push(got.card);
    state.discard.push(card);
    check(state, seat, out, by);
  } else if (kind === "dump" && action.type === "dump") {
    const gave = takeCard(state, seat, action.mine);
    if (me.status === "flipping") me.heat = Math.max(0, me.heat - worth(gave));
    them.engine.push(gave);
    them.heat += worth(gave);
    out.events.push(pub({ type: "dump", playerId: me.id, targetId: them.id, card: gave }));
    state.discard.push(card);
    rescore(state, seat, out);
    check(state, target, out, by);
  } else if (kind === "audit") {
    const lost = them.engine.splice(auditIndex(them.engine), 1)[0]!;
    state.discard.push(lost.card, card);
    // The audit line comes first, so its event goes in before the rescore's.
    const at = out.events.length;
    const score = rescore(state, target, out);
    out.events.splice(at, 0, pub({ type: "audit", playerId: me.id, targetId: them.id, card: lost, score }));
  } else {
    out.events.push(pub({ type: "shove", playerId: me.id, targetId: them.id }));
    // Draw before the Shove hits the discard, so a reshuffle can't hand it back.
    const drew = flipInto(state, target, ctx, out, me.id, fromHand, by);
    if (!drew) out.events.push(pub({ type: "fizzle", playerId: me.id, card: null }));
    state.discard.push(card);
  }
  if (state.step === "turn") afterCard(state, fromHand ?? false, ctx, out);
}

/** Why the turn owner at `seat` can't play hand card `cardId` now, or null if they can. */
function badPlay(state: State, seat: number, cardId: number): [string, string] | null {
  const me = state.players[seat]!;
  if (state.played) return ["played", "You played a card this turn."];
  const card = peekHand(state, me.id).find((c) => c.id === cardId);
  if (!card) return ["no-card", "That card is not in your hand."];
  const power = card.power;
  if (power === "block") return ["block-auto", "Block works by itself when a card is played on you."];
  if (me.status !== "flipping" && !isAimed(power) && power !== "heatwave") {
    return ["not-now", "You can play this card only while you flip."];
  }
  if (isAimed(power) && !validTargets(state, seat, power as Pending["kind"]).length) {
    return ["no-target", "No one to play this card on."];
  }
  return null;
}

/** The turn owner plays a checked card from their hand. */
function play(state: State, cardId: number, ctx: GameContext, out: Out): void {
  const seat = state.turnIndex;
  const me = state.players[seat]!;
  const hand = handOf(state, me.id);
  const card = hand.splice(hand.findIndex((c) => c.id === cardId), 1)[0]!;
  state.played = true;
  out.events.push(pub({ type: "play", playerId: me.id, card }));
  resolvePower(state, seat, card, ctx, out, { fromHand: true });
  if (state.step === "turn") afterCard(state, true, ctx, out);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function parseSettings(input: unknown): OverheatSettings | null {
  if (input === undefined || input === null) return { ...DEFAULT_SETTINGS };
  if (typeof input !== "object" || Array.isArray(input)) return null;
  const s = { ...DEFAULT_SETTINGS, ...(input as Partial<OverheatSettings>) };
  const ok = (TARGET_OPTIONS as readonly unknown[]).includes(s.target) && (s.powers === "off" || s.powers === "classic" || s.powers === "cutthroat");
  return ok ? { target: s.target, powers: s.powers } : null;
}

function parseAction(input: unknown): OverheatAction | null {
  if (typeof input !== "object" || input === null) return null;
  const a = input as Record<string, unknown>;
  if (a.type === "flip" || a.type === "bank" || a.type === "pass") return { type: a.type };
  if (a.type === "play") return Number.isInteger(a.cardId) ? { type: "play", cardId: a.cardId as number } : null;
  if (typeof a.targetId !== "string") return null;
  if (a.type === "target") return { type: "target", targetId: a.targetId };
  if (a.type === "wrench" && Number.isInteger(a.mine) && Number.isInteger(a.theirs)) {
    return { type: "wrench", targetId: a.targetId, mine: a.mine as number, theirs: a.theirs as number };
  }
  if (a.type === "steal" && Number.isInteger(a.theirs)) return { type: "steal", targetId: a.targetId, theirs: a.theirs as number };
  if (a.type === "dump" && Number.isInteger(a.mine)) return { type: "dump", targetId: a.targetId, mine: a.mine as number };
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
  bot: overheatBot,
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
      hands: Object.fromEntries(players.map((p) => [p.id, []])),
      played: false,
      leaderId: null,
      stats: {},
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
    if (action.type === "target" || action.type === "wrench" || action.type === "steal" || action.type === "dump") {
      const bad = badChoice(prev, seat, action);
      if (bad) return reject(...bad);
      const state = clone(prev);
      const out = newOut();
      choose(state, seat, action, ctx, out);
      return { ok: true, transition: done(state, out) };
    }
    if (prev.step === "choosing") return reject("choosing", "Wait for the card to be played.");
    if (seat !== prev.turnIndex) return reject("not-your-turn", "It is not your turn.");
    const flipping = prev.players[seat]!.status === "flipping";
    if (action.type === "play") {
      const bad = badPlay(prev, seat, action.cardId);
      if (bad) return reject(...bad);
    } else if (action.type === "pass") {
      if (flipping) return reject("must-act", "Flip a card or save.");
    } else if (!flipping) {
      return reject("saved", "You are not flipping. Play a card or pass.");
    } else if (action.type === "bank" && !prev.players[seat]!.flipped) {
      return reject("must-flip", "Flip a card first.");
    }

    const state = clone(prev);
    const out = newOut();
    if (action.type === "flip") flip(state, ctx, out);
    else if (action.type === "bank") bankTurn(state, ctx, out);
    else if (action.type === "play") play(state, action.cardId, ctx, out);
    else {
      out.events.push(pub({ type: "pass", playerId }));
      advance(state, ctx, out);
    }
    return { ok: true, transition: done(state, out) };
  },

  skipTurn(prev, playerId, ctx) {
    if (!awaited(prev).includes(playerId)) return { state: prev, events: [] };
    const state = clone(prev);
    const out = newOut([pub({ type: "turn-skipped", playerId })]);
    const seat = state.players.findIndex((p) => p.id === playerId);
    const pending = state.pending;
    if (state.step === "choosing" && pending) {
      const pick = <T>(xs: T[]): T => xs[ctx.randomInt(xs.length)]!;
      const target = state.players[pick(validTargets(state, seat, pending.kind))]!;
      const mine = () => pick(state.players[seat]!.engine).card.id;
      const theirs = () => pick(target.engine).card.id;
      if (pending.kind === "wrench") {
        choose(state, seat, { type: "wrench", targetId: target.id, mine: mine(), theirs: theirs() }, ctx, out);
      } else if (pending.kind === "steal") {
        choose(state, seat, { type: "steal", targetId: target.id, theirs: theirs() }, ctx, out);
      } else if (pending.kind === "dump") {
        choose(state, seat, { type: "dump", targetId: target.id, mine: mine() }, ctx, out);
      } else {
        choose(state, seat, { type: "target", targetId: target.id }, ctx, out);
      }
    } else if (current(state).status !== "flipping") advance(state, ctx, out);
    else if (current(state).flipped) bankTurn(state, ctx, out);
    else flip(state, ctx, out);
    return done(state, out);
  },

  onPlayerRemoved(prev, playerId, ctx) {
    const idx = prev.players.findIndex((p) => p.id === playerId);
    if (prev.phase !== "playing" || idx < 0 || prev.players[idx]!.removed) return { state: prev, events: [] };
    const state = clone(prev);
    const out = newOut([pub({ type: "player-removed", playerId })]);
    const gone = state.players[idx]!;
    gone.removed = true;
    gone.status = "out";
    const hand = handOf(state, gone.id);
    state.discard.push(...hand);
    hand.length = 0;
    if (state.players.filter(inGame).length < 2) {
      finish(state, "abandoned", out);
      return done(state, out);
    }
    const pending = state.pending;
    if (state.step === "choosing" && pending) {
      const chooser = state.players.findIndex((p) => p.id === pending.chooserId);
      if (chooser === idx) {
        // The chooser left: the card goes to the discard with no effect.
        state.discard.push(pending.card);
        state.pending = null;
        afterCard(state, pending.fromHand ?? false, ctx, out);
      } else if (!validTargets(state, chooser, pending.kind).length) {
        out.events.push(pub({ type: "fizzle", playerId: pending.chooserId, card: pending.card }));
        state.discard.push(pending.card);
        state.pending = null;
        afterCard(state, pending.fromHand ?? false, ctx, out);
      }
      // Otherwise the choice stands. If the turn owner left, `advance` will
      // step past their seat once it resolves.
    } else if (state.step === "turn" && (idx === state.turnIndex || !anyFlipping(state))) {
      // The turn owner left, or a saved turn owner has nobody left to play on.
      advance(state, ctx, out);
    }
    return done(state, out);
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
      handCounts: Object.fromEntries(state.players.map((p) => [p.id, peekHand(state, p.id).length])),
      leaderId: state.leaderId ?? null,
      played: state.played ?? false,
      roundEndsAt: state.roundEndsAt,
      settings: state.settings,
      winnerIds: state.winnerIds,
      endReason: state.endReason,
    };
  },

  partyStats(state) {
    return state.stats ?? {};
  },

  getPrivateState(state, playerId) {
    return { hand: [...peekHand(state, playerId)] };
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
