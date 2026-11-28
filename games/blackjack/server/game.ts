import {
  bumpStat,
  formatChips,
  shuffle,
  type CreateGameOptions,
  type GameContext,
  type GameDefinition,
  type GameEventEnvelope,
  type GameOutcome,
  type GameResult,
  type TimerRequest,
} from "@games/game-core";
import { blackjackManifest } from "../shared/manifest.ts";
import {
  dealerDraws,
  dealerPeeks,
  handResult,
  handTotal,
  isBlackjack,
  isPair,
  makeShoe,
  parseCardId,
  payout,
  rebuyRounds,
} from "../shared/rules.ts";
import {
  DEFAULT_SETTINGS,
  MIN_BET,
  REBUY_OPTIONS,
  RESHUFFLE_AT,
  ROUNDS_OPTIONS,
  SHOE_CARDS,
  STARTING_CHIPS,
  TURN_SECONDS_OPTIONS,
  type AutoReason,
  type BlackjackAction,
  type BlackjackEvent,
  type BlackjackPlayerState,
  type BlackjackPrivateState,
  type BlackjackPublicState,
  type BlackjackServerState,
  type BlackjackSettings,
  type Card,
  type EndReason,
  type Hand,
  type LegalMoves,
  type MoveKind,
  type RoundResult,
} from "../shared/types.ts";
import { blackjackBot } from "./bot.ts";

type State = BlackjackServerState;
type Player = BlackjackPlayerState;
type Events = GameEventEnvelope<BlackjackEvent>[];

const pub = (event: BlackjackEvent): GameEventEnvelope<BlackjackEvent> => ({ visibility: { kind: "public" }, event });
const reject = (code: string, message: string): GameResult<State, BlackjackEvent> => ({ ok: false, error: { code, message } });

/** The bet clock and the play clock. */
export const TURN_TIMER = "turn";
/** Every pause that isn't a decision: dealer cards, the pay. */
export const STEP_TIMER = "step";

/** A beat per dealer card, the face-down one included. */
export const DEALER_MS = 900;
/** After the pay, before the next round's betting. */
export const SETTLE_MS = 4000;
/** Nobody bet: a short beat, then the next round. */
export const NO_BETS_MS = 2000;

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
const noop = (state: State) => ({ state, events: [] });

const card = (id: string): Card => parseCardId(id)!;

/** Has chips and can bet this round. */
const canBet = (p: Player) => !p.removed && !p.out && !p.pendingRebuy && p.stack > 0;
/** Still in the game: has chips, chips on the table, or may still rebuy. */
const inGame = (p: Player) => !p.removed && !p.out && (p.stack > 0 || p.bet !== null || p.pendingRebuy);

/** The table waits on this seat's bet (or its rebuy choice). */
function waitsOnBet(p: Player): boolean {
  if (p.away || p.removed) return false;
  if (p.pendingRebuy) return true;
  return canBet(p) && p.bet === null && !p.sitOut && p.missed < 2;
}

/** Missed 2 bets in a row, so the table doesn't wait on this seat's bet. */
const canBack = (p: Player) => !p.removed && !p.out && p.missed >= 2;

const activeHand = (p: Player): number => (p.removed ? -1 : p.hands.findIndex((h) => !h.done));
const playing = (p: Player) => activeHand(p) >= 0;

function shuffledShoe(ctx: GameContext): string[] {
  return shuffle(makeShoe(), ctx.randomInt);
}

/** The next card. A shoe that runs dry mid-round is replaced, so a round always finishes. */
function draw(s: State, ctx: GameContext): Card {
  if (!s.shoe.length) {
    s.shoe = shuffledShoe(ctx);
    s.shuffledRound = s.round;
  }
  return card(s.shoe.shift()!);
}

function setStep(s: State, ctx: GameContext, delayMs: number, out: Out): void {
  s.stepEndsAt = ctx.now + delayMs;
  out.timers.push({ kind: "set", timerId: STEP_TIMER, delayMs });
}

function startClock(s: State, ctx: GameContext, out: Out): void {
  const ms = s.settings.turnSeconds * 1000;
  s.deadline = ctx.now + ms;
  out.timers.push({ kind: "set", timerId: TURN_TIMER, delayMs: ms });
}

function stopClock(s: State, out: Out): void {
  s.deadline = 0;
  out.timers.push({ kind: "cancel", timerId: TURN_TIMER });
}

function newHand(cards: Card[], bet: number, split: boolean): Hand {
  return { cards, bet, doubled: false, split, done: false, result: null, paid: 0 };
}

/** A hand that can't take more: over 21, or exactly 21. */
function checkHand(s: State, p: Player, index: number, out: Out): void {
  const hand = p.hands[index]!;
  const { total } = handTotal(hand.cards);
  if (total > 21) {
    hand.done = true;
    bumpStat((s.stats ??= {}), p.id, "busts");
    out.events.push(pub({ type: "bust", playerId: p.id, hand: index, total }));
  } else if (total === 21) hand.done = true;
}

// ---- rounds ---------------------------------------------------------------

function startRound(s: State, ctx: GameContext, out: Out): void {
  s.round++;
  const shuffled = s.shoe.length < RESHUFFLE_AT;
  if (shuffled) {
    s.shoe = shuffledShoe(ctx);
    s.shuffledRound = s.round;
  }
  for (const p of s.players) {
    p.bet = null;
    p.hands = [];
    p.sitOut = false;
  }
  s.dealer = { cards: [], hidden: true };
  s.step = "betting";
  s.stepEndsAt = 0;
  out.events.push(pub({ type: "round-start", round: s.round, shuffled }));
  startClock(s, ctx, out);
}

/** Everyone the table waits on has bet: no need to wait out the clock. */
function maybeCloseBetting(s: State, ctx: GameContext, out: Out): void {
  if (s.step !== "betting" || s.phase !== "playing") return;
  if (s.players.some(waitsOnBet)) return;
  // With no bet at all (everyone away or sitting out), the clock runs on: a
  // table nobody's watching shouldn't race through its rounds.
  if (!s.players.some((p) => p.bet !== null)) return;
  closeBetting(s, ctx, out);
}

function closeBetting(s: State, ctx: GameContext, out: Out): void {
  stopClock(s, out);
  for (const p of s.players) {
    if (p.pendingRebuy) {
      p.pendingRebuy = false;
      p.out = true;
      p.outRound = s.round - 1;
      out.events.push(pub({ type: "stay-out", playerId: p.id }));
    } else if (canBet(p) && p.bet === null && !p.sitOut) {
      p.sitOut = true;
      p.missed++;
      out.events.push(pub({ type: "sit-out", playerId: p.id, auto: p.away ? "away" : "timer" }));
    }
  }
  const bettors = s.players.filter((p) => p.bet !== null && !p.removed);
  if (!bettors.length) {
    if (!s.players.some(inGame)) return finish(s, "everyone-out", out);
    s.step = "settle";
    out.events.push(pub({ type: "settled", results: [], dealerTotal: 0, dealerBust: false }));
    setStep(s, ctx, NO_BETS_MS, out);
    return;
  }
  deal(s, ctx, bettors, out);
}

function deal(s: State, ctx: GameContext, bettors: Player[], out: Out): void {
  const first = bettors.map(() => draw(s, ctx));
  const up = draw(s, ctx);
  const second = bettors.map(() => draw(s, ctx));
  const hole = draw(s, ctx);
  bettors.forEach((p, i) => {
    const hand = newHand([first[i]!, second[i]!], p.bet!, false);
    hand.done = isBlackjack(hand.cards);
    p.hands = [hand];
  });
  s.dealer = { cards: [up, hole], hidden: true };
  out.events.push(pub({ type: "deal", playerIds: bettors.map((p) => p.id), dealerUp: up }));

  if (dealerPeeks(up)) {
    const blackjack = isBlackjack(s.dealer.cards);
    out.events.push(pub({ type: "peek", blackjack }));
    if (blackjack) {
      for (const p of bettors) for (const h of p.hands) h.done = true;
      revealHole(s, out);
      return settle(s, ctx, out);
    }
  }
  s.step = "play";
  startClock(s, ctx, out);
  // Nobody's waited on who isn't there.
  for (const p of s.players) if (p.away) standAll(p, "away", out);
  maybeEndPlay(s, ctx, out);
}

function standAll(p: Player, auto: AutoReason, out: Out): void {
  for (let i = activeHand(p); i >= 0; i = activeHand(p)) {
    p.hands[i]!.done = true;
    out.events.push(pub({ type: "move", playerId: p.id, hand: i, kind: "stand", auto }));
  }
}

/** Every hand is done: the dealer's turn. */
function maybeEndPlay(s: State, ctx: GameContext, out: Out): void {
  if (s.step !== "play" || s.players.some(playing)) return;
  stopClock(s, out);
  s.step = "dealer";
  revealHole(s, out);
  setStep(s, ctx, DEALER_MS, out);
}

function revealHole(s: State, out: Out): void {
  if (!s.dealer.hidden) return;
  s.dealer.hidden = false;
  out.events.push(pub({ type: "dealer-reveal", card: s.dealer.cards[1]! }));
}

/** The dealer only plays out the hand when some hand still needs beating. */
function dealerNeedsCards(s: State): boolean {
  const live = s.players.some(
    (p) => !p.removed && p.hands.some((h) => handTotal(h.cards).total <= 21 && !isBlackjack(h.cards, h.split)),
  );
  return live && dealerDraws(s.dealer.cards);
}

function settle(s: State, ctx: GameContext, out: Out): void {
  const results: RoundResult[] = [];
  for (const p of s.players) {
    if (p.removed) continue;
    p.hands.forEach((h, i) => {
      h.result = handResult(h, s.dealer.cards);
      h.paid = payout(h.result, h.bet);
      p.stack += h.paid;
      results.push({ playerId: p.id, hand: i, result: h.result, bet: h.bet, paid: h.paid });
    });
  }
  const { total } = handTotal(s.dealer.cards);
  s.step = "settle";
  out.events.push(pub({ type: "settled", results, dealerTotal: total, dealerBust: total > 21 }));
  setStep(s, ctx, SETTLE_MS, out);
}

/** After the pay's pause: who ran out, then the next round or the end. */
function endRound(s: State, ctx: GameContext, out: Out): void {
  const last = s.round >= s.settings.rounds;
  const rebuyOpen = !last && s.settings.rebuys === "one" && s.round <= rebuyRounds(s.settings.rounds);
  const broke = s.players.filter((p) => !p.removed && !p.out && !p.pendingRebuy && p.stack === 0);
  const rebuy: string[] = [];
  for (const p of broke) {
    if (rebuyOpen && p.rebuysUsed === 0) {
      p.pendingRebuy = true;
      rebuy.push(p.id);
    } else {
      p.out = true;
      p.outRound = s.round;
    }
  }
  if (broke.length) out.events.push(pub({ type: "busted", playerIds: broke.map((p) => p.id), rebuy }));
  if (last) return finish(s, "rounds", out);
  if (!s.players.some(inGame)) return finish(s, "everyone-out", out);
  startRound(s, ctx, out);
}

function finish(s: State, reason: EndReason, out: Out): void {
  s.phase = "over";
  s.deadline = 0;
  for (const p of s.players) {
    if (p.pendingRebuy) {
      p.pendingRebuy = false;
      p.out = true;
      p.outRound = s.round;
    }
  }
  const standing = s.players.filter((p) => !p.removed && p.stack > 0);
  const top = Math.max(0, ...standing.map((p) => p.stack));
  s.winnerIds = standing.filter((p) => p.stack === top).map((p) => p.id);
  s.endReason = reason;
  out.timers.push({ kind: "cancel", timerId: TURN_TIMER }, { kind: "cancel", timerId: STEP_TIMER });
  out.events.push(pub({ type: "game-over", winnerIds: s.winnerIds, reason }));
}

/** Someone left, stayed out or was skipped: whatever waited on them may be over now. */
function afterLeave(s: State, ctx: GameContext, out: Out): void {
  if (s.phase !== "playing") return;
  if (!s.players.some((p) => !p.removed)) return finish(s, "abandoned", out);
  if (s.step === "betting") {
    maybeCloseBetting(s, ctx, out);
    if (s.phase === "playing" && s.step === "betting" && !s.players.some(inGame)) finish(s, "everyone-out", out);
  } else if (s.step === "play") maybeEndPlay(s, ctx, out);
}

// ---- moves ------------------------------------------------------------------

function legalMoves(s: State, p: Player): LegalMoves | null {
  if (s.phase !== "playing" || s.step !== "play") return null;
  const i = activeHand(p);
  if (i < 0) return null;
  const hand = p.hands[i]!;
  const two = hand.cards.length === 2;
  return {
    hand: i,
    cards: p.hands.reduce((n, h) => n + h.cards.length, 0),
    hit: true,
    stand: true,
    double: two && p.stack >= hand.bet,
    split: two && p.hands.length === 1 && isPair(hand.cards) && p.stack >= hand.bet,
  };
}

/**
 * Null on success, or why not. `cards` is the hand's size as the player saw
 * it: a second tap sent before the first one's card showed is refused.
 */
function applyMove(s: State, ctx: GameContext, p: Player, kind: MoveKind, index: number, cards: number, out: Out): string | null {
  const legal = legalMoves(s, p);
  if (!legal || legal.hand !== index) return "That hand is done.";
  if (legal.cards !== cards) return "Your cards changed. Look again.";
  const hand = p.hands[index]!;
  switch (kind) {
    case "hit":
      hand.cards.push(draw(s, ctx));
      out.events.push(pub({ type: "move", playerId: p.id, hand: index, kind }));
      checkHand(s, p, index, out);
      return null;
    case "stand":
      hand.done = true;
      out.events.push(pub({ type: "move", playerId: p.id, hand: index, kind }));
      return null;
    case "double":
      if (!legal.double) return hand.cards.length === 2 ? "You need more chips to double." : "You can only double on your first 2 cards.";
      p.stack -= hand.bet;
      hand.bet *= 2;
      hand.doubled = true;
      hand.cards.push(draw(s, ctx));
      hand.done = true;
      out.events.push(pub({ type: "move", playerId: p.id, hand: index, kind }));
      checkHand(s, p, index, out);
      return null;
    case "split": {
      if (!legal.split) {
        if (p.hands.length > 1) return "You can split only once a round.";
        return isPair(hand.cards) ? "You need more chips to split." : "You can split only 2 cards of the same rank.";
      }
      p.stack -= hand.bet;
      const [a, b] = hand.cards as [Card, Card];
      p.hands = [newHand([a, draw(s, ctx)], hand.bet, true), newHand([b, draw(s, ctx)], hand.bet, true)];
      out.events.push(pub({ type: "move", playerId: p.id, hand: index, kind }));
      // Split Aces get one card each, and that's all.
      if (a.rank === 1) for (const h of p.hands) h.done = true;
      p.hands.forEach((_, i) => checkHand(s, p, i, out));
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function parseSettings(input: unknown): BlackjackSettings | null {
  if (input === undefined || input === null) return { ...DEFAULT_SETTINGS };
  if (typeof input !== "object" || Array.isArray(input)) return null;
  const s = { ...DEFAULT_SETTINGS, ...(input as Partial<BlackjackSettings>) };
  const ok =
    (ROUNDS_OPTIONS as readonly unknown[]).includes(s.rounds) &&
    (REBUY_OPTIONS as readonly unknown[]).includes(s.rebuys) &&
    (TURN_SECONDS_OPTIONS as readonly unknown[]).includes(s.turnSeconds);
  return ok ? { rounds: s.rounds, rebuys: s.rebuys, turnSeconds: s.turnSeconds } : null;
}

function parseAction(input: unknown): BlackjackAction | null {
  if (typeof input !== "object" || input === null) return null;
  const a = input as Record<string, unknown>;
  switch (a.type) {
    case "bet":
      return Number.isSafeInteger(a.amount) && (a.amount as number) > 0 ? { type: "bet", amount: a.amount as number } : null;
    case "hit":
    case "stand":
    case "double":
    case "split": {
      const hand = a.hand as number;
      const cards = a.cards as number;
      const ok = Number.isInteger(hand) && hand >= 0 && hand < 2 && Number.isInteger(cards) && cards >= 2 && cards <= 42;
      return ok ? { type: a.type, hand, cards } : null;
    }
    case "rebuy":
    case "stay-out":
    case "back":
      return { type: a.type };
    default:
      return null;
  }
}

/**
 * Test cards, by id ("hearts-A", "spades-10"), drawn before the shuffled shoe,
 * in draw order. Each round deals one card to every bettor in seat order, then
 * the dealer's face-up card, then the second round of cards, then the dealer's
 * face-down card. Hits, doubles and splits draw next, in the order they happen.
 */
function testCards(input: unknown[]): string[] {
  const ids = input.map((c) => (typeof c === "string" ? c : (c as Card)?.id));
  if (!ids.every((id) => typeof id === "string" && parseCardId(id))) {
    throw new Error('A test deck lists cards by id (e.g. "hearts-A", "spades-10").');
  }
  return ids as string[];
}

function newPlayer(id: string): Player {
  return {
    id,
    stack: STARTING_CHIPS,
    bet: null,
    hands: [],
    sitOut: false,
    missed: 0,
    away: false,
    removed: false,
    pendingRebuy: false,
    rebuysUsed: 0,
    out: false,
    outRound: null,
  };
}

const shift = (t: number, by: number) => (t > 0 ? t + by : t);

// ---------------------------------------------------------------------------
// Definition
// ---------------------------------------------------------------------------

export const blackjackGame: GameDefinition<
  BlackjackServerState,
  BlackjackAction,
  BlackjackPublicState,
  BlackjackPrivateState,
  BlackjackSettings,
  BlackjackEvent
> = {
  manifest: blackjackManifest,
  defaultSettings: DEFAULT_SETTINGS,
  bot: blackjackBot,
  parseSettings,
  parseAction,

  createGame(players, settings, _match, ctx, options?: CreateGameOptions) {
    const n = players.length;
    const { minPlayers, maxPlayers } = blackjackManifest;
    if (n < minPlayers || n > maxPlayers) throw new Error(`blackjack: needs ${minPlayers}–${maxPlayers} players, got ${n}`);
    const state: State = {
      phase: "playing",
      step: "betting",
      settings,
      players: players.map((p) => newPlayer(p.id)),
      round: 0,
      dealer: { cards: [], hidden: true },
      shoe: [...(options?.deck ? testCards(options.deck) : []), ...shuffledShoe(ctx)],
      shuffledRound: 0,
      deadline: 0,
      stepEndsAt: 0,
      pausedAt: null,
      winnerIds: [],
      endReason: null,
      stats: {},
    };
    const out = newOut();
    startRound(state, ctx, out);
    return done(state, out);
  },

  handleAction(prev, playerId, action, ctx) {
    if (prev.phase !== "playing") return reject("game-finished", "The game is over.");
    const seat = prev.players.findIndex((p) => p.id === playerId);
    const me = prev.players[seat];
    if (!me || me.removed) return reject("not-in-game", "You're not in this game.");

    switch (action.type) {
      case "bet": {
        if (prev.step !== "betting") return reject("not-betting", "Bets are closed.");
        if (!canBet(me)) return reject("cant-bet", me.pendingRebuy ? "Rebuy first." : "You have no chips.");
        if (me.bet !== null) return reject("already-bet", "You already bet.");
        if (me.sitOut) return reject("sitting-out", "You sit out this round.");
        const min = Math.min(MIN_BET, me.stack);
        if (action.amount < min || action.amount > me.stack) {
          return reject("bad-bet", `Bet from ${formatChips(min)} to ${formatChips(me.stack)}.`);
        }
        const state = clone(prev);
        const p = state.players[seat]!;
        p.stack -= action.amount;
        p.bet = action.amount;
        p.sitOut = false;
        p.missed = 0;
        const out = newOut([pub({ type: "bet", playerId, amount: action.amount })]);
        maybeCloseBetting(state, ctx, out);
        return { ok: true, transition: done(state, out) };
      }
      case "rebuy":
      case "stay-out": {
        if (prev.step !== "betting" || !me.pendingRebuy) return reject("no-rebuy", "You can't rebuy right now.");
        const state = clone(prev);
        const p = state.players[seat]!;
        p.pendingRebuy = false;
        const out = newOut();
        if (action.type === "rebuy") {
          p.stack = STARTING_CHIPS;
          p.rebuysUsed++;
          p.missed = 0;
          out.events.push(pub({ type: "rebuy", playerId, chips: STARTING_CHIPS }));
        } else {
          p.out = true;
          p.outRound = state.round - 1;
          out.events.push(pub({ type: "stay-out", playerId }));
        }
        afterLeave(state, ctx, out);
        return { ok: true, transition: done(state, out) };
      }
      case "back": {
        if (!canBack(me)) return reject("not-sitting-out", "You are already playing.");
        const state = clone(prev);
        state.players[seat]!.missed = 0;
        return { ok: true, transition: { state, events: [pub({ type: "back", playerId })] } };
      }
      default: {
        if (prev.step !== "play") return reject("not-playing", "Wait for the cards.");
        const state = clone(prev);
        const out = newOut();
        const error = applyMove(state, ctx, state.players[seat]!, action.type, action.hand, action.cards, out);
        if (error) return reject("illegal-move", error);
        maybeEndPlay(state, ctx, out);
        return { ok: true, transition: done(state, out) };
      }
    }
  },

  onTimer(prev, timerId, ctx) {
    if (prev.phase !== "playing") return noop(prev);
    const state = clone(prev);
    const out = newOut();
    if (timerId === TURN_TIMER && state.step === "betting") closeBetting(state, ctx, out);
    else if (timerId === TURN_TIMER && state.step === "play") {
      for (const p of state.players) standAll(p, "timer", out);
      maybeEndPlay(state, ctx, out);
    } else if (timerId === STEP_TIMER && state.step === "dealer") {
      if (dealerNeedsCards(state)) {
        const c = draw(state, ctx);
        state.dealer.cards.push(c);
        out.events.push(pub({ type: "dealer-draw", card: c }));
        setStep(state, ctx, DEALER_MS, out);
      } else settle(state, ctx, out);
    } else if (timerId === STEP_TIMER && state.step === "settle") endRound(state, ctx, out);
    else return noop(prev);
    return done(state, out);
  },

  /** The host's Skip: a bet not made sits the round out, hands not played stand. */
  skipTurn(prev, playerId, ctx) {
    const idx = prev.players.findIndex((p) => p.id === playerId);
    const me = prev.players[idx];
    if (prev.phase !== "playing" || !me) return noop(prev);
    const state = clone(prev);
    const p = state.players[idx]!;
    const out = newOut();
    if (state.step === "betting" && waitsOnBet(p)) {
      if (p.pendingRebuy) {
        p.pendingRebuy = false;
        p.out = true;
        p.outRound = state.round - 1;
        out.events.push(pub({ type: "stay-out", playerId }));
      } else {
        p.sitOut = true;
        p.missed++;
        out.events.push(pub({ type: "sit-out", playerId, auto: "skip" }));
      }
      afterLeave(state, ctx, out);
    } else if (state.step === "play" && playing(p)) {
      standAll(p, "skip", out);
      maybeEndPlay(state, ctx, out);
    } else return noop(prev);
    return done(state, out);
  },

  /** A dropped player isn't waited on: no bet sits the round out, open hands stand. */
  onPlayerDisconnected(prev, playerId, ctx) {
    const idx = prev.players.findIndex((p) => p.id === playerId);
    if (prev.phase !== "playing" || idx < 0 || prev.players[idx]!.away) return noop(prev);
    const state = clone(prev);
    const out = newOut();
    const p = state.players[idx]!;
    p.away = true;
    if (state.step === "play") standAll(p, "away", out);
    afterLeave(state, ctx, out);
    return done(state, out);
  },

  onPlayerReconnected(prev, playerId) {
    const idx = prev.players.findIndex((p) => p.id === playerId);
    if (idx < 0 || !prev.players[idx]!.away) return noop(prev);
    const state = clone(prev);
    state.players[idx]!.away = false;
    state.players[idx]!.missed = 0;
    return { state, events: [] };
  },

  /** A leaver's chips go with them, bets on the table included. */
  onPlayerRemoved(prev, playerId, ctx) {
    const idx = prev.players.findIndex((p) => p.id === playerId);
    if (prev.phase !== "playing" || idx < 0 || prev.players[idx]!.removed) return noop(prev);
    const state = clone(prev);
    const out = newOut([pub({ type: "player-removed", playerId })]);
    const p = state.players[idx]!;
    p.removed = true;
    p.pendingRebuy = false;
    p.stack = 0;
    afterLeave(state, ctx, out);
    return done(state, out);
  },

  pause(prev, paused, ctx) {
    if (paused) return { state: { ...prev, pausedAt: ctx.now }, events: [] };
    const at = prev.pausedAt;
    if (at === null || at === undefined) return { state: prev, events: [] };
    // The room holds the timers and sets them again by their time left.
    const by = ctx.now - at;
    return { state: { ...prev, deadline: shift(prev.deadline, by), stepEndsAt: shift(prev.stepEndsAt, by), pausedAt: null }, events: [] };
  },

  getPublicState(state) {
    const live = state.phase === "playing";
    const dealer = state.dealer;
    const shown = dealer.hidden ? dealer.cards.slice(0, 1) : dealer.cards;
    const dealerTotal = shown.length ? handTotal(shown) : null;
    const clockOn = live && (state.step === "betting" || state.step === "play") && state.deadline > 0;
    return {
      step: live ? state.step : "over",
      round: state.round,
      rounds: state.settings.rounds,
      minBet: MIN_BET,
      startingChips: STARTING_CHIPS,
      players: state.players.map((p) => ({
        id: p.id,
        stack: p.stack,
        bet: p.bet,
        hands: p.hands.map((h) => {
          const t = handTotal(h.cards);
          return {
            cards: h.cards,
            bet: h.bet,
            doubled: h.doubled,
            split: h.split,
            done: h.done,
            total: t.total,
            soft: t.soft,
            blackjack: isBlackjack(h.cards, h.split),
            result: h.result,
            paid: h.paid,
          };
        }),
        active: live && state.step === "play" ? activeHand(p) : -1,
        sittingOut: p.missed >= 2,
        away: p.away,
        removed: p.removed,
        pendingRebuy: p.pendingRebuy,
        out: p.out,
      })),
      dealer: {
        cards: dealer.hidden ? [...shown, ...dealer.cards.slice(1).map(() => null)] : dealer.cards,
        total: dealerTotal?.total ?? null,
        soft: dealerTotal?.soft ?? false,
        blackjack: !dealer.hidden && isBlackjack(dealer.cards),
      },
      shoeLeft: state.shoe.length,
      shoeSize: SHOE_CARDS,
      shuffled: state.shuffledRound === state.round,
      clock: clockOn ? { endsAt: state.deadline, ms: state.settings.turnSeconds * 1000 } : null,
      stepEndsAt: state.stepEndsAt,
      pausedAt: state.pausedAt ?? null,
      winnerIds: state.winnerIds,
      endReason: state.endReason,
    };
  },

  getPrivateState(state, playerId) {
    const p = state.players.find((x) => x.id === playerId);
    const none: BlackjackPrivateState = { bet: null, canRebuy: false, canBack: false, moves: null };
    if (!p || p.removed || state.phase !== "playing") return none;
    const betting = state.step === "betting";
    return {
      bet: betting && canBet(p) && p.bet === null && !p.sitOut ? { min: Math.min(MIN_BET, p.stack), max: p.stack } : null,
      canRebuy: betting && p.pendingRebuy,
      canBack: canBack(p),
      moves: legalMoves(state, p),
    };
  },

  getAwaitedPlayerIds(state) {
    if (state.phase !== "playing") return [];
    if (state.step === "betting") return state.players.filter(waitsOnBet).map((p) => p.id);
    if (state.step === "play") return state.players.filter((p) => !p.away && playing(p)).map((p) => p.id);
    return [];
  },

  getResult(state): GameOutcome | null {
    if (state.phase !== "over") return null;
    const ranked = state.players.filter((p) => !p.removed).sort((a, b) => b.stack - a.stack || (b.outRound ?? 1e9) - (a.outRound ?? 1e9));
    const left = state.players.filter((p) => p.removed);
    return {
      winnerIds: state.winnerIds,
      ...(state.winnerIds.length
        ? {}
        : { headline: state.endReason === "abandoned" ? "Everyone left the table." : "The dealer took every chip." }),
      standings: [
        ...ranked.map((p) => ({
          playerId: p.id,
          value: p.stack,
          label: p.stack > 0 ? `${formatChips(p.stack)} chips` : `out in round ${p.outRound ?? state.round}`,
        })),
        ...left.map((p) => ({ playerId: p.id, value: 0, label: "left" })),
      ],
    };
  },

  partyStats(state) {
    return state.stats ?? {};
  },
};
