import { shuffle, type GameContext, type GameDefinition, type GameEventEnvelope, type GameResult, type TimerRequest } from "@games/game-core";
import { ohHellManifest } from "../shared/manifest.ts";
import {
  biggestHand,
  buildSchedule,
  forbiddenBid,
  forbiddenBidMessage,
  makeDeck,
  parseCardId,
  rescheduleFrom,
  scoreRound,
  sortHand,
} from "../shared/rules.ts";
import { legalPlays, trickWinnerIndex } from "../shared/tricks.ts";
import {
  DEFAULT_SETTINGS,
  SUMMARY_MS,
  TRICK_HOLD_MS,
  type Card,
  type OhHellAction,
  type OhHellEvent,
  type OhHellPlayerState,
  type OhHellPrivateState,
  type OhHellPublicState,
  type OhHellServerState,
  type OhHellSettings,
} from "../shared/types.ts";

type State = OhHellServerState;
type Player = OhHellPlayerState;
type Events = GameEventEnvelope<OhHellEvent>[];

const pub = (event: OhHellEvent): GameEventEnvelope<OhHellEvent> => ({ visibility: { kind: "public" }, event });

const reject = (code: string, message: string): GameResult<State, OhHellEvent> => ({ ok: false, error: { code, message } });

/** The finished trick on show, and the round summary. */
const TRICK = "trick";
const SUMMARY = "summary";

const SUIT_PLURAL: Record<string, string> = { spades: "Spade", hearts: "Heart", clubs: "Club", diamonds: "Diamond" };

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

const seated = (p: Player) => !p.removed;
const handSize = (state: State) => state.schedule[state.roundIndex]!;

/** The next seated player after seat `from`, going left. */
function nextSeat(state: State, from: number): number {
  const n = state.players.length;
  for (let step = 1; step <= n; step++) {
    const idx = (from + step) % n;
    if (seated(state.players[idx]!)) return idx;
  }
  return from;
}

function ledSuit(state: State): string | null {
  return state.trick[0]?.card.suit ?? null;
}

/** Whoever's bid or play it is, if anyone's. */
function currentId(state: State): string | null {
  if (state.phase === "bidding") return state.players[state.turnIndex]!.id;
  if (state.phase === "playing" && !state.held) return state.players[state.turnIndex]!.id;
  return null;
}

function bidsSoFar(state: State): number {
  return state.players.reduce((sum, p) => sum + (seated(p) ? (p.bid ?? 0) : 0), 0);
}

/** What the current bidder can't say. */
function currentForbidden(state: State): number | null {
  if (state.phase !== "bidding") return null;
  return forbiddenBid(handSize(state), bidsSoFar(state), state.turnIndex === state.dealerIndex, state.settings.dealerRule);
}

/**
 * Deals this round's hands one at a time from the dealer's left, then turns
 * the next card up for trump. `deck` is only for tests, and only the first deal.
 */
function deal(state: State, ctx: GameContext, out: Out, redeal: boolean, deck?: Card[]): void {
  const cards = deck ? [...deck] : shuffle(makeDeck(), ctx.randomInt);
  const size = handSize(state);
  for (const p of state.players) {
    p.hand = [];
    p.bid = null;
    p.tricks = 0;
  }
  let next = 0;
  let seat = state.dealerIndex;
  for (let i = 0; i < size; i++) {
    for (let k = 0; k < state.players.filter(seated).length; k++) {
      seat = nextSeat(state, seat);
      state.players[seat]!.hand.push(cards[next++]!);
    }
  }
  state.trump = cards[next]!;
  state.phase = "bidding";
  state.turnIndex = nextSeat(state, state.dealerIndex);
  state.leaderIndex = state.turnIndex;
  state.trick = [];
  state.held = null;
  state.lastTrick = null;
  state.tricksPlayed = 0;
  state.results = null;
  state.ready = [];
  out.events.push(
    pub({ type: "dealt", round: state.roundIndex + 1, handSize: size, dealerId: state.players[state.dealerIndex]!.id, trump: state.trump, redeal }),
  );
}

function finish(state: State, reason: "done" | "abandoned", out: Out): void {
  state.phase = "over";
  state.endReason = reason;
  state.held = null;
  const left = state.players.filter(seated);
  const top = Math.max(...left.map((p) => p.score));
  state.winnerIds = left.filter((p) => p.score === top).map((p) => p.id);
  out.timers.push({ kind: "cancel", timerId: TRICK }, { kind: "cancel", timerId: SUMMARY });
  out.events.push(pub({ type: "game-over", winnerIds: state.winnerIds, reason }));
}

function placeBid(state: State, tricks: number, out: Out): void {
  const me = state.players[state.turnIndex]!;
  me.bid = tricks;
  out.events.push(pub({ type: "bid", playerId: me.id, tricks }));
  if (state.turnIndex === state.dealerIndex) {
    // The dealer's in: left of them leads.
    state.phase = "playing";
    state.turnIndex = state.leaderIndex;
  } else state.turnIndex = nextSeat(state, state.turnIndex);
}

function playCard(state: State, card: Card, out: Out): void {
  const me = state.players[state.turnIndex]!;
  me.hand = me.hand.filter((c) => c.id !== card.id);
  state.trick.push({ playerId: me.id, card });
  out.events.push(pub({ type: "played", playerId: me.id, card }));
  if (state.trick.length < state.players.filter(seated).length) {
    state.turnIndex = nextSeat(state, state.turnIndex);
    return;
  }
  // Full trick: it stays up a moment so everyone sees who took it.
  const winnerId = state.trick[trickWinnerIndex(state.trick.map((t) => t.card), state.trump.suit)]!.playerId;
  state.players.find((p) => p.id === winnerId)!.tricks++;
  state.held = { plays: state.trick, winnerId };
  out.events.push(pub({ type: "trick-won", winnerId, plays: state.trick }));
  out.timers.push({ kind: "set", timerId: TRICK, delayMs: TRICK_HOLD_MS });
}

/** The held trick comes off the table. The winner leads, or the round's scored. */
function collect(state: State, ctx: GameContext, out: Out): void {
  const held = state.held!;
  state.lastTrick = held;
  state.held = null;
  state.trick = [];
  state.tricksPlayed++;
  out.events.push(pub({ type: "trick-collected", winnerId: held.winnerId }));
  if (state.tricksPlayed < handSize(state)) {
    state.turnIndex = state.leaderIndex = state.players.findIndex((p) => p.id === held.winnerId);
    return;
  }
  const results = state.players.filter(seated).map((p) => {
    const points = scoreRound(p.bid ?? 0, p.tricks, state.settings.missing);
    p.score += points;
    return { playerId: p.id, bid: p.bid ?? 0, tricks: p.tricks, points, total: p.score };
  });
  state.results = results;
  state.phase = "round-summary";
  state.ready = [];
  state.summaryEndsAt = ctx.now + SUMMARY_MS;
  out.events.push(pub({ type: "round-scored", round: state.roundIndex + 1, results }));
  out.timers.push({ kind: "set", timerId: SUMMARY, delayMs: SUMMARY_MS });
}

/** The summary's done: the next round, or the end. */
function nextRound(state: State, ctx: GameContext, out: Out): void {
  out.timers.push({ kind: "cancel", timerId: SUMMARY });
  if (state.roundIndex + 1 >= state.schedule.length) {
    finish(state, "done", out);
    return;
  }
  state.roundIndex++;
  state.dealerIndex = nextSeat(state, state.dealerIndex);
  deal(state, ctx, out, false);
}

function everyoneReady(state: State): boolean {
  return state.players.filter(seated).every((p) => state.ready.includes(p.id));
}

/** The lowest card you're allowed, keeping trump back if there's a choice. */
function lowestLegal(state: State): Card {
  const legal = legalPlays(state.players[state.turnIndex]!.hand, ledSuit(state));
  const plain = legal.filter((c) => c.suit !== state.trump.suit);
  return sortHand(plain.length ? plain : legal, state.trump.suit).sort((a, b) => a.rank - b.rank)[0]!;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Injected decks (tests, dev tools): Cards or ids, all 52 once, dealt in order from the dealer's left. */
function normalizeDeck(input: unknown[]): Card[] {
  const cards = input.map((c) => (typeof c === "string" ? parseCardId(c) : parseCardId((c as Card)?.id ?? "")));
  if (cards.length !== 52 || cards.some((c) => !c) || new Set(cards.map((c) => c!.id)).size !== 52) {
    throw new Error('A deck must be exactly the 52 cards, each once (e.g. "hearts-8").');
  }
  return cards as Card[];
}

function parseSettings(input: unknown): OhHellSettings | null {
  if (input === undefined || input === null) return { ...DEFAULT_SETTINGS };
  if (typeof input !== "object" || Array.isArray(input)) return null;
  const s = { ...DEFAULT_SETTINGS, ...(input as Partial<OhHellSettings>) };
  const ok =
    (s.schedule === "up-down" || s.schedule === "down" || s.schedule === "up") &&
    (s.biggest === 7 || s.biggest === 10 || s.biggest === "max") &&
    typeof s.dealerRule === "boolean" &&
    (s.missing === "zero" || s.missing === "difference");
  return ok ? { schedule: s.schedule, biggest: s.biggest, dealerRule: s.dealerRule, missing: s.missing } : null;
}

function parseAction(input: unknown): OhHellAction | null {
  if (typeof input !== "object" || input === null) return null;
  const a = input as Record<string, unknown>;
  if (a.type === "ready") return { type: "ready" };
  if (a.type === "bid" && Number.isInteger(a.tricks) && (a.tricks as number) >= 0 && (a.tricks as number) <= 17) {
    return { type: "bid", tricks: a.tricks as number };
  }
  if (a.type === "play" && typeof a.card === "string" && a.card.length <= 16) return { type: "play", card: a.card };
  return null;
}

// ---------------------------------------------------------------------------
// Definition
// ---------------------------------------------------------------------------

export const ohHellGame: GameDefinition<OhHellServerState, OhHellAction, OhHellPublicState, OhHellPrivateState, OhHellSettings, OhHellEvent> = {
  manifest: ohHellManifest,
  defaultSettings: DEFAULT_SETTINGS,
  parseSettings,
  parseAction,

  createGame(players, settings, match, ctx, options) {
    const n = players.length;
    const { minPlayers, maxPlayers } = ohHellManifest;
    if (n < minPlayers || n > maxPlayers) throw new Error(`oh-hell: needs ${minPlayers}–${maxPlayers} players, got ${n}`);
    const deck = options?.deck ? normalizeDeck(options.deck) : undefined;
    const state: State = {
      phase: "bidding",
      settings,
      players: players.map((p) => ({ id: p.id, hand: [], bid: null, tricks: 0, score: 0, removed: false })),
      schedule: buildSchedule(settings.schedule, biggestHand(settings.biggest, n)),
      roundIndex: 0,
      dealerIndex: ((match.dealerSeat % n) + n) % n,
      trump: makeDeck()[0]!,
      turnIndex: 0,
      leaderIndex: 0,
      trick: [],
      held: null,
      lastTrick: null,
      tricksPlayed: 0,
      results: null,
      ready: [],
      summaryEndsAt: 0,
      winnerIds: [],
      endReason: null,
    };
    const out = newOut();
    deal(state, ctx, out, false, deck);
    return { state, events: out.events };
  },

  handleAction(prev, playerId, action, ctx) {
    if (prev.phase === "over") return reject("game-finished", "The game is over.");
    const seat = prev.players.findIndex((p) => p.id === playerId);
    if (seat < 0 || prev.players[seat]!.removed) return reject("not-in-game", "You're not in this game.");

    switch (action.type) {
      case "bid": {
        if (prev.phase !== "bidding") return reject("not-bidding", "Bids are finished for this round.");
        if (seat !== prev.turnIndex) return reject("not-your-turn", "It's not your turn to bid.");
        const size = handSize(prev);
        if (action.tricks > size) return reject("bad-bid", `Bid 0 to ${size}.`);
        if (action.tricks === currentForbidden(prev)) return reject("forbidden-bid", forbiddenBidMessage(action.tricks, size));
        const state = clone(prev);
        const out = newOut();
        placeBid(state, action.tricks, out);
        return { ok: true, transition: done(state, out) };
      }
      case "play": {
        if (prev.phase !== "playing") return reject("not-playing", prev.phase === "bidding" ? "Wait. Players are still bidding." : "You can't play now.");
        if (prev.held) return reject("trick-held", "Wait. The last trick is still on the table.");
        if (seat !== prev.turnIndex) return reject("not-your-turn", "It's not your turn.");
        const hand = prev.players[seat]!.hand;
        const card = hand.find((c) => c.id === action.card);
        if (!card) return reject("card-not-owned", "You don't have that card.");
        const led = ledSuit(prev);
        if (!legalPlays(hand, led).includes(card)) {
          return reject("must-follow", `You must follow suit. Play a ${SUIT_PLURAL[led!]}.`);
        }
        const state = clone(prev);
        const out = newOut();
        playCard(state, state.players[seat]!.hand.find((c) => c.id === card.id)!, out);
        return { ok: true, transition: done(state, out) };
      }
      case "ready": {
        if (prev.phase !== "round-summary") return reject("not-summary", "There is nothing to wait for.");
        if (prev.ready.includes(playerId)) return reject("already-ready", "You're ready. Waiting for the other players.");
        const state = clone(prev);
        const out = newOut([pub({ type: "ready", playerId })]);
        state.ready.push(playerId);
        if (everyoneReady(state)) nextRound(state, ctx, out);
        return { ok: true, transition: done(state, out) };
      }
    }
  },

  onTimer(prev, timerId, ctx) {
    if (timerId === TRICK && prev.phase === "playing" && prev.held) {
      const state = clone(prev);
      const out = newOut();
      collect(state, ctx, out);
      return done(state, out);
    }
    if (timerId === SUMMARY && prev.phase === "round-summary") {
      const state = clone(prev);
      const out = newOut();
      nextRound(state, ctx, out);
      return done(state, out);
    }
    return { state: prev, events: [] };
  },

  /** Bid 0 (or 1 if 0's the dealer's forbidden bid). In play, the lowest legal card, non-trump if possible. */
  skipTurn(prev, playerId) {
    if (currentId(prev) !== playerId) return { state: prev, events: [] };
    const state = clone(prev);
    const out = newOut([pub({ type: "turn-skipped", playerId })]);
    if (state.phase === "bidding") placeBid(state, currentForbidden(state) === 0 ? 1 : 0, out);
    else playCard(state, lowestLegal(state), out);
    return done(state, out);
  },

  /**
   * Scores keep. Mid-round, the round's redealt at the same hand size (capped
   * to the new biggest hand) and the rest of the schedule follows the new
   * player count. Fewer than three left ends it.
   */
  onPlayerRemoved(prev, playerId, ctx) {
    const idx = prev.players.findIndex((p) => p.id === playerId);
    if (prev.phase === "over" || idx < 0 || prev.players[idx]!.removed) return { state: prev, events: [] };
    const state = clone(prev);
    const out = newOut([pub({ type: "player-removed", playerId })]);
    const leaver = state.players[idx]!;
    leaver.removed = true;
    leaver.hand = [];
    state.ready = state.ready.filter((id) => id !== playerId);

    const left = state.players.filter(seated).length;
    if (left < ohHellManifest.minPlayers) {
      finish(state, "abandoned", out);
      return done(state, out);
    }
    const biggest = biggestHand(state.settings.biggest, left);
    if (state.phase === "round-summary") {
      // This round's already scored; only what's still to come changes.
      const next = state.roundIndex + 1;
      if (next < state.schedule.length) state.schedule = rescheduleFrom(state.schedule, next, state.settings.schedule, biggest);
      if (everyoneReady(state)) nextRound(state, ctx, out);
      return done(state, out);
    }
    state.schedule = rescheduleFrom(state.schedule, state.roundIndex, state.settings.schedule, biggest);
    // A dealer who left passes the deal to their left.
    if (idx === state.dealerIndex) state.dealerIndex = nextSeat(state, idx);
    out.timers.push({ kind: "cancel", timerId: TRICK });
    deal(state, ctx, out, true);
    return done(state, out);
  },

  getPublicState(state) {
    const trick = state.held?.plays ?? state.trick;
    return {
      phase: state.phase,
      players: state.players.map((p) => ({
        id: p.id,
        bid: p.bid,
        tricks: p.tricks,
        score: p.score,
        cardCount: p.hand.length,
        removed: p.removed,
        ready: state.ready.includes(p.id),
      })),
      round: state.roundIndex + 1,
      schedule: state.schedule,
      handSize: handSize(state),
      dealerId: state.players[state.dealerIndex]!.id,
      trump: state.trump,
      currentPlayerId: currentId(state),
      bidsMade: state.players.filter((p) => seated(p) && p.bid !== null).length,
      bidsTotal: bidsSoFar(state),
      forbiddenBid: currentForbidden(state),
      dealerRule: state.settings.dealerRule,
      missing: state.settings.missing,
      trick,
      trickWinnerId: state.held?.winnerId ?? null,
      lastTrick: state.lastTrick,
      trickNumber: Math.min(state.tricksPlayed + 1, handSize(state)),
      results: state.results,
      summaryEndsAt: state.phase === "round-summary" ? state.summaryEndsAt : null,
      summaryMs: SUMMARY_MS,
      winnerIds: state.winnerIds,
      endReason: state.endReason,
    };
  },

  getPrivateState(state, playerId) {
    const p = state.players.find((x) => x.id === playerId);
    if (!p) return { hand: [], legal: [], canBid: false, canReady: false };
    const mine = currentId(state) === playerId && !p.removed;
    const hand = sortHand(p.hand, state.trump.suit);
    return {
      hand,
      legal: mine && state.phase === "playing" ? legalPlays(hand, ledSuit(state)).map((c) => c.id) : [],
      canBid: mine && state.phase === "bidding",
      canReady: state.phase === "round-summary" && !p.removed && !state.ready.includes(playerId),
    };
  },

  // A held trick and the summary run on the clock, not on anyone.
  getAwaitedPlayerIds(state) {
    const id = currentId(state);
    return id ? [id] : [];
  },

  getResult(state) {
    if (state.phase !== "over") return null;
    const order = [...state.players].sort((a, b) => Number(a.removed) - Number(b.removed) || b.score - a.score);
    const top = state.players.find((p) => p.id === state.winnerIds[0])?.score ?? 0;
    const pts = (n: number) => `${n} ${Math.abs(n) === 1 ? "pt" : "pts"}`;
    return {
      winnerIds: state.winnerIds,
      standings: order.map((p) => ({ playerId: p.id, value: p.score, label: p.removed ? `left · ${pts(p.score)}` : pts(p.score) })),
      headline: state.winnerIds.length > 1 ? `A tie at ${pts(top)}` : undefined,
    };
  },
};
