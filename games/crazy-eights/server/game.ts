import {
  shuffle,
  type GameDefinition,
  type GameEventEnvelope,
  type GameResult,
  type GameTransition,
} from "@games/game-core";
import { crazyEightsManifest } from "../shared/manifest.ts";
import {
  compareCards,
  formatRank,
  getPlayableCards,
  handPoints,
  makeDeck,
  parseCardId,
  resolveDecks,
  stockAfterDeal,
} from "../shared/rules.ts";
import {
  DEFAULT_SETTINGS,
  EIGHT,
  HAND_SIZE,
  MAX_DECKS,
  SUITS,
  type Card,
  type CrazyEightsAction,
  type CrazyEightsEvent,
  type CrazyEightsPrivateState,
  type CrazyEightsPublicState,
  type CrazyEightsServerState,
  type CrazyEightsSettings,
  type EndReason,
  type Suit,
} from "../shared/types.ts";

type State = CrazyEightsServerState;
type Transition = GameTransition<State, CrazyEightsEvent>;
type Events = GameEventEnvelope<CrazyEightsEvent>[];

const pub = (event: CrazyEightsEvent): GameEventEnvelope<CrazyEightsEvent> => ({ visibility: { kind: "public" }, event });
const only = (playerId: string, event: CrazyEightsEvent): GameEventEnvelope<CrazyEightsEvent> => ({
  visibility: { kind: "private", playerId },
  event,
});

const reject = (code: string, message: string): GameResult<State, CrazyEightsEvent> => ({
  ok: false,
  error: { code, message },
});

// ---------------------------------------------------------------------------
// Internals. Each helper takes a state it may mutate: callers always pass a
// fresh clone, which keeps the public API pure.
// ---------------------------------------------------------------------------

const clone = (state: State): State => structuredClone(state);

function current(state: State) {
  return state.players[state.turnIndex]!;
}

function top(state: State): Card {
  return state.discard.at(-1)!;
}

function activeCount(state: State): number {
  return state.players.filter((p) => !p.removed).length;
}

function playable(state: State, hand: readonly Card[]): Card[] {
  return getPlayableCards(hand, top(state), state.calledSuit);
}

/** Cards a draw could come from: the stock, plus the pile under the top card if reshuffling is on. */
function drawable(state: State): number {
  return state.stock.length + (state.settings.emptyStock === "reshuffle" ? state.discard.length - 1 : 0);
}

function canMove(state: State, hand: readonly Card[]): boolean {
  return drawable(state) > 0 || playable(state, hand).length > 0;
}

function finish(state: State, winnerIds: string[], reason: EndReason, events: Events): void {
  state.phase = "finished";
  state.winnerIds = winnerIds;
  state.endReason = reason;
  events.push(pub({ type: "game-over", winnerIds, reason }));
}

/**
 * Stock's gone, pile can't be recycled, nobody holds a playable card: the
 * hand is dead. Lowest count wins (ties share it). Bicycle doesn't say; this
 * is the usual Hoyle ruling.
 */
function blocked(state: State): boolean {
  if (drawable(state) > 0) return false;
  return state.players.every((p) => p.removed || playable(state, p.hand).length === 0);
}

function finishBlocked(state: State, events: Events): void {
  const active = state.players.filter((p) => !p.removed);
  const low = Math.min(...active.map((p) => handPoints(p.hand)));
  finish(state, active.filter((p) => handPoints(p.hand) === low).map((p) => p.id), "blocked", events);
}

/**
 * Hands the turn to the next active player who can move, auto-passing anyone
 * who can't. `includeCurrent` checks the current seat first (after a draw, and
 * when someone else was removed).
 */
function advanceTurn(state: State, events: Events, includeCurrent = false): void {
  const n = state.players.length;
  const from = state.turnIndex;
  // One lap is enough: `blocked` already ruled out "nobody can move".
  for (let step = includeCurrent ? 0 : 1; step <= n; step++) {
    const idx = (from + step) % n;
    const p = state.players[idx]!;
    if (p.removed) continue;
    state.turnIndex = idx;
    state.turnNumber++;
    if (canMove(state, p.hand)) return;
    events.push(pub({ type: "passed", playerId: p.id }));
  }
  throw new Error("crazy-eights: no player can move, but the game isn't blocked");
}

/** Shared tail for every transition that moves the game on. */
function settle(state: State, events: Events, includeCurrent = false): Transition {
  if (state.phase === "playing") {
    if (blocked(state)) finishBlocked(state, events);
    else advanceTurn(state, events, includeCurrent);
  }
  return { state, events };
}

/** Everything under the top card goes back face down, shuffled. */
function reshuffle(state: State, randomInt: (max: number) => number, events: Events): void {
  const under = state.discard.slice(0, -1);
  state.discard = [top(state)];
  state.stock = shuffle(under, randomInt);
  events.push(pub({ type: "reshuffled", count: under.length }));
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Injected decks (tests, dev tools) may be Cards or card ids, in deal order:
 * hands round-robin from the dealer's left, then the starter, then the stock
 * top-down. Every card of every deck exactly once.
 */
function normalizeDeck(input: unknown[], decks: number): Card[] {
  const cards = input.map((c) => (typeof c === "string" ? parseCardId(c) : (c as Card)));
  const want = 52 * decks;
  const valid = cards.every((c) => c && parseCardId(c.id) && c.copy < decks);
  if (cards.length !== want || new Set(cards.map((c) => c?.id)).size !== want || !valid) {
    throw new Error(
      decks === 1
        ? "A deck must be exactly the 52 cards, each once (e.g. \"hearts-8\")."
        : `${decks} decks means exactly ${want} cards, each once (second deck ids end in ~1, e.g. "hearts-8~1").`,
    );
  }
  return cards as Card[];
}

function parseSettings(input: unknown): CrazyEightsSettings | null {
  if (input === undefined || input === null) return { ...DEFAULT_SETTINGS };
  if (typeof input !== "object" || Array.isArray(input)) return null;
  const s = { ...DEFAULT_SETTINGS, ...(input as Partial<CrazyEightsSettings>) };
  const ok =
    (s.decks === "auto" || (Number.isInteger(s.decks) && s.decks >= 1 && s.decks <= MAX_DECKS)) &&
    (s.emptyStock === "pass" || s.emptyStock === "reshuffle");
  return ok ? { decks: s.decks, emptyStock: s.emptyStock } : null;
}

function parseAction(input: unknown): CrazyEightsAction | null {
  if (typeof input !== "object" || input === null) return null;
  const a = input as Record<string, unknown>;
  if (a.type === "draw") return { type: "draw" };
  if (a.type === "play-card" && typeof a.cardId === "string" && a.cardId.length <= 16) {
    if (a.suit === undefined) return { type: "play-card", cardId: a.cardId };
    if (SUITS.includes(a.suit as Suit)) return { type: "play-card", cardId: a.cardId, suit: a.suit as Suit };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Definition
// ---------------------------------------------------------------------------

export const crazyEightsGame: GameDefinition<
  CrazyEightsServerState,
  CrazyEightsAction,
  CrazyEightsPublicState,
  CrazyEightsPrivateState,
  CrazyEightsSettings,
  CrazyEightsEvent
> = {
  manifest: crazyEightsManifest,
  defaultSettings: DEFAULT_SETTINGS,
  parseSettings,
  parseAction,

  createGame(players, settings, match, ctx, options) {
    const n = players.length;
    const { minPlayers, maxPlayers } = crazyEightsManifest;
    if (n < minPlayers || n > maxPlayers) {
      throw new Error(`crazy-eights: needs ${minPlayers}–${maxPlayers} players, got ${n}`);
    }
    // A forced single deck can't cover a big table; quietly take the second.
    let decks = resolveDecks(settings.decks ?? "auto", n);
    if (stockAfterDeal(decks, n) < 0) decks = MAX_DECKS;
    const deck = options?.deck ? normalizeDeck(options.deck, decks) : shuffle(makeDeck(decks), ctx.randomInt);
    const dealerIndex = ((match.dealerSeat % n) + n) % n;

    // Deal one at a time, clockwise from the dealer's left.
    const hands: Card[][] = players.map(() => []);
    for (let i = 0; i < HAND_SIZE * n; i++) hands[(dealerIndex + 1 + i) % n]!.push(deck[i]!);
    const stock = deck.slice(HAND_SIZE * n).reverse(); // top of the stock is the end

    // Turn up the starter. An eight gets buried mid-stock and the next card
    // turned instead, unless the stock is nothing but eights (tiny stock, big
    // table, bad luck), in which case the eight stands and calls its own suit.
    const buried: Card[] = [];
    let starter = stock.pop()!;
    for (let tries = stock.length; starter.rank === EIGHT && tries > 0 && stock.some((c) => c.rank !== EIGHT); tries--) {
      buried.push(starter);
      stock.splice(Math.floor(stock.length / 2), 0, starter);
      starter = stock.pop()!;
    }

    const state: State = {
      phase: "playing",
      settings,
      players: players.map((p, i) => ({ id: p.id, hand: hands[i]!.sort(compareCards), removed: false })),
      decks,
      stock,
      discard: [starter],
      calledSuit: null,
      dealerIndex,
      turnIndex: (dealerIndex + 1) % n,
      turnNumber: 0,
      winnerIds: [],
      endReason: null,
    };

    const events: Events = [
      pub({
        type: "dealt",
        dealerId: players[dealerIndex]!.id,
        handSizes: Object.fromEntries(state.players.map((p) => [p.id, p.hand.length])),
        starter,
        buried,
      }),
    ];
    return settle(state, events, true);
  },

  handleAction(prev, playerId, action, ctx) {
    if (prev.phase !== "playing") return reject("game-finished", "The game is over.");
    const seat = prev.players.findIndex((p) => p.id === playerId);
    if (seat < 0 || prev.players[seat]!.removed) return reject("not-in-game", "You're not in this game.");
    if (seat !== prev.turnIndex) return reject("not-your-turn", "It's not your turn.");

    const state = clone(prev);
    const me = current(state);
    const events: Events = [];

    if (action.type === "draw") {
      if (drawable(state) === 0) return reject("stock-empty", "The stock's empty.");
      if (state.stock.length === 0) reshuffle(state, ctx.randomInt, events);
      const card = state.stock.pop()!;
      me.hand = [...me.hand, card].sort(compareCards);
      events.push(pub({ type: "drew", playerId }), only(playerId, { type: "you-drew", card }));
      // Still your turn: play what you drew, or keep drawing.
      return { ok: true, transition: settle(state, events, true) };
    }

    const card = me.hand.find((c) => c.id === action.cardId);
    if (!card) {
      return parseCardId(action.cardId)
        ? reject("card-not-owned", "You don't have that card.")
        : reject("bad-card", "That isn't a card.");
    }
    if (!playable(state, [card]).length) {
      // "hearts" → "a heart"; after an eight, only the called suit (or an eight) goes.
      const t = top(state);
      const suit = `a ${(state.calledSuit ?? t.suit).slice(0, -1)}`;
      const rank = state.calledSuit ? "" : ` or ${t.rank === 1 || t.rank === EIGHT ? "an" : "a"} ${formatRank(t.rank)}`;
      return reject("illegal-play", `That doesn't follow. It needs ${suit}${rank}, or an eight.`);
    }
    if (card.rank === EIGHT && !action.suit) return reject("call-a-suit", "Call a suit for your eight.");

    me.hand = me.hand.filter((c) => c.id !== card.id);
    state.discard.push(card);
    state.calledSuit = card.rank === EIGHT ? action.suit! : null;
    events.push(pub({ type: "card-played", playerId, card, calledSuit: state.calledSuit }));

    if (me.hand.length === 0) {
      finish(state, [playerId], "out", events);
      return { ok: true, transition: { state, events } };
    }
    return { ok: true, transition: settle(state, events) };
  },

  skipTurn(prev, playerId) {
    if (prev.phase !== "playing" || current(prev).id !== playerId) return { state: prev, events: [] };
    return settle(clone(prev), [pub({ type: "turn-skipped", playerId })]);
  },

  onPlayerRemoved(prev, playerId) {
    const idx = prev.players.findIndex((p) => p.id === playerId);
    if (prev.phase !== "playing" || idx < 0 || prev.players[idx]!.removed) return { state: prev, events: [] };

    const state = clone(prev);
    const leaver = state.players[idx]!;
    leaver.removed = true;
    // Their cards slide under the stock rather than vanish, so a two-deck
    // game doesn't quietly become a one-and-a-bit-deck game.
    state.stock = [...leaver.hand, ...state.stock];
    leaver.hand = [];
    const events: Events = [pub({ type: "player-removed", playerId })];

    if (activeCount(state) < 2) {
      const last = state.players.find((p) => !p.removed);
      finish(state, last ? [last.id] : [], "abandoned", events);
      return { state, events };
    }
    return settle(state, events, idx !== state.turnIndex);
  },

  getPublicState(state) {
    const t = top(state);
    return {
      players: state.players.map((p) => ({ id: p.id, cardCount: p.hand.length, removed: p.removed })),
      topCard: t,
      calledSuit: state.calledSuit,
      activeSuit: state.calledSuit ?? t.suit,
      stockCount: state.stock.length,
      reshuffleCount: state.settings.emptyStock === "reshuffle" ? state.discard.length - 1 : 0,
      currentPlayerId: state.phase === "playing" ? current(state).id : null,
      dealerId: state.players[state.dealerIndex]!.id,
      winnerIds: state.winnerIds,
      endReason: state.endReason,
    };
  },

  getPrivateState(state, playerId) {
    const p = state.players.find((x) => x.id === playerId);
    if (!p) return { hand: [], playableCardIds: [], canDraw: false };
    const myTurn = state.phase === "playing" && current(state).id === playerId;
    return {
      hand: p.hand,
      playableCardIds: playable(state, p.hand).map((c) => c.id),
      canDraw: myTurn && drawable(state) > 0,
    };
  },

  getAwaitedPlayerIds(state) {
    return state.phase === "playing" ? [current(state).id] : [];
  },

  getResult(state) {
    if (state.phase !== "finished") return null;
    const winners = new Set(state.winnerIds);
    const points = (p: (typeof state.players)[number]) => handPoints(p.hand);
    // Each winner collects the difference from every other player still at the
    // table. Going out, the winner's at zero, so that's just Bicycle's
    // "collect what's left in their hands".
    const losers = state.players.filter((p) => !p.removed && !winners.has(p.id));
    const rank = (p: (typeof state.players)[number]) => (winners.has(p.id) ? 0 : p.removed ? 2 : 1);
    return {
      winnerIds: state.winnerIds,
      standings: [...state.players]
        .sort((a, b) => rank(a) - rank(b) || points(a) - points(b))
        .map((p) => {
          const mine = points(p);
          const won = losers.reduce((sum, l) => sum + points(l) - mine, 0);
          const label = winners.has(p.id)
            ? state.endReason === "abandoned" ? "last one standing" : `+${won} pts`
            : p.removed ? "left" : `${mine} ${mine === 1 ? "pt" : "pts"} in hand`;
          return { playerId: p.id, value: p.hand.length, label };
        }),
    };
  },
};
