import {
  shuffle,
  type GameContext,
  type GameDefinition,
  type GameEventEnvelope,
  type GameResult,
  type GameTransition,
} from "@games/game-core";
import { presidentManifest } from "../shared/manifest.ts";
import {
  bestCards,
  checkPlay,
  compareCards,
  makeDeck,
  parseCardId,
  playableRanks,
  pointsFor,
  titleFor,
  tributes,
  worstCards,
} from "../shared/rules.ts";
import {
  DEFAULT_SETTINGS,
  OPENING_CARD,
  ROUND_CHOICES,
  type Card,
  type EndReason,
  type PresidentAction,
  type PresidentEvent,
  type PresidentPlayerState,
  type PresidentPrivateState,
  type PresidentPublicState,
  type PresidentServerState,
  type PresidentSettings,
  type Swap,
} from "../shared/types.ts";

type State = PresidentServerState;
type Player = PresidentPlayerState;
type Transition = GameTransition<State, PresidentEvent>;
type Events = GameEventEnvelope<PresidentEvent>[];

const pub = (event: PresidentEvent): GameEventEnvelope<PresidentEvent> => ({ visibility: { kind: "public" }, event });
const only = (playerId: string, event: PresidentEvent): GameEventEnvelope<PresidentEvent> => ({
  visibility: { kind: "private", playerId },
  event,
});

const reject = (code: string, message: string): GameResult<State, PresidentEvent> => ({
  ok: false,
  error: { code, message },
});

// ---------------------------------------------------------------------------
// Internals. Each helper takes a state it may mutate: callers always pass a
// fresh clone, which keeps the public API pure.
// ---------------------------------------------------------------------------

const clone = (state: State): State => structuredClone(state);

/** Still in the round: seated and holding cards. */
const holding = (p: Player) => !p.removed && p.hand.length > 0;

function holders(state: State): Player[] {
  return state.players.filter(holding);
}

function seated(state: State): Player[] {
  return state.players.filter((p) => !p.removed);
}

function seatOf(state: State, id: string): number {
  return state.players.findIndex((p) => p.id === id);
}

/** The nearest seat clockwise from `from` still holding cards, `from` itself last. -1 if nobody. */
function nextHolder(state: State, from: number): number {
  const n = state.players.length;
  for (let step = 1; step <= n; step++) {
    const idx = (from + step) % n;
    if (holding(state.players[idx]!)) return idx;
  }
  return -1;
}

function top(state: State) {
  return state.trick.at(-1) ?? null;
}

/** Last round's finish order, minus anyone who's since left. */
function lastOrder(state: State): string[] {
  const order = state.history.at(-1) ?? [];
  return order.filter((id) => state.players.some((p) => p.id === id && !p.removed));
}

const pending = (state: State) => state.exchange.filter((s) => s.cards === null);

/** Moves `cards` between hands and tells the two people involved what they were. */
function swap(state: State, swap: Swap, cards: Card[], events: Events): void {
  const from = state.players[seatOf(state, swap.fromId)]!;
  const to = state.players[seatOf(state, swap.toId)]!;
  const ids = new Set(cards.map((c) => c.id));
  from.hand = from.hand.filter((c) => !ids.has(c.id));
  to.hand = [...to.hand, ...cards].sort(compareCards);
  swap.cards = cards;
  const { kind, fromId, toId, count } = swap;
  events.push(
    pub({ type: "swapped", kind, fromId, toId, count }),
    only(fromId, { type: "swap-cards", kind, fromId, toId, cards }),
    only(toId, { type: "swap-cards", kind, fromId, toId, cards }),
  );
}

/** Every return's in (or called off): the Asshole leads. */
function maybeStartPlay(state: State): void {
  if (state.phase !== "exchange" || pending(state).length) return;
  state.phase = "playing";
  if (!holding(state.players[state.turnIndex]!)) state.turnIndex = nextHolder(state, state.turnIndex);
  state.turnNumber++;
}

/**
 * Deals a round to everyone still seated, clockwise from the dealer's left,
 * then collects the tributes. Round 1 is led by the 3♣; after that the
 * Asshole deals and leads.
 */
function startRound(state: State, ctx: GameContext, events: Events, deck?: Card[]): void {
  const prev = lastOrder(state);
  state.round++;
  if (prev.length) state.dealerIndex = seatOf(state, prev.at(-1)!);
  for (const p of state.players) {
    p.hand = [];
    p.passed = false;
  }
  state.trick = [];
  state.lastIndex = -1;
  state.discard = [];
  state.finishOrder = [];
  state.exchange = [];

  const n = state.players.length;
  const seats: number[] = [];
  for (let step = 1; step <= n; step++) {
    const idx = (state.dealerIndex + step) % n;
    if (!state.players[idx]!.removed) seats.push(idx);
  }
  const cards = deck ?? shuffle(makeDeck(), ctx.randomInt);
  cards.forEach((card, i) => state.players[seats[i % seats.length]!]!.hand.push(card));
  for (const i of seats) state.players[i]!.hand.sort(compareCards);
  events.push(
    pub({
      type: "dealt",
      round: state.round,
      dealerId: state.players[state.dealerIndex]!.id,
      handSizes: Object.fromEntries(seats.map((i) => [state.players[i]!.id, state.players[i]!.hand.length])),
    }),
  );

  state.turnIndex = prev.length
    ? seatOf(state, prev.at(-1)!)
    : state.players.findIndex((p) => p.hand.some((c) => c.id === OPENING_CARD));
  const owed = tributes(prev);
  for (const t of owed) {
    const tribute: Swap = { kind: "tribute", ...t, cards: null };
    state.exchange.push(tribute);
    swap(state, tribute, bestCards(state.players[seatOf(state, t.fromId)]!.hand, t.count), events);
  }
  for (const t of owed) state.exchange.push({ kind: "return", fromId: t.toId, toId: t.fromId, count: t.count, cards: null });
  state.phase = owed.length ? "exchange" : "playing";
  state.turnNumber++;
}

/**
 * Most points wins. A tie goes to whoever finished higher in the last round
 * played, so there's one winner unless the tied players both missed it.
 */
function winners(state: State): string[] {
  const last = state.history.at(-1) ?? [];
  const place = (p: Player) => {
    const i = last.indexOf(p.id);
    return i < 0 ? Infinity : i;
  };
  const ranked = [...seated(state)].sort((a, b) => b.points - a.points || place(a) - place(b));
  const best = ranked[0];
  if (!best) return [];
  return ranked.filter((p) => p.points === best.points && place(p) === place(best)).map((p) => p.id);
}

function finish(state: State, reason: EndReason, events: Events): void {
  state.phase = "finished";
  state.endReason = reason;
  state.winnerIds = winners(state);
  events.push(pub({ type: "game-over", winnerIds: state.winnerIds, reason }));
}

function goOut(state: State, p: Player, events: Events): void {
  state.finishOrder.push(p.id);
  const place = state.finishOrder.length;
  // Everyone still in counts toward the size of the table, whoever's left since doesn't.
  const n = place + holders(state).filter((x) => x !== p).length;
  events.push(pub({ type: "went-out", playerId: p.id, place, title: titleFor(place, n) }));
}

/** One holder left: they're last. Score it, then deal again or call the game. */
function endRound(state: State, ctx: GameContext, events: Events): void {
  for (const p of holders(state)) {
    state.discard.push(...p.hand);
    p.hand = [];
    goOut(state, p, events);
  }
  state.discard.push(...state.trick.flatMap((t) => t.cards));
  state.trick = [];
  const order = state.finishOrder;
  const points: Record<string, number> = {};
  order.forEach((id, i) => {
    points[id] = pointsFor(i + 1, order.length);
    state.players[seatOf(state, id)]!.points += points[id];
  });
  state.history.push([...order]);
  events.push(pub({ type: "round-over", round: state.round, order: [...order], points }));
  if (state.round >= state.settings.rounds) finish(state, "done", events);
  else if (seated(state).length < 2) finish(state, "abandoned", events);
  else startRound(state, ctx, events);
}

/** Everyone else passed (or is out): the pile goes, the last player leads, or the next one on if they're out. */
function clearTrick(state: State, idx: number, events: Events): void {
  state.discard.push(...state.trick.flatMap((t) => t.cards));
  state.trick = [];
  state.lastIndex = -1;
  for (const p of state.players) p.passed = false;
  state.turnIndex = holding(state.players[idx]!) ? idx : nextHolder(state, idx);
  state.turnNumber++;
  events.push(pub({ type: "cleared", leaderId: state.players[state.turnIndex]!.id }));
}

/**
 * Moves the turn on from the current seat. Players who've passed or are out
 * don't get one; neither does the next player after a match (`skipOne`).
 * Anyone who can't beat the top set passes without being asked. Coming back
 * round to whoever played last clears the trick.
 */
function advance(state: State, events: Events, skipOne = false): void {
  const n = state.players.length;
  const t = top(state);
  for (let step = 1; step <= n; step++) {
    const idx = (state.turnIndex + step) % n;
    if (idx === state.lastIndex) return clearTrick(state, idx, events);
    const p = state.players[idx]!;
    if (!holding(p) || p.passed) continue;
    if (skipOne) {
      skipOne = false;
      events.push(pub({ type: "skipped", playerId: p.id }));
      continue;
    }
    if (!playableRanks(p.hand, t, state.settings.matchSkips).length) {
      p.passed = true;
      events.push(pub({ type: "passed", playerId: p.id, auto: true }));
      continue;
    }
    state.turnIndex = idx;
    state.turnNumber++;
    return;
  }
  throw new Error("president: went all the way round without finding the last player");
}

/** The lead passes on without a play (host skip, or the leader left). */
function passLead(state: State): void {
  state.turnIndex = nextHolder(state, state.turnIndex);
  state.turnNumber++;
}

function play(state: State, cards: Card[], ctx: GameContext, events: Events): Transition {
  const me = state.players[state.turnIndex]!;
  const prevTop = top(state);
  const ids = new Set(cards.map((c) => c.id));
  me.hand = me.hand.filter((c) => !ids.has(c.id));
  const set = [...cards].sort(compareCards);
  state.trick.push({ playerId: me.id, cards: set });
  state.lastIndex = state.turnIndex;
  events.push(pub({ type: "played", playerId: me.id, cards: set }));
  if (!me.hand.length) goOut(state, me, events);
  if (holders(state).length <= 1) endRound(state, ctx, events);
  else advance(state, events, !!prevTop && prevTop.cards[0]!.rank === set[0]!.rank);
  return { state, events };
}

/** Owned, distinct cards for these ids, or a rejection. */
function ownCards(p: Player, cardIds: string[]): Card[] | GameResult<State, PresidentEvent> {
  if (new Set(cardIds).size !== cardIds.length) return reject("bad-card", "Each card only once.");
  const cards: Card[] = [];
  for (const id of cardIds) {
    const card = p.hand.find((c) => c.id === id);
    if (!card) return parseCardId(id) ? reject("card-not-owned", "You don't have that card.") : reject("bad-card", "That isn't a card.");
    cards.push(card);
  }
  return cards;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Injected decks (tests, dev tools) may be Cards or card ids, dealt in order
 * from the dealer's left. Round 1 only; later rounds shuffle. All 52, each once.
 */
function normalizeDeck(input: unknown[]): Card[] {
  const cards = input.map((c) => (typeof c === "string" ? parseCardId(c) : (c as Card)));
  const ids = new Set(cards.map((c) => c?.id));
  if (cards.length !== 52 || ids.size !== 52 || !cards.every((c) => c && parseCardId(c.id))) {
    throw new Error("A deck must be exactly the 52 cards, each once (e.g. \"hearts-8\").");
  }
  return cards as Card[];
}

function parseSettings(input: unknown): PresidentSettings | null {
  if (input === undefined || input === null) return { ...DEFAULT_SETTINGS };
  if (typeof input !== "object" || Array.isArray(input)) return null;
  const s = { ...DEFAULT_SETTINGS, ...(input as Partial<PresidentSettings>) };
  const ok = ROUND_CHOICES.includes(s.rounds as (typeof ROUND_CHOICES)[number]) && typeof s.matchSkips === "boolean";
  return ok ? { rounds: s.rounds, matchSkips: s.matchSkips } : null;
}

function parseCardIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 4) return null;
  return value.every((id) => typeof id === "string" && id.length <= 16) ? (value as string[]) : null;
}

function parseAction(input: unknown): PresidentAction | null {
  if (typeof input !== "object" || input === null) return null;
  const a = input as Record<string, unknown>;
  if (a.type === "pass") return { type: "pass" };
  if (a.type === "play" || a.type === "give") {
    const cardIds = parseCardIds(a.cardIds);
    return cardIds ? { type: a.type, cardIds } : null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Definition
// ---------------------------------------------------------------------------

export const presidentGame: GameDefinition<
  PresidentServerState,
  PresidentAction,
  PresidentPublicState,
  PresidentPrivateState,
  PresidentSettings,
  PresidentEvent
> = {
  manifest: presidentManifest,
  defaultSettings: DEFAULT_SETTINGS,
  parseSettings,
  parseAction,

  createGame(players, settings, match, ctx, options) {
    const n = players.length;
    const { minPlayers, maxPlayers } = presidentManifest;
    if (n < minPlayers || n > maxPlayers) {
      throw new Error(`president: needs ${minPlayers}–${maxPlayers} players, got ${n}`);
    }
    const deck = options?.deck ? normalizeDeck(options.deck) : undefined;
    const state: State = {
      phase: "playing",
      settings,
      players: players.map((p) => ({ id: p.id, hand: [], removed: false, passed: false, points: 0 })),
      round: 0,
      dealerIndex: ((match.dealerSeat % n) + n) % n,
      turnIndex: 0,
      turnNumber: 0,
      trick: [],
      lastIndex: -1,
      discard: [],
      finishOrder: [],
      history: [],
      exchange: [],
      winnerIds: [],
      endReason: null,
    };
    const events: Events = [];
    startRound(state, ctx, events, deck);
    return { state, events };
  },

  handleAction(prev, playerId, action, ctx) {
    if (prev.phase === "finished") return reject("game-finished", "The game is over.");
    const seat = prev.players.findIndex((p) => p.id === playerId);
    if (seat < 0 || prev.players[seat]!.removed) return reject("not-in-game", "You're not in this game.");

    if (action.type === "give") {
      const owed = prev.phase === "exchange" ? pending(prev).find((s) => s.fromId === playerId) : undefined;
      if (!owed) return reject("nothing-to-give", "You don't owe anyone cards.");
      if (action.cardIds.length !== owed.count) {
        return reject("wrong-count", `Give back exactly ${owed.count} ${owed.count === 1 ? "card" : "cards"}.`);
      }
      const state = clone(prev);
      const cards = ownCards(state.players[seat]!, action.cardIds);
      if (!Array.isArray(cards)) return cards;
      const events: Events = [];
      swap(state, pending(state).find((s) => s.fromId === playerId)!, cards, events);
      maybeStartPlay(state);
      return { ok: true, transition: { state, events } };
    }

    if (prev.phase === "exchange") return reject("exchanging", "Hang on, cards are still being swapped.");
    if (seat !== prev.turnIndex) return reject("not-your-turn", "It's not your turn.");

    const state = clone(prev);
    const events: Events = [];
    if (action.type === "pass") {
      if (!top(state)) return reject("leading", "You're leading: play something.");
      state.players[seat]!.passed = true;
      events.push(pub({ type: "passed", playerId, auto: false }));
      advance(state, events);
      return { ok: true, transition: { state, events } };
    }

    const cards = ownCards(state.players[seat]!, action.cardIds);
    if (!Array.isArray(cards)) return cards;
    const why = checkPlay(cards, top(state), state.settings.matchSkips);
    if (why) return reject("illegal-play", why);
    return { ok: true, transition: play(state, cards, ctx, events) };
  },

  /**
   * The host moves an idle player along. Mid-trick that's a pass; on the lead
   * it hands the lead on; in the exchange it gives back their lowest cards.
   */
  skipTurn(prev, playerId) {
    if (prev.phase === "exchange") {
      const owed = pending(prev).find((s) => s.fromId === playerId);
      if (!owed) return { state: prev, events: [] };
      const state = clone(prev);
      const events: Events = [pub({ type: "turn-skipped", playerId })];
      const p = state.players[seatOf(state, playerId)]!;
      swap(state, pending(state).find((s) => s.fromId === playerId)!, worstCards(p.hand, owed.count), events);
      maybeStartPlay(state);
      return { state, events };
    }
    if (prev.phase !== "playing" || prev.players[prev.turnIndex]!.id !== playerId) return { state: prev, events: [] };
    const state = clone(prev);
    const events: Events = [pub({ type: "turn-skipped", playerId })];
    if (!top(state)) passLead(state);
    else {
      state.players[state.turnIndex]!.passed = true;
      advance(state, events);
    }
    return { state, events };
  },

  onPlayerRemoved(prev, playerId, ctx) {
    const idx = seatOf(prev, playerId);
    if (prev.phase === "finished" || idx < 0 || prev.players[idx]!.removed) return { state: prev, events: [] };

    const state = clone(prev);
    const leaver = state.players[idx]!;
    // Out of play, not handed on: nobody should inherit a hand of twos.
    state.discard.push(...leaver.hand);
    leaver.hand = [];
    leaver.removed = true;
    leaver.passed = false;
    const events: Events = [pub({ type: "player-removed", playerId })];

    if (seated(state).length < 2) {
      finish(state, "abandoned", events);
    } else if (state.phase === "exchange") {
      // Their side of any swap is off.
      for (const s of pending(state)) if (s.fromId === playerId || s.toId === playerId) s.cards = [];
      if (state.turnIndex === idx) state.turnIndex = nextHolder(state, idx);
      maybeStartPlay(state);
    } else if (holders(state).length <= 1) {
      endRound(state, ctx, events);
    } else if (state.turnIndex === idx) {
      if (!top(state)) passLead(state);
      else advance(state, events);
    }
    return { state, events };
  },

  getPublicState(state) {
    const prev = lastOrder(state);
    const t = top(state);
    return {
      phase: state.phase,
      round: state.round,
      rounds: state.settings.rounds,
      matchSkips: state.settings.matchSkips,
      players: state.players.map((p) => {
        const out = state.finishOrder.indexOf(p.id);
        const was = prev.indexOf(p.id);
        return {
          id: p.id,
          cardCount: p.hand.length,
          removed: p.removed,
          passed: p.passed,
          points: p.points,
          place: out < 0 ? null : out + 1,
          title: was < 0 ? null : titleFor(was + 1, prev.length),
        };
      }),
      currentPlayerId: state.phase === "playing" ? state.players[state.turnIndex]!.id : null,
      top: t,
      trickSize: state.trick.length,
      dealerId: state.players[state.dealerIndex]!.id,
      exchange: state.exchange.map(({ kind, fromId, toId, count, cards }) => ({ kind, fromId, toId, count, done: cards !== null })),
      lastRound: state.history.at(-1) ?? null,
      winnerIds: state.winnerIds,
      endReason: state.endReason,
    };
  },

  getPrivateState(state, playerId) {
    const p = state.players.find((x) => x.id === playerId);
    if (!p) return { hand: [], playableRanks: [], canPass: false, mustGive: 0, gave: [], got: [] };
    const myTurn = state.phase === "playing" && state.players[state.turnIndex]!.id === playerId;
    const t = top(state);
    return {
      hand: p.hand,
      playableRanks: myTurn ? playableRanks(p.hand, t, state.settings.matchSkips) : [],
      canPass: myTurn && !!t,
      mustGive: state.phase === "exchange" ? (pending(state).find((s) => s.fromId === playerId)?.count ?? 0) : 0,
      gave: state.exchange.filter((s) => s.fromId === playerId).flatMap((s) => s.cards ?? []),
      got: state.exchange.filter((s) => s.toId === playerId).flatMap((s) => s.cards ?? []),
    };
  },

  getAwaitedPlayerIds(state) {
    if (state.phase === "exchange") return [...new Set(pending(state).map((s) => s.fromId))];
    return state.phase === "playing" ? [state.players[state.turnIndex]!.id] : [];
  },

  getResult(state) {
    if (state.phase !== "finished") return null;
    const last = state.history.at(-1) ?? [];
    const place = (p: Player) => {
      const i = last.indexOf(p.id);
      return p.removed ? 1000 + i : i < 0 ? 100 : i;
    };
    return {
      winnerIds: state.winnerIds,
      standings: [...state.players]
        .sort((a, b) => Number(a.removed) - Number(b.removed) || b.points - a.points || place(a) - place(b))
        .map((p) => {
          const i = last.indexOf(p.id);
          const pts = `${p.points} ${p.points === 1 ? "pt" : "pts"}`;
          const label = p.removed ? "left" : i < 0 ? pts : `${pts} · ${titleFor(i + 1, last.length)}`;
          return { playerId: p.id, value: p.points, label };
        }),
    };
  },
};
