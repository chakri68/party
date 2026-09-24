import {
  shuffle,
  type GameDefinition,
  type GameEventEnvelope,
  type GameResult,
  type GameTransition,
} from "@games/game-core";
import { sevensManifest } from "../shared/manifest.ts";
import {
  compareCards,
  getPlayableCards,
  isBoardEmpty,
  makeDeck,
  parseCardId,
  placeCard,
  SEVEN_OF_DIAMONDS,
} from "../shared/rules.ts";
import {
  DEFAULT_SETTINGS,
  type Card,
  type SevensAction,
  type SevensEvent,
  type SevensPrivateState,
  type SevensPublicState,
  type SevensServerState,
  type SevensSettings,
} from "../shared/types.ts";

type State = SevensServerState;
type Transition = GameTransition<State, SevensEvent>;
type Events = GameEventEnvelope<SevensEvent>[];

const pub = (event: SevensEvent): GameEventEnvelope<SevensEvent> => ({ visibility: { kind: "public" }, event });

const reject = (code: string, message: string): GameResult<State, SevensEvent> => ({
  ok: false,
  error: { code, message },
});

// ---------------------------------------------------------------------------
// Internals. Each helper takes a state it may mutate: callers always pass a
// fresh clone (see `clone`), which keeps the public API pure.
// ---------------------------------------------------------------------------

function clone(state: State): State {
  return structuredClone(state);
}

function current(state: State) {
  return state.players[state.turnIndex]!;
}

function activeCount(state: State): number {
  return state.players.filter((p) => !p.removed).length;
}

function playable(state: State, hand: readonly Card[]): Card[] {
  return getPlayableCards(hand, state.board, state.settings.startingRule);
}

function finish(state: State, winnerId: string | null, events: Events): void {
  state.phase = "finished";
  state.winnerId = winnerId;
  events.push(pub({ type: "game-over", winnerId }));
}

/**
 * Removed players' cards go down the moment they become playable. Loops because
 * each placement can unlock the next card (§12.1).
 */
function placeGhostCards(state: State, events: Events): void {
  for (let placed = true; placed; ) {
    placed = false;
    for (const p of state.players) {
      if (!p.removed) continue;
      for (const card of playable(state, p.hand)) {
        p.hand = p.hand.filter((c) => c.id !== card.id);
        state.board = placeCard(state.board, card);
        events.push(pub({ type: "ghost-card-placed", playerId: p.id, card }));
        placed = true;
      }
    }
  }
}

/**
 * Hands the turn to the next active player who can move, auto-passing anyone who
 * can't. `includeCurrent` checks the current seat first (used at game start and
 * when the current player was just removed).
 */
function advanceTurn(state: State, events: Events, includeCurrent = false): void {
  const n = state.players.length;
  const from = state.turnIndex;
  // Two full laps is generous: with all 52 cards dealt someone can always move
  // (§13.2 no-deadlock). Hitting the bound means a rules bug, not a game state.
  for (let step = includeCurrent ? 0 : 1; step <= 2 * n; step++) {
    const idx = (from + step) % n;
    const p = state.players[idx]!;
    if (p.removed) continue;
    state.turnIndex = idx;
    state.turnNumber++;
    if (playable(state, p.hand).length > 0 || !state.settings.forcedPlay) return;
    events.push(pub({ type: "passed", playerId: p.id, auto: true }));
  }
  throw new Error("sevens: no player can move — deadlock invariant violated");
}

/** Shared tail for every transition that changes the board or the seating. */
function settle(state: State, events: Events, includeCurrent = false): Transition {
  if (state.phase === "playing") {
    placeGhostCards(state, events);
    advanceTurn(state, events, includeCurrent);
  }
  return { state, events };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function parseSettings(input: unknown): SevensSettings | null {
  if (input === undefined || input === null) return { ...DEFAULT_SETTINGS };
  if (typeof input !== "object" || Array.isArray(input)) return null;
  const s = { ...DEFAULT_SETTINGS, ...(input as Partial<SevensSettings>) };
  const ok =
    (s.startingRule === "dealer-left" || s.startingRule === "seven-of-diamonds") &&
    (s.acePosition === "high" || s.acePosition === "low") &&
    typeof s.forcedPlay === "boolean" &&
    (s.scoring === "winner-only" || s.scoring === "remaining-cards");
  return ok
    ? { startingRule: s.startingRule, acePosition: s.acePosition, forcedPlay: s.forcedPlay, scoring: s.scoring }
    : null;
}

function parseAction(input: unknown): SevensAction | null {
  if (typeof input !== "object" || input === null) return null;
  const a = input as Record<string, unknown>;
  if (a.type === "pass") return { type: "pass" };
  if (a.type === "play-card" && typeof a.cardId === "string" && a.cardId.length <= 16) {
    return { type: "play-card", cardId: a.cardId };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Definition
// ---------------------------------------------------------------------------

export const sevensGame: GameDefinition<
  SevensServerState,
  SevensAction,
  SevensPublicState,
  SevensPrivateState,
  SevensSettings,
  SevensEvent
> = {
  manifest: sevensManifest,
  defaultSettings: DEFAULT_SETTINGS,
  parseSettings,
  parseAction,

  createGame(players, settings, match, ctx, options) {
    const n = players.length;
    if (n < sevensManifest.minPlayers || n > sevensManifest.maxPlayers) {
      throw new Error(`sevens: needs ${sevensManifest.minPlayers}–${sevensManifest.maxPlayers} players, got ${n}`);
    }
    const deck = (options?.deck as Card[] | undefined) ?? shuffle(makeDeck(settings.acePosition), ctx.randomInt);
    const dealerIndex = ((match.dealerSeat % n) + n) % n;

    // Deal clockwise, starting left of the dealer.
    const hands: Card[][] = players.map(() => []);
    deck.forEach((card, i) => hands[(dealerIndex + 1 + i) % n]!.push(card));

    let turnIndex = (dealerIndex + 1) % n;
    if (settings.startingRule === "seven-of-diamonds") {
      const holder = hands.findIndex((h) => h.some((c) => c.id === SEVEN_OF_DIAMONDS));
      if (holder >= 0) turnIndex = holder;
    }

    const state: State = {
      phase: "playing",
      settings,
      players: players.map((p, i) => ({ id: p.id, hand: hands[i]!.sort(compareCards), removed: false })),
      board: { spades: null, hearts: null, diamonds: null, clubs: null },
      dealerIndex,
      turnIndex,
      winnerId: null,
      turnNumber: 0,
    };

    const events: Events = [
      pub({
        type: "dealt",
        dealerId: players[dealerIndex]!.id,
        handSizes: Object.fromEntries(state.players.map((p) => [p.id, p.hand.length])),
      }),
    ];
    return settle(state, events, true);
  },

  handleAction(prev, playerId, action) {
    if (prev.phase !== "playing") return reject("game-finished", "The game is over.");
    const seat = prev.players.findIndex((p) => p.id === playerId);
    if (seat < 0 || prev.players[seat]!.removed) return reject("not-in-game", "You're not in this game.");
    if (seat !== prev.turnIndex) return reject("not-your-turn", "It's not your turn.");

    const state = clone(prev);
    const me = current(state);
    const events: Events = [];

    if (action.type === "pass") {
      if (state.settings.forcedPlay && playable(state, me.hand).length > 0) {
        return reject("must-play", "You have a card you can play.");
      }
      events.push(pub({ type: "passed", playerId, auto: false }));
      return { ok: true, transition: settle(state, events) };
    }

    const card = me.hand.find((c) => c.id === action.cardId);
    if (!card) {
      return parseCardId(action.cardId, state.settings.acePosition)
        ? reject("card-not-owned", "You don't have that card.")
        : reject("bad-card", "That isn't a card.");
    }
    if (!playable(state, [card]).length) {
      const mustOpen = state.settings.startingRule === "seven-of-diamonds" && isBoardEmpty(state.board);
      return reject("illegal-play", mustOpen ? "The seven of diamonds goes first." : "That card can't go down yet.");
    }

    me.hand = me.hand.filter((c) => c.id !== card.id);
    state.board = placeCard(state.board, card);
    events.push(pub({ type: "card-played", playerId, card }));

    if (me.hand.length === 0) {
      finish(state, playerId, events);
      return { ok: true, transition: { state, events } };
    }
    return { ok: true, transition: settle(state, events) };
  },

  skipTurn(prev, playerId) {
    if (prev.phase !== "playing" || current(prev).id !== playerId) return { state: prev, events: [] };
    const state = clone(prev);
    // Host skips are exempt from forced play (§12.2).
    return settle(state, [pub({ type: "turn-skipped", playerId })]);
  },

  onPlayerRemoved(prev, playerId) {
    const idx = prev.players.findIndex((p) => p.id === playerId);
    if (prev.phase !== "playing" || idx < 0 || prev.players[idx]!.removed) return { state: prev, events: [] };

    const state = clone(prev);
    state.players[idx]!.removed = true;
    const events: Events = [pub({ type: "player-removed", playerId })];

    if (activeCount(state) < 2) {
      finish(state, state.players.find((p) => !p.removed)?.id ?? null, events);
      return { state, events };
    }
    // Their turn → move on. Someone else's turn → they keep it (ghosts only add
    // options, but re-checking is cheaper than proving that at 1am).
    const wasTheirTurn = idx === state.turnIndex;
    placeGhostCards(state, events);
    advanceTurn(state, events, !wasTheirTurn);
    return { state, events };
  },

  getPublicState(state) {
    return {
      players: state.players.map((p) => ({ id: p.id, cardCount: p.hand.length, removed: p.removed })),
      board: state.board,
      currentPlayerId: state.phase === "playing" ? current(state).id : null,
      dealerId: state.players[state.dealerIndex]!.id,
      winnerId: state.winnerId,
      acePosition: state.settings.acePosition,
    };
  },

  getPrivateState(state, playerId) {
    const p = state.players.find((x) => x.id === playerId);
    if (!p) return { hand: [], playableCardIds: [], canPass: false };
    const myTurn = state.phase === "playing" && current(state).id === playerId;
    const legal = playable(state, p.hand);
    return {
      hand: p.hand,
      playableCardIds: legal.map((c) => c.id),
      canPass: myTurn && (!state.settings.forcedPlay || legal.length === 0),
    };
  },

  getAwaitedPlayerIds(state) {
    return state.phase === "playing" ? [current(state).id] : [];
  },

  getResult(state) {
    if (state.phase !== "finished") return null;
    // Winner first, then whoever's left by cards remaining, then leavers — whose
    // ghost cards shrink their hands without them earning it.
    const rank = (p: (typeof state.players)[number]) => (p.id === state.winnerId ? 0 : p.removed ? 2 : 1);
    return {
      winnerIds: state.winnerId ? [state.winnerId] : [],
      standings: [...state.players]
        .sort((a, b) => rank(a) - rank(b) || a.hand.length - b.hand.length)
        .map((p) => ({ playerId: p.id, value: p.hand.length })),
    };
  },
};
