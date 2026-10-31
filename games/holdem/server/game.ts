import {
  shuffle,
  type CreateGameOptions,
  type GameContext,
  type GameDefinition,
  type GameEventEnvelope,
  type GameOutcome,
  type GameResult,
  type TimerRequest,
} from "@games/game-core";
import { holdemManifest } from "../shared/manifest.ts";
import {
  awardPots,
  bestHand,
  blindsFor,
  buildPots,
  formatChips,
  levelIndexFor,
  makeDeck,
  ordinal,
  parseCardId,
} from "../shared/rules.ts";
import {
  DEFAULT_SETTINGS,
  ENDING_OPTIONS,
  HANDS_PER_LEVEL_OPTIONS,
  REBUY_LEVELS,
  REBUY_OPTIONS,
  STARTING_CHIPS_OPTIONS,
  STREETS,
  TURN_SECONDS_OPTIONS,
  type AutoReason,
  type BetKind,
  type Card,
  type EndReason,
  type HandSummary,
  type HoldemAction,
  type HoldemEvent,
  type HoldemPlayerState,
  type HoldemPrivateState,
  type HoldemPublicState,
  type HoldemServerState,
  type HoldemSettings,
  type LegalActions,
  type Street,
} from "../shared/types.ts";

type State = HoldemServerState;
type Player = HoldemPlayerState;
type Events = GameEventEnvelope<HoldemEvent>[];

const pub = (event: HoldemEvent): GameEventEnvelope<HoldemEvent> => ({ visibility: { kind: "public" }, event });
const only = (playerId: string, event: HoldemEvent): GameEventEnvelope<HoldemEvent> => ({
  visibility: { kind: "private", playerId },
  event,
});
const reject = (code: string, message: string): GameResult<State, HoldemEvent> => ({ ok: false, error: { code, message } });

/** The decision clock. Re-set for every decision, which replaces the last one. */
export const TURN_TIMER = "turn";
/** Every pause that isn't a decision: run-out cards, showdown, between hands. */
export const STEP_TIMER = "step";

export const RUNOUT_MS = 1500;
/**
 * The showdown pause: a beat per hand turned over, then the winner and the
 * pot. Sized so the table's reveal (client) is never cut short.
 */
export const SHOWDOWN_BASE_MS = 3500;
export const SHOWDOWN_PER_HAND_MS = 1300;
export const showdownMs = (hands: number) => SHOWDOWN_BASE_MS + SHOWDOWN_PER_HAND_MS * hands;
export const AWARDED_MS = 3000;
export const BETWEEN_MS = 4000;
/** Between hands, when someone busted and could buy back in. */
export const REBUY_MS = 12000;
/** Everyone who could rebuy has: no point waiting out the window. */
const REBUY_DONE_MS = 1500;

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

const isStreet = (step: string): step is Street => (STREETS as readonly string[]).includes(step);
/** Someone has a decision to make right now. */
const betting = (s: State) => s.phase === "playing" && isStreet(s.step) && !s.runout && s.turnIndex >= 0;

const live = (p: Player) => p.inHand && !p.folded;
const actable = (p: Player) => live(p) && !p.allIn;
const liveCount = (s: State) => s.players.filter(live).length;

function needsToAct(s: State, p: Player): boolean {
  return actable(p) && (!p.acted || p.bet < s.currentBet);
}

/** Seats after `from`, clockwise, ending with `from` itself. */
function around(s: State, from: number): number[] {
  const n = s.players.length;
  return Array.from({ length: n }, (_, i) => (from + 1 + i) % n);
}

function nextActor(s: State, from: number): number {
  return around(s, from).find((i) => needsToAct(s, s.players[i]!)) ?? -1;
}

/** Next seat after `from` that's dealt into this hand. */
function nextDealt(s: State, from: number): number {
  return around(s, from).find((i) => s.players[i]!.inHand) ?? from;
}

/**
 * Nobody's left to act: everyone who can bet has matched the high bet and
 * acted since the last full raise. With one player able to bet and the rest
 * all-in, they only need to act if they're short of what's been bet.
 */
function roundOver(s: State): boolean {
  const can = s.players.filter(actable);
  if (can.length <= 1) {
    if (!can.length) return true;
    const me = can[0]!;
    const most = Math.max(0, ...s.players.filter((p) => live(p) && p !== me).map((p) => p.bet));
    return me.bet >= most;
  }
  return !can.some((p) => needsToAct(s, p));
}

function blinds(s: State) {
  return blindsFor(levelIndexFor(s.handNumber, s.settings.handsPerLevel));
}

function capEndsAt(s: State): number | null {
  return s.settings.ending === "last" ? null : s.startedAt + s.settings.ending * 60_000;
}

/** Seat ids from the button's left round to the button: the order odd chips go in. */
function fromButton(s: State): string[] {
  return around(s, s.buttonIndex).map((i) => s.players[i]!.id);
}

function put(p: Player, amount: number): void {
  const a = Math.min(amount, p.stack);
  p.stack -= a;
  p.bet += a;
  p.contributed += a;
  if (p.stack === 0) p.allIn = true;
}

function canRaise(s: State, p: Player): boolean {
  if (!actable(p) || p.acted) return false;
  if (p.stack + p.bet <= s.currentBet) return false;
  // Everyone else is all-in: a raise would only come straight back.
  return s.players.some((o) => o !== p && actable(o));
}

function legalFor(s: State, p: Player): LegalActions {
  const owed = Math.max(0, s.currentBet - p.bet);
  const max = p.bet + p.stack;
  const raise = canRaise(s, p);
  return {
    check: owed === 0,
    call: Math.min(owed, p.stack),
    minRaiseTo: raise ? Math.min(s.currentBet + s.minRaise, max) : null,
    maxRaiseTo: raise ? max : null,
    opening: s.currentBet === 0,
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

// ---- betting --------------------------------------------------------------

function raiseTo(s: State, p: Player, to: number, out: Out, auto?: AutoReason): void {
  const before = s.currentBet;
  const increase = to - before;
  put(p, to - p.bet);
  // A full raise reopens the betting; a short all-in only has to be called.
  if (increase >= s.minRaise) {
    s.minRaise = increase;
    for (const o of s.players) if (o !== p) o.acted = false;
  }
  s.currentBet = Math.max(before, p.bet);
  const kind: BetKind = p.allIn ? "all-in" : before === 0 ? "bet" : "raise";
  out.events.push(pub({ type: "bet", playerId: p.id, kind, amount: p.bet, to: p.bet, ...(auto ? { auto } : {}) }));
}

/** Null on success, or why not. */
function applyBet(s: State, idx: number, action: HoldemAction, out: Out, auto?: AutoReason): string | null {
  const p = s.players[idx]!;
  const ev = (kind: BetKind) =>
    out.events.push(pub({ type: "bet", playerId: p.id, kind, amount: p.bet, to: p.bet, ...(auto ? { auto } : {}) }));
  switch (action.type) {
    case "fold":
      p.folded = true;
      ev("fold");
      break;
    case "check":
      if (p.bet < s.currentBet) return "There's a bet to call.";
      ev("check");
      break;
    case "call": {
      if (p.bet >= s.currentBet) return "Nothing to call. Check instead.";
      put(p, s.currentBet - p.bet);
      ev(p.allIn ? "all-in" : "call");
      break;
    }
    case "raise": {
      const max = p.bet + p.stack;
      if (!canRaise(s, p)) return "You can only call or fold.";
      if (!Number.isInteger(action.to) || action.to > max) return `You can raise to ${formatChips(max)} at most.`;
      const min = s.currentBet + s.minRaise;
      if (action.to <= s.currentBet || (action.to < min && action.to < max)) {
        return `The smallest ${s.currentBet ? "raise" : "bet"} is to ${formatChips(Math.min(min, max))}.`;
      }
      raiseTo(s, p, action.to, out, auto);
      break;
    }
    case "all-in": {
      const total = p.bet + p.stack;
      if (total <= s.currentBet) {
        put(p, p.stack);
        ev("all-in");
      } else {
        if (!canRaise(s, p)) return "You can only call or fold.";
        raiseTo(s, p, total, out, auto);
      }
      break;
    }
    default:
      return "Not a betting move.";
  }
  p.acted = true;
  return null;
}

/** The clock ran out, the host skipped, or they're sitting out: check if free, else fold. */
function autoAct(s: State, idx: number, reason: AutoReason, out: Out): void {
  const p = s.players[idx]!;
  applyBet(s, idx, { type: p.bet >= s.currentBet ? "check" : "fold" }, out, reason);
}

/** A missed decision: auto check/fold, and the second in a row sits you out. */
function timeout(s: State, ctx: GameContext, reason: AutoReason, out: Out): void {
  const idx = s.turnIndex;
  const p = s.players[idx]!;
  autoAct(s, idx, reason, out);
  p.timeouts++;
  if (p.timeouts >= 2 && !p.sittingOut) {
    p.sittingOut = true;
    out.events.push(pub({ type: "sitting-out", playerId: p.id }));
  }
  s.turnIndex = nextActor(s, idx);
  proceed(s, ctx, out);
}

/**
 * Moves the hand along until someone real has a decision, or it reaches a
 * pause (run-out, showdown, fold-out). Players sitting out or away are acted
 * for on the spot.
 */
function proceed(s: State, ctx: GameContext, out: Out): void {
  for (;;) {
    if (liveCount(s) <= 1) return winByFold(s, ctx, out);
    if (roundOver(s) || s.turnIndex < 0) {
      if (!closeRound(s, ctx, out)) return;
      continue;
    }
    const idx = s.turnIndex;
    const p = s.players[idx]!;
    if (p.sittingOut || p.away) {
      autoAct(s, idx, "sitting-out", out);
      s.turnIndex = nextActor(s, idx);
      continue;
    }
    const ms = s.settings.turnSeconds * 1000;
    s.deadline = ctx.now + ms;
    out.timers.push({ kind: "set", timerId: TURN_TIMER, delayMs: ms });
    return;
  }
}

/** Chips above everyone else's total for the hand go back before anything's dealt or shown. */
function returnUncalled(s: State, out: Out): void {
  const dealt = s.players.filter((p) => p.inHand);
  const top = dealt.reduce<Player | null>((a, p) => (!a || p.contributed > a.contributed ? p : a), null);
  if (!top || top.folded) return;
  const next = Math.max(0, ...dealt.filter((p) => p !== top).map((p) => p.contributed));
  const extra = top.contributed - next;
  if (extra <= 0) return;
  top.contributed -= extra;
  top.stack += extra;
  top.allIn = top.stack === 0;
  out.events.push(pub({ type: "returned", playerId: top.id, amount: extra }));
}

/**
 * The betting round's done. True when a new one started (someone has a
 * decision); false when the hand went to a run-out or a showdown.
 */
function closeRound(s: State, ctx: GameContext, out: Out): boolean {
  stopClock(s, out);
  returnUncalled(s, out);
  for (const p of s.players) {
    p.bet = 0;
    p.acted = false;
  }
  s.currentBet = 0;
  s.minRaise = blinds(s).bb;
  if (s.board.length >= 5) {
    showdown(s, ctx, out);
    return false;
  }
  if (s.players.filter(actable).length <= 1) {
    startRunout(s, ctx, out);
    return false;
  }
  dealStreet(s, out);
  s.turnIndex = nextActor(s, s.buttonIndex);
  return true;
}

function dealStreet(s: State, out: Out): void {
  const street: Street = s.board.length === 0 ? "flop" : s.board.length === 3 ? "turn" : "river";
  const cards = s.deck.splice(0, street === "flop" ? 3 : 1);
  s.board.push(...cards);
  s.step = street;
  out.events.push(pub({ type: "board", street, cards }));
}

/** Nobody left to bet against: cards up, and the rest of the board comes out slowly. */
function startRunout(s: State, ctx: GameContext, out: Out): void {
  s.runout = true;
  const hands: Record<string, Card[]> = {};
  for (const p of s.players.filter(live)) {
    if (!p.shown) hands[p.id] = p.hole;
    p.shown = true;
  }
  if (Object.keys(hands).length) out.events.push(pub({ type: "reveal", hands }));
  setStep(s, ctx, RUNOUT_MS, out);
}

function summaryBase(s: State, byFold: boolean): HandSummary {
  return { handNumber: s.handNumber, byFold, board: [...s.board], pots: [], shown: {}, bestCards: {}, fives: {}, labels: {}, won: {}, order: [] };
}

function contributions(s: State) {
  const dealt = s.players.filter((p) => p.inHand);
  return {
    totals: Object.fromEntries(dealt.map((p) => [p.id, p.contributed])),
    folded: dealt.filter((p) => p.folded).map((p) => p.id),
  };
}

function showdown(s: State, ctx: GameContext, out: Out): void {
  s.step = "showdown";
  s.runout = false;
  const { totals, folded } = contributions(s);
  const pots = buildPots(totals, folded);
  const contenders = s.players.filter(live);
  const values = Object.fromEntries(contenders.map((p) => [p.id, bestHand([...p.hole, ...s.board])]));
  const { won, returned, results } = awardPots(
    pots,
    Object.fromEntries(Object.entries(values).map(([id, v]) => [id, v.ranks])),
    fromButton(s),
  );
  for (const p of s.players) p.stack += (won[p.id] ?? 0) + (returned[p.id] ?? 0);

  results.forEach((r, i) => {
    if (r.uncalled || pots[i]!.eligible.length < 2) return;
    r.label = values[r.winners[0]!]!.label;
  });
  // Everyone still in turns their cards over, winners and losers alike: the
  // table gets to see what beat what.
  const hands: Record<string, Card[]> = {};
  const summary = summaryBase(s, false);
  summary.pots = results;
  summary.won = won;
  const seatOrder = fromButton(s);
  summary.order = contenders.map((p) => p.id).sort((a, b) => seatOrder.indexOf(a) - seatOrder.indexOf(b));
  for (const p of contenders) {
    if (!p.shown) hands[p.id] = p.hole;
    p.shown = true;
    summary.shown[p.id] = p.hole;
    summary.labels[p.id] = values[p.id]!.label;
    summary.fives[p.id] = values[p.id]!.cards;
    if (won[p.id]) summary.bestCards[p.id] = values[p.id]!.cards;
  }
  s.lastHand = summary;
  if (Object.keys(hands).length) out.events.push(pub({ type: "reveal", hands }));
  out.events.push(pub({ type: "awarded", summary }));
  setStep(s, ctx, showdownMs(contenders.length), out);
}

/** Everyone else folded. The winner's cards stay down unless they tap Show. */
function winByFold(s: State, ctx: GameContext, out: Out): void {
  stopClock(s, out);
  returnUncalled(s, out);
  for (const p of s.players) p.bet = 0;
  s.currentBet = 0;
  s.runout = false;
  const winner = s.players.find(live)!;
  const total = s.players.reduce((sum, p) => sum + (p.inHand ? p.contributed : 0), 0);
  winner.stack += total;
  const summary = summaryBase(s, true);
  summary.pots = [{ amount: total, winners: [winner.id], label: null }];
  summary.won = { [winner.id]: total };
  // Hands shown in a run-out that a removal cut short stay shown.
  for (const p of s.players) if (p.shown && p.inHand) summary.shown[p.id] = p.hole;
  s.lastHand = summary;
  s.step = "awarded";
  out.events.push(pub({ type: "awarded", summary }));
  setStep(s, ctx, AWARDED_MS, out);
}

// ---- hands and the tournament ----------------------------------------------

const alive = (s: State) => s.players.filter((p) => !p.removed && !p.out && !p.pendingRebuy && p.stack > 0);
const pending = (s: State) => s.players.filter((p) => p.pendingRebuy && !p.removed);

function startHand(s: State, ctx: GameContext, out: Out): void {
  const hpl = s.settings.handsPerLevel;
  const before = s.handNumber ? levelIndexFor(s.handNumber, hpl) : 0;
  s.handNumber++;
  const level = levelIndexFor(s.handNumber, hpl);
  const { sb, bb } = blindsFor(level);
  if (level !== before) out.events.push(pub({ type: "level-up", level: level + 1, sb, bb }));

  for (const p of s.players) {
    p.inHand = !p.removed && !p.out && !p.pendingRebuy && p.stack > 0;
    p.hole = [];
    p.folded = false;
    p.allIn = false;
    p.bet = 0;
    p.contributed = 0;
    p.acted = false;
    p.shown = false;
    p.startStack = p.stack;
  }
  const count = s.players.filter((p) => p.inHand).length;
  // The first hand's button sits on the dealer seat (or the next one in); after that it moves one left.
  s.buttonIndex = s.handNumber === 1 && s.players[s.buttonIndex]!.inHand ? s.buttonIndex : nextDealt(s, s.buttonIndex);
  // Heads-up the button is the small blind.
  s.sbIndex = count === 2 ? s.buttonIndex : nextDealt(s, s.buttonIndex);
  s.bbIndex = nextDealt(s, s.sbIndex);

  s.deck = s.testDecks?.length ? s.testDecks.shift()!.map((id) => parseCardId(id)!) : shuffle(makeDeck(), ctx.randomInt);
  s.board = [];
  s.step = "preflop";
  s.runout = false;
  s.currentBet = bb;
  s.minRaise = bb;

  // One card at a time, from the button's left.
  const order = around(s, s.buttonIndex).filter((i) => s.players[i]!.inHand);
  for (let round = 0; round < 2; round++) for (const i of order) s.players[i]!.hole.push(s.deck.shift()!);

  const sbP = s.players[s.sbIndex]!;
  const bbP = s.players[s.bbIndex]!;
  put(sbP, sb);
  put(bbP, bb);
  out.events.push(
    pub({
      type: "hand-start",
      handNumber: s.handNumber,
      level: level + 1,
      sb,
      bb,
      buttonId: s.players[s.buttonIndex]!.id,
      sbId: sbP.id,
      bbId: bbP.id,
      dealt: order.map((i) => s.players[i]!.id),
      blinds: [
        { playerId: sbP.id, amount: sbP.bet },
        { playerId: bbP.id, amount: bbP.bet },
      ],
    }),
  );
  for (const i of order) out.events.push(only(s.players[i]!.id, { type: "your-cards", cards: s.players[i]!.hole }));

  s.turnIndex = nextActor(s, s.bbIndex);
  proceed(s, ctx, out);
}

function finish(s: State, reason: EndReason, out: Out): void {
  s.phase = "over";
  s.turnIndex = -1;
  s.runout = false;
  for (const p of s.players) {
    if (p.pendingRebuy) {
      p.pendingRebuy = false;
      p.out = true;
    }
  }
  const standing = alive(s);
  const top = Math.max(0, ...standing.map((p) => p.stack));
  s.winnerIds = standing.filter((p) => p.stack === top).map((p) => p.id);
  s.endReason = reason;
  out.timers.push({ kind: "cancel", timerId: TURN_TIMER }, { kind: "cancel", timerId: STEP_TIMER });
  out.events.push(pub({ type: "game-over", winnerIds: s.winnerIds, reason }));
}

/** After the showdown pause: busts, the time cap, and either the next hand's pause or the end. */
function endHand(s: State, ctx: GameContext, out: Out): void {
  const capped = capEndsAt(s);
  const timeUp = capped !== null && ctx.now >= capped;
  const rebuyOpen =
    !timeUp && s.settings.rebuys === "early" && levelIndexFor(s.handNumber, s.settings.handsPerLevel) < REBUY_LEVELS;
  const busted = s.players.filter((p) => p.inHand && !p.removed && !p.out && !p.pendingRebuy && p.stack === 0);
  const rebuy: string[] = [];
  for (const p of busted) {
    p.bustedHand = s.handNumber;
    p.bustStack = p.startStack;
    if (rebuyOpen && p.rebuysUsed === 0) {
      p.pendingRebuy = true;
      rebuy.push(p.id);
    } else p.out = true;
  }
  if (busted.length) out.events.push(pub({ type: "busted", playerIds: busted.map((p) => p.id), rebuy }));

  if (timeUp) return finish(s, "time", out);
  if (alive(s).length <= 1 && !pending(s).length) return finish(s, "last-standing", out);
  s.step = "between-hands";
  setStep(s, ctx, pending(s).length ? REBUY_MS : BETWEEN_MS, out);
}

/** The pause between hands is over: whoever didn't rebuy is out, and the next hand's dealt. */
function nextHand(s: State, ctx: GameContext, out: Out): void {
  for (const p of pending(s)) {
    p.pendingRebuy = false;
    p.out = true;
  }
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
 * Hole cards go one at a time from the button's left, then the board.
 */
function normalizeDecks(input: unknown[]): string[][] {
  const decks = input.length && input.every((d) => Array.isArray(d)) ? (input as unknown[][]) : [input];
  const all = makeDeck().map((c) => c.id);
  return decks.map((deck) => {
    const ids = deck.map((c) => (typeof c === "string" ? c : (c as Card)?.id));
    if (!ids.every((id) => typeof id === "string" && parseCardId(id)) || new Set(ids).size !== ids.length) {
      throw new Error('A test deck lists each card at most once, by id (e.g. "hearts-A", "spades-10").');
    }
    return [...ids, ...all.filter((id) => !ids.includes(id))] as string[];
  });
}

function parseSettings(input: unknown): HoldemSettings | null {
  if (input === undefined || input === null) return { ...DEFAULT_SETTINGS };
  if (typeof input !== "object" || Array.isArray(input)) return null;
  const s = { ...DEFAULT_SETTINGS, ...(input as Partial<HoldemSettings>) };
  const ok =
    (STARTING_CHIPS_OPTIONS as readonly unknown[]).includes(s.startingChips) &&
    (HANDS_PER_LEVEL_OPTIONS as readonly unknown[]).includes(s.handsPerLevel) &&
    (ENDING_OPTIONS as readonly unknown[]).includes(s.ending) &&
    (REBUY_OPTIONS as readonly unknown[]).includes(s.rebuys) &&
    (TURN_SECONDS_OPTIONS as readonly unknown[]).includes(s.turnSeconds);
  return ok
    ? { startingChips: s.startingChips, handsPerLevel: s.handsPerLevel, ending: s.ending, rebuys: s.rebuys, turnSeconds: s.turnSeconds }
    : null;
}

function parseAction(input: unknown): HoldemAction | null {
  if (typeof input !== "object" || input === null) return null;
  const a = input as Record<string, unknown>;
  switch (a.type) {
    case "fold":
    case "check":
    case "call":
    case "all-in":
    case "show":
    case "back":
    case "rebuy":
      return { type: a.type };
    case "raise":
      return Number.isSafeInteger(a.to) && (a.to as number) > 0 ? { type: "raise", to: a.to as number } : null;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Definition
// ---------------------------------------------------------------------------

function newPlayer(id: string, stack: number): Player {
  return {
    id,
    stack,
    hole: [],
    inHand: false,
    folded: false,
    allIn: false,
    bet: 0,
    contributed: 0,
    acted: false,
    shown: false,
    startStack: stack,
    timeouts: 0,
    sittingOut: false,
    away: false,
    removed: false,
    pendingRebuy: false,
    out: false,
    bustedHand: null,
    bustStack: 0,
    rebuysUsed: 0,
  };
}

const noop = (state: State) => ({ state, events: [] });

export const holdemGame: GameDefinition<
  HoldemServerState,
  HoldemAction,
  HoldemPublicState,
  HoldemPrivateState,
  HoldemSettings,
  HoldemEvent
> = {
  manifest: holdemManifest,
  defaultSettings: DEFAULT_SETTINGS,
  parseSettings,
  parseAction,

  createGame(players, settings, match, ctx, options?: CreateGameOptions) {
    const n = players.length;
    const { minPlayers, maxPlayers } = holdemManifest;
    if (n < minPlayers || n > maxPlayers) throw new Error(`holdem: needs ${minPlayers}–${maxPlayers} players, got ${n}`);
    const state: State = {
      phase: "playing",
      step: "preflop",
      settings,
      players: players.map((p) => newPlayer(p.id, settings.startingChips)),
      startedAt: ctx.now,
      handNumber: 0,
      buttonIndex: ((match.dealerSeat % n) + n) % n,
      sbIndex: 0,
      bbIndex: 0,
      turnIndex: -1,
      deadline: 0,
      board: [],
      deck: [],
      currentBet: 0,
      minRaise: 0,
      runout: false,
      lastHand: null,
      stepEndsAt: 0,
      testDecks: options?.deck ? normalizeDecks(options.deck) : null,
      winnerIds: [],
      endReason: null,
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
      case "show": {
        const lh = prev.lastHand;
        const allowed =
          me.inHand && !me.shown && me.hole.length > 0 &&
          ((prev.step === "showdown" && !me.folded) || (prev.step === "awarded" && !!lh?.byFold && lh.won[playerId] !== undefined));
        if (!allowed) return reject("cant-show", "Nothing to show right now.");
        const state = clone(prev);
        const p = state.players[seat]!;
        p.shown = true;
        const summary = state.lastHand!;
        summary.shown[playerId] = p.hole;
        if (state.board.length >= 3) summary.labels[playerId] = bestHand([...p.hole, ...state.board]).label;
        return { ok: true, transition: { state, events: [pub({ type: "reveal", hands: { [playerId]: p.hole } })] } };
      }
      case "back": {
        if (!me.sittingOut) return reject("not-sitting-out", "You're already in.");
        const state = clone(prev);
        const p = state.players[seat]!;
        p.sittingOut = false;
        p.timeouts = 0;
        return { ok: true, transition: { state, events: [pub({ type: "back", playerId })] } };
      }
      case "rebuy": {
        if (prev.step !== "between-hands" || !me.pendingRebuy) return reject("no-rebuy", "No rebuy for you right now.");
        const state = clone(prev);
        const out = newOut([pub({ type: "rebuy", playerId, chips: state.settings.startingChips })]);
        const p = state.players[seat]!;
        p.stack = state.settings.startingChips;
        p.pendingRebuy = false;
        p.bustedHand = null;
        p.rebuysUsed++;
        if (!pending(state).length) setStep(state, ctx, Math.max(0, Math.min(state.stepEndsAt - ctx.now, REBUY_DONE_MS)), out);
        return { ok: true, transition: done(state, out) };
      }
      default: {
        if (!betting(prev) || prev.turnIndex !== seat) return reject("not-your-turn", "It's not your turn.");
        const state = clone(prev);
        const out = newOut();
        const error = applyBet(state, seat, action, out);
        if (error) return reject("illegal-bet", error);
        state.players[seat]!.timeouts = 0;
        state.turnIndex = nextActor(state, seat);
        proceed(state, ctx, out);
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
    if (timerId !== STEP_TIMER) return noop(prev);
    const state = clone(prev);
    const out = newOut();
    if (state.runout && isStreet(state.step)) {
      if (state.board.length < 5) {
        dealStreet(state, out);
        setStep(state, ctx, RUNOUT_MS, out);
      } else showdown(state, ctx, out);
    } else if (state.step === "showdown" || state.step === "awarded") endHand(state, ctx, out);
    else if (state.step === "between-hands") nextHand(state, ctx, out);
    else return noop(prev);
    return done(state, out);
  },

  /** The host's Skip does what the clock would. */
  skipTurn(prev, playerId, ctx) {
    if (!betting(prev) || prev.players[prev.turnIndex]!.id !== playerId) return noop(prev);
    const state = clone(prev);
    const out = newOut();
    timeout(state, ctx, "skip", out);
    return done(state, out);
  },

  /** Dropped players sit out until they're back; the table never waits on them. */
  onPlayerDisconnected(prev, playerId, ctx) {
    const idx = prev.players.findIndex((p) => p.id === playerId);
    if (prev.phase !== "playing" || idx < 0 || prev.players[idx]!.away) return noop(prev);
    const state = clone(prev);
    const out = newOut();
    state.players[idx]!.away = true;
    if (betting(state) && state.turnIndex === idx) proceed(state, ctx, out);
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

  /**
   * Mid-hand, a leaver's cards fold. What they've bet stays in the pot; the
   * rest of their stack leaves with them.
   */
  onPlayerRemoved(prev, playerId, ctx) {
    const idx = prev.players.findIndex((p) => p.id === playerId);
    if (prev.phase !== "playing" || idx < 0 || prev.players[idx]!.removed) return noop(prev);
    const state = clone(prev);
    const out = newOut([pub({ type: "player-removed", playerId })]);
    const p = state.players[idx]!;
    const wasTurn = betting(state) && state.turnIndex === idx;
    const handOn = isStreet(state.step);
    p.removed = true;
    p.pendingRebuy = false;
    p.stack = 0;
    if (handOn && p.inHand) p.folded = true;

    if (handOn) {
      if (liveCount(state) <= 1) winByFold(state, ctx, out);
      else if (wasTurn) {
        state.turnIndex = nextActor(state, idx);
        proceed(state, ctx, out);
      } else if (betting(state) && roundOver(state)) proceed(state, ctx, out);
    } else if (state.step === "between-hands" && alive(state).length <= 1 && !pending(state).length) {
      finish(state, "last-standing", out);
    }
    if (state.phase === "playing" && state.players.filter((x) => !x.removed).length <= 1) finish(state, "abandoned", out);
    return done(state, out);
  },

  getPublicState(state) {
    const playing = state.phase === "playing";
    const hpl = state.settings.handsPerLevel;
    const level = levelIndexFor(state.handNumber, hpl);
    const { sb, bb } = blindsFor(level);
    const dealt = state.players.filter((p) => p.inHand);
    const collected = Object.fromEntries(dealt.map((p) => [p.id, p.contributed - p.bet]));
    const pots = isStreet(state.step) ? buildPots(collected, dealt.filter((p) => p.folded).map((p) => p.id)).filter((x) => !x.uncalled) : [];
    const current = playing && betting(state) ? state.players[state.turnIndex]! : null;
    const seatId = (i: number) => (state.handNumber ? (state.players[i]?.id ?? null) : null);
    return {
      step: playing ? state.step : "over",
      handNumber: state.handNumber,
      level: level + 1,
      sb,
      bb,
      next: blindsFor(level + 1),
      handsToNextLevel: hpl - ((state.handNumber - 1) % hpl),
      startingChips: state.settings.startingChips,
      players: state.players.map((p) => ({
        id: p.id,
        stack: p.stack,
        bet: p.bet,
        inHand: p.inHand,
        folded: p.folded,
        allIn: p.allIn,
        sittingOut: p.sittingOut,
        away: p.away,
        removed: p.removed,
        out: p.out,
        pendingRebuy: p.pendingRebuy,
        cards: p.shown && p.inHand ? p.hole : null,
      })),
      buttonId: seatId(state.buttonIndex),
      sbId: seatId(state.sbIndex),
      bbId: seatId(state.bbIndex),
      board: state.board,
      pot: isStreet(state.step) ? dealt.reduce((sum, p) => sum + p.contributed, 0) : 0,
      pots: pots.length > 1 ? pots : [],
      currentBet: state.currentBet,
      currentPlayerId: current?.id ?? null,
      turn: current ? { endsAt: state.deadline, ms: state.settings.turnSeconds * 1000 } : null,
      runout: state.runout,
      stepEndsAt: state.stepEndsAt,
      lastHand: state.lastHand,
      capEndsAt: capEndsAt(state),
      winnerIds: state.winnerIds,
      endReason: state.endReason,
    };
  },

  getPrivateState(state, playerId) {
    const p = state.players.find((x) => x.id === playerId);
    if (!p) return { hole: [], best: null, legal: null, canShow: false, canBack: false, canRebuy: false };
    const playing = state.phase === "playing" && !p.removed;
    const best = p.inHand && p.hole.length && state.board.length >= 3 ? bestHand([...p.hole, ...state.board]) : null;
    const lh = state.lastHand;
    const canShow =
      playing && p.inHand && !p.shown && p.hole.length > 0 &&
      ((state.step === "showdown" && !p.folded) || (state.step === "awarded" && !!lh?.byFold && lh.won[p.id] !== undefined));
    return {
      hole: p.inHand ? p.hole : [],
      best: best && { label: best.label, cards: best.cards },
      legal: playing && betting(state) && state.players[state.turnIndex] === p ? legalFor(state, p) : null,
      canShow,
      canBack: playing && p.sittingOut,
      canRebuy: playing && state.step === "between-hands" && p.pendingRebuy,
    };
  },

  getAwaitedPlayerIds(state) {
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
};
