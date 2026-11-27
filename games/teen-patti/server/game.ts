import {
  awardPots,
  bumpStat,
  formatChips,
  shuffle,
  type CreateGameOptions,
  type GameContext,
  type GameDefinition,
  type GameEventEnvelope,
  type GameOutcome,
  type GameResult,
  type Pot,
  type StatKey,
  type TimerRequest,
} from "@games/game-core";
import { teenPattiManifest } from "../shared/manifest.ts";
import {
  bootFor,
  chaalFor,
  compareHands,
  doubleFor,
  evaluate,
  levelIndexFor,
  makeDeck,
  ordinal,
  parseCardId,
  potLimitFor,
  stakeAfter,
} from "../shared/rules.ts";
import {
  BIG_BLIND_POT_BOOTS,
  DEFAULT_SETTINGS,
  ENDING_OPTIONS,
  HANDS_PER_LEVEL_OPTIONS,
  SIDESHOW_ANSWER_MS,
  STARTING_CHIPS_OPTIONS,
  TURN_SECONDS_OPTIONS,
  type AutoReason,
  type Card,
  type EndReason,
  type HandSummary,
  type LegalMoves,
  type MoveKind,
  type PackReason,
  type ShowReason,
  type TeenPattiAction,
  type TeenPattiEvent,
  type TeenPattiPlayerState,
  type TeenPattiPrivateState,
  type TeenPattiPublicState,
  type TeenPattiServerState,
  type TeenPattiSettings,
} from "../shared/types.ts";
import { teenPattiBot } from "./bot.ts";

type State = TeenPattiServerState;
type Player = TeenPattiPlayerState;
type Events = GameEventEnvelope<TeenPattiEvent>[];

const pub = (event: TeenPattiEvent): GameEventEnvelope<TeenPattiEvent> => ({ visibility: { kind: "public" }, event });
const only = (playerId: string, event: TeenPattiEvent): GameEventEnvelope<TeenPattiEvent> => ({
  visibility: { kind: "private", playerId },
  event,
});
const reject = (code: string, message: string): GameResult<State, TeenPattiEvent> => ({ ok: false, error: { code, message } });

/** The turn clock. Set again for every turn. */
export const TURN_TIMER = "turn";
/** The asked player's clock in a Sideshow. When it fires, the answer is no. */
export const ANSWER_TIMER = "answer";
/** Every pause that isn't a decision: the show, after a pack-out, between hands. */
export const STEP_TIMER = "step";

/** The show: a beat per hand turned over, then the pot. */
export const SHOWDOWN_BASE_MS = 3000;
export const SHOWDOWN_PER_HAND_MS = 1200;
export const showdownMs = (hands: number) => SHOWDOWN_BASE_MS + SHOWDOWN_PER_HAND_MS * hands;
export const AWARDED_MS = 2500;
export const BETWEEN_MS = 3500;

// ---------------------------------------------------------------------------
// Internals. Helpers change the state they're given; the public API always
// hands them a fresh clone. `Out` gathers what the transition says besides state.
// ---------------------------------------------------------------------------

interface Out {
  events: Events;
  timers: TimerRequest[];
}

const clone = (state: State): State => structuredClone(state);
const newOut = (events: Events = []): Out => ({ events, timers: [] });
const done = (state: State, out: Out) => ({ state, events: out.events, timers: out.timers });

const live = (p: Player) => p.inHand && !p.packed;
const actable = (p: Player) => live(p) && !p.allIn;
const liveCount = (s: State) => s.players.filter(live).length;
/** A hand is on: someone has a turn, or a Sideshow answer is due. */
const handOn = (s: State) => s.phase === "playing" && (s.step === "betting" || s.step === "sideshow");
const betting = (s: State) => s.phase === "playing" && s.step === "betting" && s.turnIndex >= 0;

/** Seats after `from`, clockwise, ending with `from` itself. */
function around(s: State, from: number): number[] {
  const n = s.players.length;
  return Array.from({ length: n }, (_, i) => (from + 1 + i) % n);
}

function nextActor(s: State, from: number): number {
  return around(s, from).find((i) => i !== from && actable(s.players[i]!)) ?? -1;
}

/** The last player before `from` who is still betting: the one a Sideshow asks. */
function previousActor(s: State, from: number): number {
  const n = s.players.length;
  for (let k = 1; k < n; k++) {
    const i = (from - k + n) % n;
    if (actable(s.players[i]!)) return i;
  }
  return -1;
}

const nextDealt = (s: State, from: number) => around(s, from).find((i) => s.players[i]!.inHand) ?? from;

function boot(s: State): number {
  return bootFor(levelIndexFor(s.handNumber, s.settings.handsPerLevel));
}

const potOf = (s: State) => s.players.reduce((sum, p) => sum + (p.inHand ? p.contributed : 0), 0);

function capEndsAt(s: State): number | null {
  return s.settings.ending === "last" ? null : s.startedAt + s.settings.ending * 60_000;
}

/** Seat ids from the dealer's left round to the dealer: show order, and where odd chips go. */
function fromDealer(s: State): string[] {
  return around(s, s.dealerIndex).map((i) => s.players[i]!.id);
}

function put(p: Player, amount: number): number {
  const a = Math.min(amount, p.stack);
  p.stack -= a;
  p.contributed += a;
  if (p.stack === 0) p.allIn = true;
  return a;
}

/** Notes anyone who just went all-in, with the pot as it is now: what they can win. */
function noteAllIns(s: State): void {
  const list = (s.allIns ??= []);
  const dealt = s.players.filter((p) => p.inHand);
  for (const p of dealt) {
    if (p.allIn && !list.some((a) => a.playerId === p.id)) {
      list.push({ playerId: p.id, at: Object.fromEntries(dealt.map((o) => [o.id, o.contributed])) });
    }
  }
}

/**
 * The pots, by time. An all-in player can win the pot as it was when they
 * went all-in. Bets after that go into a side pot that only the players
 * still betting can win. Several all-ins nest, in the order they happened.
 * A side pot holding only one player's chips, that only they can win, is
 * uncalled: it goes back to them.
 */
function potsOf(s: State): Pot[] {
  const dealt = s.players.filter((p) => p.inHand);
  const liveIds = dealt.filter(live).map((p) => p.id);
  const allIns = s.allIns ?? [];
  const marks = [...allIns.map((a) => a.at), Object.fromEntries(dealt.map((p) => [p.id, p.contributed]))];
  const pots: Pot[] = [];
  const gone = new Set<string>();
  let prev: Record<string, number> = {};
  marks.forEach((at, k) => {
    const from = dealt.filter((p) => (at[p.id] ?? 0) > (prev[p.id] ?? 0)).map((p) => p.id);
    const amount = dealt.reduce((sum, p) => sum + (at[p.id] ?? 0) - (prev[p.id] ?? 0), 0);
    const eligible = liveIds.filter((id) => !gone.has(id));
    if (amount > 0) {
      const pot: Pot = { amount, eligible };
      if (pots.length && eligible.length === 1 && from.length === 1 && from[0] === eligible[0]) pot.uncalled = true;
      pots.push(pot);
    }
    if (allIns[k]) gone.add(allIns[k]!.playerId);
    prev = at;
  });
  return pots;
}

function legalFor(s: State, p: Player): LegalMoves {
  const chaal = chaalFor(s.stake, p.seen);
  const double = doubleFor(s.stake, p.seen);
  const short = p.stack < chaal;
  // Show when only 2 can still bet; Sideshow when more can.
  const bettors = s.players.filter(actable).length;
  const target = previousActor(s, s.players.indexOf(p));
  const asked = target >= 0 ? s.players[target]! : null;
  const sideshow =
    p.seen && !short && bettors >= 3 && asked && asked.seen && !asked.away && !asked.sittingOut
      ? { toId: asked.id, cost: chaal }
      : null;
  return {
    chaal: short ? null : chaal,
    double: p.stack >= double ? double : null,
    allIn: short ? p.stack : null,
    show: bettors === 2 && !short ? chaal : null,
    sideshow,
  };
}

function setStep(s: State, ctx: GameContext, delayMs: number, out: Out): void {
  s.stepEndsAt = ctx.now + delayMs;
  out.timers.push({ kind: "set", timerId: STEP_TIMER, delayMs });
}

function stopClock(s: State, out: Out): void {
  s.turnIndex = -1;
  s.deadline = 0;
  out.timers.push({ kind: "cancel", timerId: TURN_TIMER });
}

function closeSideshow(s: State, out: Out): void {
  if (!s.sideshow) return;
  s.sideshow = null;
  s.step = "betting";
  out.timers.push({ kind: "cancel", timerId: ANSWER_TIMER });
}

/** A recap count. `??=` covers a game stored before the field existed. */
function stat(s: State, playerId: string, key: StatKey): void {
  bumpStat((s.stats ??= {}), playerId, key);
}

// ---- moves ------------------------------------------------------------------

function pack(p: Player, reason: PackReason, out: Out): void {
  p.packed = true;
  out.events.push(pub({ type: "pack", playerId: p.id, reason }));
}

/** Chips in, the stake moved, and the recap counts that hang on a bet. */
function bet(s: State, p: Player, kind: MoveKind, amount: number, out: Out): void {
  const paid = put(p, amount);
  noteAllIns(s);
  if (kind === "chaal" || kind === "double") s.stake = Math.max(s.stake, stakeAfter(paid, p.seen));
  p.lastMove = { kind, amount: paid };
  out.events.push(pub({ type: "bet", playerId: p.id, kind, amount: paid, seen: p.seen, stake: s.stake }));
  // A bet on a high card, after looking: a bluff.
  const raising = kind === "chaal" || kind === "double" || kind === "all-in";
  if (raising && p.seen && !p.lied && evaluate(p.cards).category === 0) {
    p.lied = true;
    stat(s, p.id, "liesTold");
  }
  // A Blind bet into a big pot: a bold bet for the recap.
  if ((kind === "chaal" || kind === "double") && !p.seen && !p.bigBid && potOf(s) > BIG_BLIND_POT_BOOTS * boot(s)) {
    p.bigBid = true;
    stat(s, p.id, "bigBids");
  }
}

/** Null on success, or why not. The turn player only. */
function applyMove(s: State, ctx: GameContext, idx: number, action: TeenPattiAction, out: Out): string | null {
  const p = s.players[idx]!;
  const legal = legalFor(s, p);
  switch (action.type) {
    case "pack":
      pack(p, "move", out);
      break;
    case "chaal":
      if (legal.chaal === null) return `You need ${formatChips(chaalFor(s.stake, p.seen))} chips. You can go all-in or pack.`;
      bet(s, p, "chaal", legal.chaal, out);
      break;
    case "double":
      if (legal.double === null) return "You don't have enough chips to double.";
      bet(s, p, "double", legal.double, out);
      break;
    case "all-in":
      if (legal.allIn === null) return "You have enough chips for a normal bet.";
      bet(s, p, "all-in", legal.allIn, out);
      break;
    case "show":
      if (legal.show === null) {
        return s.players.filter(actable).length === 2 ? "You don't have enough chips for a Show." : "You can ask for a Show only when 2 players are left to bet.";
      }
      bet(s, p, "show", legal.show, out);
      showdown(s, ctx, out, "show", p.id);
      return null;
    case "sideshow": {
      if (legal.sideshow === null) return "You can't ask for a Sideshow now.";
      bet(s, p, "sideshow", legal.sideshow.cost, out);
      // The pot limit comes first: every hand still in is shown.
      if (potOf(s) >= potLimitFor(boot(s))) {
        proceed(s, ctx, out);
        return null;
      }
      s.step = "sideshow";
      s.sideshow = { fromId: p.id, toId: legal.sideshow.toId, deadline: ctx.now + SIDESHOW_ANSWER_MS };
      s.deadline = 0;
      out.timers.push({ kind: "cancel", timerId: TURN_TIMER }, { kind: "set", timerId: ANSWER_TIMER, delayMs: SIDESHOW_ANSWER_MS });
      out.events.push(pub({ type: "sideshow-ask", fromId: p.id, toId: legal.sideshow.toId }));
      return null;
    }
    default:
      return "That is not a valid move.";
  }
  s.turnIndex = nextActor(s, idx);
  proceed(s, ctx, out);
  return null;
}

/** The asked player answered (or the clock did). Accepted: the lower hand packs; the asker packs on a tie. */
function answer(s: State, ctx: GameContext, accepted: boolean, out: Out, auto?: AutoReason): void {
  const req = s.sideshow!;
  closeSideshow(s, out);
  const fromIdx = s.players.findIndex((p) => p.id === req.fromId);
  const from = s.players[fromIdx]!;
  const to = s.players.find((p) => p.id === req.toId)!;
  out.events.push(pub({ type: "sideshow-answer", fromId: from.id, toId: to.id, accepted, ...(auto ? { auto } : {}) }));
  if (accepted) {
    const loser = compareHands(from.cards, to.cards) > 0 ? to : from;
    from.compared = to.compared = true;
    from.peeks.push(to.id);
    to.peeks.push(from.id);
    const hands = { [from.id]: from.cards, [to.id]: to.cards };
    out.events.push(only(from.id, { type: "sideshow-cards", hands, loserId: loser.id }));
    out.events.push(only(to.id, { type: "sideshow-cards", hands, loserId: loser.id }));
    stat(s, from.id, loser === to ? "rightCalls" : "wrongCalls");
    pack(loser, "sideshow", out);
  }
  s.turnIndex = nextActor(s, fromIdx);
  proceed(s, ctx, out);
}

/** A missed turn packs, and the second in a row sits you out. */
function timeout(s: State, ctx: GameContext, reason: AutoReason, out: Out): void {
  const idx = s.turnIndex;
  const p = s.players[idx]!;
  pack(p, reason, out);
  p.timeouts++;
  if (p.timeouts >= 2 && !p.sittingOut) {
    p.sittingOut = true;
    out.events.push(pub({ type: "sitting-out", playerId: p.id }));
  }
  s.turnIndex = nextActor(s, idx);
  proceed(s, ctx, out);
}

/**
 * Moves the hand along until someone real has a turn, or it ends: everyone
 * else packed, at most one player can still bet (the rest are all-in), or the
 * pot reached its limit. Players sitting out or away pack on the spot.
 */
function proceed(s: State, ctx: GameContext, out: Out): void {
  for (;;) {
    if (liveCount(s) <= 1) return winByPack(s, ctx, out);
    if (s.players.filter(actable).length <= 1) return showdown(s, ctx, out, "all-in", null);
    const limit = potLimitFor(boot(s));
    if (potOf(s) >= limit) {
      out.events.push(pub({ type: "pot-limit", limit }));
      return showdown(s, ctx, out, "pot-limit", null);
    }
    const idx = s.turnIndex;
    const p = s.players[idx];
    if (!p || !actable(p)) {
      s.turnIndex = nextActor(s, idx < 0 ? s.dealerIndex : idx);
      continue;
    }
    if (p.sittingOut || p.away) {
      pack(p, "sitting-out", out);
      s.turnIndex = nextActor(s, idx);
      continue;
    }
    const ms = s.settings.turnSeconds * 1000;
    s.deadline = ctx.now + ms;
    out.timers.push({ kind: "set", timerId: TURN_TIMER, delayMs: ms });
    return;
  }
}

function summaryBase(s: State, reason: ShowReason | null, showBy: string | null): HandSummary {
  return { handNumber: s.handNumber, reason, showBy, pots: [], shown: {}, labels: {}, order: [], won: {} };
}

/**
 * Every hand still in turns up and the pots are paid. Equal hands split,
 * except in a Show: there the player who asked loses a tie (to the player
 * they asked, and to an all-in player still in).
 */
function showdown(s: State, ctx: GameContext, out: Out, reason: ShowReason, showBy: string | null): void {
  stopClock(s, out);
  closeSideshow(s, out);
  s.step = "showdown";
  const pots = potsOf(s);
  const contenders = s.players.filter(live);
  const values = Object.fromEntries(contenders.map((p) => [p.id, evaluate(p.cards)]));
  const strength = Object.fromEntries(
    contenders.map((p) => [p.id, showBy ? [...values[p.id]!.ranks, p.id === showBy ? 0 : 1] : values[p.id]!.ranks]),
  );
  const order = fromDealer(s);
  const { won, returned, results } = awardPots(pots, strength, order);
  for (const p of s.players) p.stack += (won[p.id] ?? 0) + (returned[p.id] ?? 0);
  results.forEach((r, i) => {
    if (!r.uncalled && pots[i]!.eligible.length > 1) r.label = values[r.winners[0]!]!.label;
  });
  if (showBy) {
    // The asked player: the other one still betting.
    const asked = contenders.find((p) => p.id !== showBy && !p.allIn)!;
    stat(s, showBy, compareHands(s.players.find((p) => p.id === showBy)!.cards, asked.cards) > 0 ? "rightCalls" : "wrongCalls");
  }
  const summary = summaryBase(s, reason, showBy);
  summary.pots = results;
  summary.won = won;
  summary.order = contenders.map((p) => p.id).sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const hands: Record<string, Card[]> = {};
  for (const p of contenders) {
    if (!p.shown) hands[p.id] = p.cards;
    p.shown = true;
    summary.shown[p.id] = p.cards;
    summary.labels[p.id] = values[p.id]!.label;
  }
  s.lastHand = summary;
  if (Object.keys(hands).length) out.events.push(pub({ type: "reveal", hands }));
  out.events.push(pub({ type: "awarded", summary }));
  setStep(s, ctx, showdownMs(contenders.length), out);
}

/** Everyone else packed. The winner's cards stay down. */
function winByPack(s: State, ctx: GameContext, out: Out): void {
  stopClock(s, out);
  closeSideshow(s, out);
  const winner = s.players.find(live)!;
  const total = potOf(s);
  winner.stack += total;
  if (winner.lied && !winner.compared) stat(s, winner.id, "liesUncaught");
  const summary = summaryBase(s, null, null);
  summary.pots = [{ amount: total, winners: [winner.id], label: null }];
  summary.won = { [winner.id]: total };
  s.lastHand = summary;
  s.step = "awarded";
  out.events.push(pub({ type: "awarded", summary }));
  setStep(s, ctx, AWARDED_MS, out);
}

// ---- hands and the game -------------------------------------------------------

const alive = (s: State) => s.players.filter((p) => !p.removed && !p.out && p.stack > 0);

function startHand(s: State, ctx: GameContext, out: Out): void {
  const hpl = s.settings.handsPerLevel;
  const before = s.handNumber ? levelIndexFor(s.handNumber, hpl) : 0;
  s.handNumber++;
  const level = levelIndexFor(s.handNumber, hpl);
  const b = bootFor(level);
  if (level !== before) out.events.push(pub({ type: "level-up", level: level + 1, boot: b }));

  for (const p of s.players) {
    p.inHand = !p.removed && !p.out && p.stack > 0;
    p.cards = [];
    p.packed = false;
    p.seen = false;
    p.allIn = false;
    p.contributed = 0;
    p.lastMove = null;
    p.shown = false;
    p.peeks = [];
    p.startStack = p.stack;
    p.lied = false;
    p.bigBid = false;
    p.compared = false;
  }
  // The first hand's dealer is the room's dealer seat (or the next one in); after that it moves one left.
  s.dealerIndex = s.handNumber === 1 && s.players[s.dealerIndex]!.inHand ? s.dealerIndex : nextDealt(s, s.dealerIndex);
  const deck = s.testDecks?.length ? s.testDecks.shift()!.map((id) => parseCardId(id)!) : shuffle(makeDeck(), ctx.randomInt);
  const order = around(s, s.dealerIndex).filter((i) => s.players[i]!.inHand);
  for (let round = 0; round < 3; round++) for (const i of order) s.players[i]!.cards.push(deck.shift()!);

  s.stake = b;
  s.step = "betting";
  s.sideshow = null;
  s.allIns = [];
  const boots = order.map((i) => {
    const p = s.players[i]!;
    return { playerId: p.id, amount: put(p, b) };
  });
  // A stack short of the boot is all-in with everyone's boot in.
  noteAllIns(s);
  out.events.push(
    pub({
      type: "hand-start",
      handNumber: s.handNumber,
      level: level + 1,
      boot: b,
      dealerId: s.players[s.dealerIndex]!.id,
      dealt: order.map((i) => s.players[i]!.id),
      boots,
    }),
  );
  s.turnIndex = -1;
  proceed(s, ctx, out);
}

function finish(s: State, reason: EndReason, out: Out): void {
  s.phase = "over";
  s.turnIndex = -1;
  s.sideshow = null;
  const standing = alive(s);
  const top = Math.max(0, ...standing.map((p) => p.stack));
  s.winnerIds = standing.filter((p) => p.stack === top).map((p) => p.id);
  s.endReason = reason;
  out.timers.push({ kind: "cancel", timerId: TURN_TIMER }, { kind: "cancel", timerId: ANSWER_TIMER }, { kind: "cancel", timerId: STEP_TIMER });
  out.events.push(pub({ type: "game-over", winnerIds: s.winnerIds, reason }));
}

/** After the show or pack-out pause: busts, the time cap, and the next hand's pause or the end. */
function endHand(s: State, ctx: GameContext, out: Out): void {
  const capped = capEndsAt(s);
  const busted = s.players.filter((p) => p.inHand && !p.removed && !p.out && p.stack === 0);
  for (const p of busted) {
    p.out = true;
    p.bustedHand = s.handNumber;
    p.bustStack = p.startStack;
  }
  if (busted.length) out.events.push(pub({ type: "busted", playerIds: busted.map((p) => p.id) }));
  if (capped !== null && ctx.now >= capped) return finish(s, "time", out);
  if (alive(s).length <= 1) return finish(s, "last-standing", out);
  s.step = "between-hands";
  setStep(s, ctx, BETWEEN_MS, out);
}

function nextHand(s: State, ctx: GameContext, out: Out): void {
  if (s.players.filter((p) => !p.removed).length <= 1) return finish(s, "abandoned", out);
  if (alive(s).length <= 1) return finish(s, "last-standing", out);
  startHand(s, ctx, out);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Test decks: a list of card ids for the first hand, or a list of such lists,
 * one per hand. Each may be partial; the rest of the deck follows in order.
 * Cards go one at a time from the dealer's left.
 */
function normalizeDecks(input: unknown[]): string[][] {
  const decks = input.length && input.every((d) => Array.isArray(d)) ? (input as unknown[][]) : [input];
  const all = makeDeck().map((c) => c.id);
  return decks.map((deck) => {
    const ids = deck.map((c) => (typeof c === "string" ? c : (c as Card)?.id));
    if (!ids.every((id) => typeof id === "string" && all.includes(id)) || new Set(ids).size !== ids.length) {
      throw new Error('A test deck lists each card at most once, by id (e.g. "hearts-A", "spades-10").');
    }
    return [...ids, ...all.filter((id) => !ids.includes(id))] as string[];
  });
}

function parseSettings(input: unknown): TeenPattiSettings | null {
  if (input === undefined || input === null) return { ...DEFAULT_SETTINGS };
  if (typeof input !== "object" || Array.isArray(input)) return null;
  const s = { ...DEFAULT_SETTINGS, ...(input as Partial<TeenPattiSettings>) };
  const ok =
    (STARTING_CHIPS_OPTIONS as readonly unknown[]).includes(s.startingChips) &&
    (HANDS_PER_LEVEL_OPTIONS as readonly unknown[]).includes(s.handsPerLevel) &&
    (ENDING_OPTIONS as readonly unknown[]).includes(s.ending) &&
    (TURN_SECONDS_OPTIONS as readonly unknown[]).includes(s.turnSeconds);
  return ok ? { startingChips: s.startingChips, handsPerLevel: s.handsPerLevel, ending: s.ending, turnSeconds: s.turnSeconds } : null;
}

const ACTIONS = new Set(["see", "chaal", "double", "all-in", "pack", "show", "sideshow", "accept", "refuse", "back"]);

function parseAction(input: unknown): TeenPattiAction | null {
  if (typeof input !== "object" || input === null) return null;
  const type = (input as Record<string, unknown>).type;
  return typeof type === "string" && ACTIONS.has(type) ? ({ type } as TeenPattiAction) : null;
}

// ---------------------------------------------------------------------------
// Definition
// ---------------------------------------------------------------------------

function newPlayer(id: string, stack: number): Player {
  return {
    id,
    stack,
    cards: [],
    inHand: false,
    packed: false,
    seen: false,
    allIn: false,
    contributed: 0,
    lastMove: null,
    shown: false,
    peeks: [],
    startStack: stack,
    timeouts: 0,
    sittingOut: false,
    away: false,
    removed: false,
    out: false,
    bustedHand: null,
    bustStack: 0,
    lied: false,
    bigBid: false,
    compared: false,
  };
}

const noop = (state: State) => ({ state, events: [] });

export const teenPattiGame: GameDefinition<
  TeenPattiServerState,
  TeenPattiAction,
  TeenPattiPublicState,
  TeenPattiPrivateState,
  TeenPattiSettings,
  TeenPattiEvent
> = {
  manifest: teenPattiManifest,
  defaultSettings: DEFAULT_SETTINGS,
  bot: teenPattiBot,
  parseSettings,
  parseAction,

  createGame(players, settings, match, ctx, options?: CreateGameOptions) {
    const n = players.length;
    const { minPlayers, maxPlayers } = teenPattiManifest;
    if (n < minPlayers || n > maxPlayers) throw new Error(`teen-patti: needs ${minPlayers}–${maxPlayers} players, got ${n}`);
    const state: State = {
      phase: "playing",
      step: "betting",
      settings,
      players: players.map((p) => newPlayer(p.id, settings.startingChips)),
      startedAt: ctx.now,
      handNumber: 0,
      dealerIndex: ((match.dealerSeat % n) + n) % n,
      turnIndex: -1,
      deadline: 0,
      stake: 0,
      sideshow: null,
      allIns: [],
      lastHand: null,
      stepEndsAt: 0,
      testDecks: options?.deck ? normalizeDecks(options.deck) : null,
      winnerIds: [],
      endReason: null,
      pausedAt: null,
      stats: {},
    };
    const out = newOut();
    startHand(state, ctx, out);
    return done(state, out);
  },

  handleAction(prev, playerId, action, ctx) {
    if (prev.phase !== "playing") return reject("game-finished", "The game is over.");
    const seat = prev.players.findIndex((p) => p.id === playerId);
    const me = prev.players[seat];
    if (!me || me.removed) return reject("not-in-game", "You're not in this game.");

    switch (action.type) {
      case "see": {
        if (!handOn(prev) || !live(me)) return reject("cant-see", "You are not in this hand.");
        if (me.seen) return reject("cant-see", "You have already seen your cards.");
        const state = clone(prev);
        const p = state.players[seat]!;
        p.seen = true;
        if (state.turnIndex === seat) p.timeouts = 0;
        return {
          ok: true,
          transition: { state, events: [only(playerId, { type: "your-cards", cards: p.cards }), pub({ type: "saw", playerId })] },
        };
      }
      case "back": {
        if (!me.sittingOut) return reject("not-sitting-out", "You are already playing.");
        const state = clone(prev);
        const p = state.players[seat]!;
        p.sittingOut = false;
        p.timeouts = 0;
        return { ok: true, transition: { state, events: [pub({ type: "back", playerId })] } };
      }
      case "accept":
      case "refuse": {
        if (prev.step !== "sideshow" || prev.sideshow?.toId !== playerId) return reject("no-sideshow", "Nobody asked you for a Sideshow.");
        const state = clone(prev);
        const out = newOut();
        state.players[seat]!.timeouts = 0;
        answer(state, ctx, action.type === "accept", out);
        return { ok: true, transition: done(state, out) };
      }
      default: {
        if (!betting(prev) || prev.turnIndex !== seat) return reject("not-your-turn", "It's not your turn.");
        const state = clone(prev);
        const out = newOut();
        const error = applyMove(state, ctx, seat, action, out);
        if (error) return reject("illegal-move", error);
        state.players[seat]!.timeouts = 0;
        return { ok: true, transition: done(state, out) };
      }
    }
  },

  onTimer(prev, timerId, ctx) {
    if (prev.phase !== "playing") return noop(prev);
    if (timerId === TURN_TIMER) {
      if (!betting(prev)) return noop(prev);
      const state = clone(prev);
      const out = newOut();
      timeout(state, ctx, "timer", out);
      return done(state, out);
    }
    if (timerId === ANSWER_TIMER) {
      if (prev.step !== "sideshow" || !prev.sideshow) return noop(prev);
      const state = clone(prev);
      const out = newOut();
      answer(state, ctx, false, out, "timer");
      return done(state, out);
    }
    if (timerId !== STEP_TIMER) return noop(prev);
    const state = clone(prev);
    const out = newOut();
    if (state.step === "showdown" || state.step === "awarded") endHand(state, ctx, out);
    else if (state.step === "between-hands") nextHand(state, ctx, out);
    else return noop(prev);
    return done(state, out);
  },

  /** The host's Skip does what the clock would: a turn packs, a Sideshow answer is no. */
  skipTurn(prev, playerId, ctx) {
    if (prev.phase !== "playing") return noop(prev);
    if (prev.step === "sideshow" && prev.sideshow?.toId === playerId) {
      const state = clone(prev);
      const out = newOut();
      answer(state, ctx, false, out, "skip");
      return done(state, out);
    }
    if (!betting(prev) || prev.players[prev.turnIndex]!.id !== playerId) return noop(prev);
    const state = clone(prev);
    const out = newOut();
    timeout(state, ctx, "skip", out);
    return done(state, out);
  },

  /** Dropped players pack on their turn and say no to a Sideshow, until they're back. */
  onPlayerDisconnected(prev, playerId, ctx) {
    const idx = prev.players.findIndex((p) => p.id === playerId);
    if (prev.phase !== "playing" || idx < 0 || prev.players[idx]!.away) return noop(prev);
    const state = clone(prev);
    const out = newOut();
    state.players[idx]!.away = true;
    if (state.step === "sideshow" && state.sideshow?.toId === playerId) answer(state, ctx, false, out, "sitting-out");
    else if (betting(state) && state.turnIndex === idx) proceed(state, ctx, out);
    return done(state, out);
  },

  onPlayerReconnected(prev, playerId) {
    const idx = prev.players.findIndex((p) => p.id === playerId);
    if (idx < 0 || !prev.players[idx]!.away) return noop(prev);
    const state = clone(prev);
    const p = state.players[idx]!;
    p.away = false;
    const events: Events = [];
    if (p.sittingOut && state.phase === "playing") events.push(pub({ type: "back", playerId }));
    p.sittingOut = false;
    p.timeouts = 0;
    return { state, events };
  },

  /** Mid-hand, a leaver packs. What they put in stays in the pot; the rest of their stack leaves with them. */
  onPlayerRemoved(prev, playerId, ctx) {
    const idx = prev.players.findIndex((p) => p.id === playerId);
    if (prev.phase !== "playing" || idx < 0 || prev.players[idx]!.removed) return noop(prev);
    const state = clone(prev);
    const out = newOut([pub({ type: "player-removed", playerId })]);
    const p = state.players[idx]!;
    const on = handOn(state);
    const wasTurn = on && state.turnIndex === idx;
    const req = state.sideshow;
    p.removed = true;
    p.stack = 0;
    if (on && live(p)) pack(p, "left", out);
    if (on) {
      if (req && (req.fromId === playerId || req.toId === playerId)) {
        // The Sideshow is off. Play goes on from the asker.
        closeSideshow(state, out);
        state.turnIndex = nextActor(state, state.players.findIndex((x) => x.id === req.fromId));
        proceed(state, ctx, out);
      } else if (state.step === "betting" && (wasTurn || liveCount(state) <= 1 || state.players.filter(actable).length <= 1)) {
        // Someone else's clock keeps running unless the hand is over.
        if (wasTurn) state.turnIndex = nextActor(state, idx);
        proceed(state, ctx, out);
      }
    } else if (state.step === "between-hands" && alive(state).length <= 1) finish(state, "last-standing", out);
    if (state.phase === "playing" && state.players.filter((x) => !x.removed).length <= 1) finish(state, "abandoned", out);
    return done(state, out);
  },

  /**
   * The room holds the timers and stops `ctx.now` while paused. On resume the
   * turn, the Sideshow answer, the pause between hands and the time cap all
   * move on by the time paused.
   */
  pause(prev, paused, ctx) {
    if (prev.phase !== "playing") return noop(prev);
    if (paused) return prev.pausedAt !== null ? noop(prev) : { state: { ...prev, pausedAt: ctx.now }, events: [] };
    if (prev.pausedAt === null) return noop(prev);
    const gap = ctx.now - prev.pausedAt;
    const state = clone(prev);
    state.pausedAt = null;
    if (state.deadline > 0) state.deadline += gap;
    if (state.stepEndsAt > 0) state.stepEndsAt += gap;
    if (state.sideshow) state.sideshow.deadline += gap;
    state.startedAt += gap;
    return { state, events: [] };
  },

  getPublicState(state) {
    const playing = state.phase === "playing";
    const hpl = state.settings.handsPerLevel;
    const level = levelIndexFor(state.handNumber, hpl);
    const b = bootFor(level);
    const on = handOn(state);
    const pots = on ? potsOf(state).filter((x) => !x.uncalled) : [];
    const current = betting(state) ? state.players[state.turnIndex]! : null;
    const ss = playing && state.step === "sideshow" ? state.sideshow : null;
    return {
      step: playing ? state.step : "over",
      handNumber: state.handNumber,
      level: level + 1,
      boot: b,
      nextBoot: bootFor(level + 1),
      handsToNextLevel: hpl - ((state.handNumber - 1) % hpl),
      startingChips: state.settings.startingChips,
      stake: state.stake,
      potLimit: potLimitFor(b),
      players: state.players.map((p) => ({
        id: p.id,
        stack: p.stack,
        inHand: p.inHand,
        packed: p.packed,
        seen: p.seen,
        allIn: p.allIn,
        inPot: p.inHand ? p.contributed : 0,
        lastMove: p.inHand ? p.lastMove : null,
        sittingOut: p.sittingOut,
        away: p.away,
        removed: p.removed,
        out: p.out,
        cards: p.shown && p.inHand ? p.cards : null,
      })),
      dealerId: state.handNumber ? (state.players[state.dealerIndex]?.id ?? null) : null,
      pot: on ? potOf(state) : 0,
      pots: pots.length > 1 ? pots : [],
      currentPlayerId: current?.id ?? null,
      turn: current ? { endsAt: state.deadline, ms: state.settings.turnSeconds * 1000 } : null,
      sideshow: ss ? { fromId: ss.fromId, toId: ss.toId, endsAt: ss.deadline, ms: SIDESHOW_ANSWER_MS } : null,
      stepEndsAt: state.stepEndsAt,
      lastHand: state.lastHand,
      capEndsAt: capEndsAt(state),
      pausedAt: state.pausedAt,
      winnerIds: state.winnerIds,
      endReason: state.endReason,
    };
  },

  getPrivateState(state, playerId) {
    const p = state.players.find((x) => x.id === playerId);
    if (!p) return { cards: [], label: null, canSee: false, legal: null, answer: null, peeks: [], canBack: false };
    const playing = state.phase === "playing" && !p.removed;
    const cards = p.inHand && (p.seen || p.shown) ? p.cards : [];
    const on = playing && handOn(state);
    return {
      cards,
      label: cards.length === 3 ? evaluate(cards).label : null,
      canSee: on && live(p) && !p.seen,
      legal: on && betting(state) && state.players[state.turnIndex] === p ? legalFor(state, p) : null,
      answer: on && state.step === "sideshow" && state.sideshow?.toId === p.id ? { fromId: state.sideshow.fromId } : null,
      peeks: p.inHand
        ? p.peeks.map((id) => {
            const o = state.players.find((x) => x.id === id)!;
            return { playerId: id, cards: o.cards, label: evaluate(o.cards).label };
          })
        : [],
      canBack: playing && p.sittingOut,
    };
  },

  getAwaitedPlayerIds(state) {
    if (state.phase !== "playing") return [];
    if (state.step === "sideshow" && state.sideshow) return [state.sideshow.toId];
    return betting(state) ? [state.players[state.turnIndex]!.id] : [];
  },

  getResult(state): GameOutcome | null {
    if (state.phase !== "over") return null;
    const standing = state.players.filter((p) => !p.removed && !p.out).sort((a, b) => b.stack - a.stack);
    // Out later ranks higher; out in the same hand, the bigger starting stack does.
    const above = (a: Player, b: Player) =>
      (a.bustedHand ?? 0) > (b.bustedHand ?? 0) || (a.bustedHand === b.bustedHand && a.bustStack > b.bustStack);
    const busted = state.players.filter((p) => p.out).sort((a, b) => (above(a, b) ? -1 : above(b, a) ? 1 : 0));
    const left = state.players.filter((p) => p.removed && !p.out);
    return {
      winnerIds: state.winnerIds,
      standings: [
        ...standing.map((p) => ({ playerId: p.id, value: p.stack, label: `${formatChips(p.stack)} chips` })),
        ...busted.map((p) => {
          const place = standing.length + 1 + busted.filter((o) => above(o, p)).length;
          return { playerId: p.id, value: 0, label: `out ${ordinal(place)}` };
        }),
        ...left.map((p) => ({ playerId: p.id, value: 0, label: "left" })),
      ],
    };
  },

  partyStats(state) {
    return state.stats ?? {};
  },
};
