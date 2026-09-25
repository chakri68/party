import {
  shuffle,
  type GameDefinition,
  type GameEventEnvelope,
  type GameResult,
  type GameTransition,
} from "@games/game-core";
import { goFishManifest } from "../shared/manifest.ts";
import { compareCards, handSize, makeDeck, parseCardId, rankPlural, ranksHeld, takeBooks } from "../shared/rules.ts";
import {
  DEFAULT_SETTINGS,
  RANKS,
  REFILL,
  type AskOutcome,
  type Card,
  type EndReason,
  type GoFishAction,
  type GoFishEvent,
  type GoFishPlayerState,
  type GoFishPrivateState,
  type GoFishPublicState,
  type GoFishServerState,
  type GoFishSettings,
  type Rank,
} from "../shared/types.ts";

type State = GoFishServerState;
type Player = GoFishPlayerState;
type Transition = GameTransition<State, GoFishEvent>;
type Events = GameEventEnvelope<GoFishEvent>[];

const pub = (event: GoFishEvent): GameEventEnvelope<GoFishEvent> => ({ visibility: { kind: "public" }, event });
const only = (playerId: string, event: GoFishEvent): GameEventEnvelope<GoFishEvent> => ({
  visibility: { kind: "private", playerId },
  event,
});

const reject = (code: string, message: string): GameResult<State, GoFishEvent> => ({
  ok: false,
  error: { code, message },
});

/** How many asks the public state remembers. Enough to jog a memory, not replace one. */
const ASK_MEMORY = 8;

// ---------------------------------------------------------------------------
// Internals. Each helper takes a state it may mutate: callers always pass a
// fresh clone, which keeps the public API pure.
// ---------------------------------------------------------------------------

const clone = (state: State): State => structuredClone(state);

function current(state: State): Player {
  return state.players[state.turnIndex]!;
}

/** Seated and holding cards: can take a turn, and can be asked. */
const holding = (p: Player) => !p.removed && p.hand.length > 0;

function booksDown(state: State): number {
  return state.players.reduce((sum, p) => sum + p.books.length, 0);
}

/** Draws up to `count` off the top of the pond into `p`'s hand. Only `p` sees what. */
function draw(state: State, p: Player, count: number, events: Events, catchRank: Rank | null = null): Card[] {
  const cards = state.pond.splice(-Math.min(count, state.pond.length)).reverse();
  if (!cards.length) return cards;
  p.hand = [...p.hand, ...cards].sort(compareCards);
  const shown = catchRank !== null && cards[0]!.rank === catchRank ? cards[0]! : null;
  events.push(
    pub({ type: "drew", playerId: p.id, count: cards.length, shown, refill: catchRank === null }),
    only(p.id, { type: "you-drew", cards }),
  );
  return cards;
}

/**
 * After a hand changes: books go down, and an empty hand draws REFILL from
 * the pond. A refill can make a book too (and, off a tiny pond, empty the
 * hand again), hence the loop. Empty hand, empty pond: out for good.
 */
function tidy(state: State, p: Player, events: Events): void {
  if (p.removed) return;
  for (;;) {
    const { books, rest } = takeBooks(p.hand);
    for (const book of books) {
      const rank = book[0]!.rank;
      p.books.push(rank);
      state.lastBook = rank;
      events.push(pub({ type: "booked", playerId: p.id, rank, cards: book }));
    }
    p.hand = rest;
    if (p.hand.length) return;
    if (!state.pond.length) {
      // Game-ending books leave everyone empty; that's the end, not a sit-out.
      if (booksDown(state) < RANKS) events.push(pub({ type: "went-out", playerId: p.id }));
      return;
    }
    draw(state, p, REFILL, events);
  }
}

function finish(state: State, reason: EndReason, events: Events): void {
  const seated = state.players.filter((p) => !p.removed);
  const top = Math.max(0, ...seated.map((p) => p.books.length));
  state.phase = "finished";
  state.endReason = reason;
  // Ties share it. Nobody wins on zero books (everyone with books left).
  state.winnerIds = top > 0 ? seated.filter((p) => p.books.length === top).map((p) => p.id) : [];
  events.push(pub({ type: "game-over", winnerIds: state.winnerIds, reason }));
}

/**
 * Shared tail: end it, keep the turn (`again`, if they still hold cards), or
 * pass it to the next seat still holding. Someone always is: while books are
 * left, their cards are in the pond (and then every seated hand has cards) or
 * spread over at least two hands, since four of a rank in one would be a book.
 */
function settle(state: State, events: Events, again: boolean): Transition {
  if (state.phase !== "playing") return { state, events };
  if (booksDown(state) === RANKS) {
    finish(state, "done", events);
    return { state, events };
  }
  if (state.players.filter((p) => !p.removed).length < 2) {
    finish(state, "abandoned", events);
    return { state, events };
  }
  state.turnNumber++;
  if (again && holding(current(state))) return { state, events };
  const n = state.players.length;
  for (let step = 1; step <= n; step++) {
    const idx = (state.turnIndex + step) % n;
    if (holding(state.players[idx]!)) {
      state.turnIndex = idx;
      return { state, events };
    }
  }
  throw new Error("go-fish: books left but nobody holding cards");
}

function remember(state: State, ask: { playerId: string; targetId: string; rank: Rank }, got: number, outcome: AskOutcome): void {
  state.asks = [...state.asks, { ...ask, got, outcome }].slice(-ASK_MEMORY);
}

/** The whole turn: ask, then either take the cards or go fish. */
function ask(state: State, target: Player, rank: Rank, events: Events): Transition {
  const me = current(state);
  const heard = { playerId: me.id, targetId: target.id, rank };
  events.push(pub({ type: "asked", ...heard }));

  const given = target.hand.filter((c) => c.rank === rank);
  if (given.length) {
    target.hand = target.hand.filter((c) => c.rank !== rank);
    me.hand = [...me.hand, ...given].sort(compareCards);
    events.push(pub({ type: "handed", fromId: target.id, toId: me.id, cards: given }));
    remember(state, heard, given.length, "given");
    tidy(state, me, events);
    tidy(state, target, events);
    return settle(state, events, true);
  }

  events.push(pub({ type: "go-fish", playerId: target.id, askerId: me.id }));
  if (!state.pond.length) {
    remember(state, heard, 0, "dry");
    return settle(state, events, false);
  }
  const [card] = draw(state, me, 1, events, rank);
  const caught = card!.rank === rank;
  remember(state, heard, 0, caught ? "caught" : "fished");
  tidy(state, me, events);
  return settle(state, events, caught);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Injected decks (tests, dev tools) may be Cards or card ids, in deal order:
 * hands round-robin from the dealer's left, then the pond top-down. All 52,
 * each once.
 */
function normalizeDeck(input: unknown[]): Card[] {
  const cards = input.map((c) => (typeof c === "string" ? parseCardId(c) : (c as Card)));
  const valid = cards.every((c) => c && parseCardId(c.id));
  if (cards.length !== 52 || new Set(cards.map((c) => c?.id)).size !== 52 || !valid) {
    throw new Error("A deck must be exactly the 52 cards, each once (e.g. \"hearts-8\").");
  }
  return cards as Card[];
}

function parseSettings(input: unknown): GoFishSettings | null {
  if (input === undefined || input === null) return { ...DEFAULT_SETTINGS };
  if (typeof input !== "object" || Array.isArray(input)) return null;
  return { ...DEFAULT_SETTINGS };
}

function parseAction(input: unknown): GoFishAction | null {
  if (typeof input !== "object" || input === null) return null;
  const a = input as Record<string, unknown>;
  if (
    a.type === "ask" &&
    typeof a.targetId === "string" &&
    a.targetId.length <= 64 &&
    Number.isInteger(a.rank) &&
    (a.rank as number) >= 1 &&
    (a.rank as number) <= RANKS
  ) {
    return { type: "ask", targetId: a.targetId, rank: a.rank as number };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Definition
// ---------------------------------------------------------------------------

export const goFishGame: GameDefinition<
  GoFishServerState,
  GoFishAction,
  GoFishPublicState,
  GoFishPrivateState,
  GoFishSettings,
  GoFishEvent
> = {
  manifest: goFishManifest,
  defaultSettings: DEFAULT_SETTINGS,
  parseSettings,
  parseAction,

  createGame(players, settings, match, ctx, options) {
    const n = players.length;
    const { minPlayers, maxPlayers } = goFishManifest;
    if (n < minPlayers || n > maxPlayers) {
      throw new Error(`go-fish: needs ${minPlayers}–${maxPlayers} players, got ${n}`);
    }
    const deck = options?.deck ? normalizeDeck(options.deck) : shuffle(makeDeck(), ctx.randomInt);
    const dealerIndex = ((match.dealerSeat % n) + n) % n;
    const size = handSize(n);

    // One at a time, clockwise from the dealer's left.
    const hands: Card[][] = players.map(() => []);
    for (let i = 0; i < size * n; i++) hands[(dealerIndex + 1 + i) % n]!.push(deck[i]!);

    const state: State = {
      phase: "playing",
      settings,
      players: players.map((p, i) => ({ id: p.id, hand: hands[i]!.sort(compareCards), books: [], removed: false })),
      pond: deck.slice(size * n).reverse(), // top of the pond is the end
      dealerIndex,
      turnIndex: dealerIndex,
      turnNumber: 0,
      asks: [],
      lastBook: null,
      winnerIds: [],
      endReason: null,
    };

    const events: Events = [
      pub({
        type: "dealt",
        dealerId: players[dealerIndex]!.id,
        handSizes: Object.fromEntries(state.players.map((p) => [p.id, p.hand.length])),
        pondCount: state.pond.length,
      }),
    ];
    // A book dealt to you goes straight down, starting on the dealer's left.
    for (let i = 1; i <= n; i++) tidy(state, state.players[(dealerIndex + i) % n]!, events);
    // The dealer's left asks first.
    return settle(state, events, false);
  },

  handleAction(prev, playerId, action) {
    if (prev.phase !== "playing") return reject("game-finished", "The game is over.");
    const seat = prev.players.findIndex((p) => p.id === playerId);
    if (seat < 0 || prev.players[seat]!.removed) return reject("not-in-game", "You're not in this game.");
    if (seat !== prev.turnIndex) return reject("not-your-turn", "It's not your turn.");

    const target = prev.players.find((p) => p.id === action.targetId);
    if (!target) return reject("no-such-player", "There's nobody by that name here.");
    if (target.id === playerId) return reject("ask-yourself", "You can't ask yourself.");
    if (target.removed) return reject("player-left", "They've left the game.");
    if (!target.hand.length) return reject("nothing-to-ask", "They've got no cards to ask for.");
    if (!prev.players[seat]!.hand.some((c) => c.rank === action.rank)) {
      return reject("rank-not-held", `You can only ask for a rank you hold, and you've got no ${rankPlural(action.rank).toLowerCase()}.`);
    }

    const state = clone(prev);
    return { ok: true, transition: ask(state, state.players.find((p) => p.id === target.id)!, action.rank, []) };
  },

  /**
   * The skipped player just loses the turn. Nobody needs them to act to be
   * asked (handing over is automatic), so the game can't stall on them.
   */
  skipTurn(prev, playerId) {
    if (prev.phase !== "playing" || current(prev).id !== playerId) return { state: prev, events: [] };
    return settle(clone(prev), [pub({ type: "turn-skipped", playerId })], false);
  },

  onPlayerRemoved(prev, playerId, ctx) {
    const idx = prev.players.findIndex((p) => p.id === playerId);
    if (prev.phase !== "playing" || idx < 0 || prev.players[idx]!.removed) return { state: prev, events: [] };

    const state = clone(prev);
    const leaver = state.players[idx]!;
    const returned = leaver.hand.length;
    leaver.removed = true;
    // Back into the pond, shuffled. Handing them to a neighbour would be a
    // windfall for one seat, and dropping them would leave books that can
    // never be made. Their books stay down: those cards are out of play either way.
    state.pond = shuffle([...state.pond, ...leaver.hand], ctx.randomInt);
    leaver.hand = [];
    const events: Events = [pub({ type: "player-removed", playerId, returned })];

    // A pond that was empty isn't any more: whoever was sitting out draws back in.
    const n = state.players.length;
    for (let step = 0; step < n && state.pond.length; step++) tidy(state, state.players[(state.turnIndex + step) % n]!, events);
    return settle(state, events, idx !== state.turnIndex);
  },

  getPublicState(state) {
    return {
      players: state.players.map((p) => ({
        id: p.id,
        cardCount: p.hand.length,
        books: p.books,
        removed: p.removed,
        out: !p.removed && !p.hand.length && !state.pond.length && state.phase === "playing",
      })),
      currentPlayerId: state.phase === "playing" ? current(state).id : null,
      dealerId: state.players[state.dealerIndex]!.id,
      pondCount: state.pond.length,
      asks: state.asks,
      lastBook: state.lastBook,
      booksDown: booksDown(state),
      winnerIds: state.winnerIds,
      endReason: state.endReason,
    };
  },

  getPrivateState(state, playerId) {
    const p = state.players.find((x) => x.id === playerId);
    if (!p) return { hand: [], askableRanks: [] };
    const myTurn = state.phase === "playing" && current(state).id === playerId;
    return { hand: [...p.hand].sort(compareCards), askableRanks: myTurn ? ranksHeld(p.hand) : [] };
  },

  getAwaitedPlayerIds(state) {
    return state.phase === "playing" ? [current(state).id] : [];
  },

  getResult(state) {
    if (state.phase !== "finished") return null;
    // Most books first; leavers last, whatever they'd made.
    const rank = (p: Player) => (p.removed ? 100 : 0) - p.books.length;
    return {
      winnerIds: state.winnerIds,
      standings: [...state.players]
        .sort((a, b) => rank(a) - rank(b))
        .map((p) => {
          const n = p.books.length;
          const label = p.removed ? "left" : `${n} ${n === 1 ? "book" : "books"}`;
          return { playerId: p.id, value: n, label };
        }),
    };
  },
};
