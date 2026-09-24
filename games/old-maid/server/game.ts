import {
  shuffle,
  type GameContext,
  type GameDefinition,
  type GameEventEnvelope,
  type GameResult,
  type GameTransition,
} from "@games/game-core";
import { oldMaidManifest } from "../shared/manifest.ts";
import { compareCards, makeDeck, ordinal, pairOff, parseCardId, rankName } from "../shared/rules.ts";
import {
  DEFAULT_SETTINGS,
  type Card,
  type EndReason,
  type OldMaidAction,
  type OldMaidEvent,
  type OldMaidPlayerState,
  type OldMaidPrivateState,
  type OldMaidPublicState,
  type OldMaidServerState,
  type OldMaidSettings,
} from "../shared/types.ts";

type State = OldMaidServerState;
type Player = OldMaidPlayerState;
type Transition = GameTransition<State, OldMaidEvent>;
type Events = GameEventEnvelope<OldMaidEvent>[];

const pub = (event: OldMaidEvent): GameEventEnvelope<OldMaidEvent> => ({ visibility: { kind: "public" }, event });
const only = (playerId: string, event: OldMaidEvent): GameEventEnvelope<OldMaidEvent> => ({
  visibility: { kind: "private", playerId },
  event,
});

const reject = (code: string, message: string): GameResult<State, OldMaidEvent> => ({
  ok: false,
  error: { code, message },
});

// ---------------------------------------------------------------------------
// Internals. Each helper takes a state it may mutate: callers always pass a
// fresh clone, which keeps the public API pure.
// ---------------------------------------------------------------------------

const clone = (state: State): State => structuredClone(state);

/** Still in it: seated and holding cards. Everyone else is out (or gone). */
const holding = (p: Player) => !p.removed && p.hand.length > 0;

function holders(state: State): Player[] {
  return state.players.filter(holding);
}

/**
 * The nearest seat still holding cards, stepping `dir` from `from`. `from`
 * itself only counts with `includeFrom`. -1 if there's nobody.
 */
function nextHolder(state: State, from: number, dir: 1 | -1, includeFrom = false): number {
  const n = state.players.length;
  for (let step = includeFrom ? 0 : 1; step < n; step++) {
    const idx = (((from + dir * step) % n) + n) % n;
    if (holding(state.players[idx]!)) return idx;
  }
  return -1;
}

/** The fan the current player picks from: the nearest holder on their right. */
function sourceIndex(state: State): number {
  return nextHolder(state, state.turnIndex, -1);
}

function cardName(c: Card): string {
  return c.suit === "joker" ? "the joker" : `the ${rankName(c.rank)} of ${c.suit[0]!.toUpperCase()}${c.suit.slice(1)}`;
}

/** Puts down every pair in the hand, face up. */
function discardPairs(state: State, p: Player, events: Events): void {
  const { pairs, rest } = pairOff(p.hand);
  if (!pairs.length) return;
  p.hand = rest;
  state.discard.push(...pairs.flat());
  events.push(pub({ type: "discarded", playerId: p.id, pairs }));
}

function checkOut(state: State, p: Player, events: Events): void {
  if (p.removed || p.hand.length || state.outOrder.includes(p.id)) return;
  state.outOrder.push(p.id);
  events.push(pub({ type: "went-out", playerId: p.id, place: state.outOrder.length }));
}

/**
 * One holder left means the game's decided: they have the odd card. After a
 * leaver, it's decided by default, so nobody's pinned with the loss.
 */
function finish(state: State, reason: EndReason, events: Events): void {
  const last = holders(state);
  state.phase = "finished";
  state.endReason = reason;
  state.loserId = reason === "done" && last.length === 1 ? last[0]!.id : null;
  events.push(pub({ type: "game-over", loserId: state.loserId, reason }));
}

/** Shared tail: end it, or hand the turn to the next holder from `from`. */
function settle(state: State, events: Events, from: number, includeFrom = false, reason: EndReason = "done"): Transition {
  if (state.phase === "playing") {
    if (holders(state).length < 2) finish(state, reason, events);
    else {
      state.turnIndex = nextHolder(state, from, 1, includeFrom);
      state.turnNumber++;
    }
  }
  return { state, events };
}

/** The current player takes the card at `slot` from their source's fan. */
function take(state: State, slot: number, ctx: GameContext, events: Events): Transition {
  const me = state.players[state.turnIndex]!;
  const src = state.players[sourceIndex(state)]!;
  const [card] = src.hand.splice(slot, 1);
  // Shuffled in, so its position tells the next taker nothing.
  me.hand = shuffle([...me.hand, card!], ctx.randomInt);
  events.push(
    pub({ type: "took", playerId: me.id, fromId: src.id, slot }),
    only(me.id, { type: "you-took", card: card!, fromId: src.id }),
    only(src.id, { type: "taken-from-you", card: card!, byId: me.id }),
  );
  // Losing your last card gets you out before the taker's pair does.
  checkOut(state, src, events);
  discardPairs(state, me, events);
  checkOut(state, me, events);
  return settle(state, events, state.turnIndex);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Injected decks (tests, dev tools) may be Cards or card ids, dealt in order
 * from the dealer's left. Exactly the cards of the chosen deck, each once.
 */
function normalizeDeck(input: unknown[], settings: OldMaidSettings): Card[] {
  const cards = input.map((c) => (typeof c === "string" ? parseCardId(c) : (c as Card)));
  const want = new Set(makeDeck(settings.oldMaid).map((c) => c.id));
  const ids = new Set(cards.map((c) => c?.id));
  if (cards.length !== want.size || ids.size !== want.size || ![...ids].every((id) => id && want.has(id))) {
    throw new Error(
      settings.oldMaid === "queen"
        ? "A deck must be the 52 cards minus the queen of clubs, each once (e.g. \"hearts-8\")."
        : "A deck must be the 52 cards plus \"joker\", each once (e.g. \"hearts-8\").",
    );
  }
  return cards as Card[];
}

function parseSettings(input: unknown): OldMaidSettings | null {
  if (input === undefined || input === null) return { ...DEFAULT_SETTINGS };
  if (typeof input !== "object" || Array.isArray(input)) return null;
  const s = { ...DEFAULT_SETTINGS, ...(input as Partial<OldMaidSettings>) };
  return s.oldMaid === "queen" || s.oldMaid === "joker" ? { oldMaid: s.oldMaid } : null;
}

function parseAction(input: unknown): OldMaidAction | null {
  if (typeof input !== "object" || input === null) return null;
  const a = input as Record<string, unknown>;
  if (a.type === "take" && Number.isInteger(a.slot) && (a.slot as number) >= 0 && (a.slot as number) < 64) {
    return { type: "take", slot: a.slot as number };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Definition
// ---------------------------------------------------------------------------

export const oldMaidGame: GameDefinition<
  OldMaidServerState,
  OldMaidAction,
  OldMaidPublicState,
  OldMaidPrivateState,
  OldMaidSettings,
  OldMaidEvent
> = {
  manifest: oldMaidManifest,
  defaultSettings: DEFAULT_SETTINGS,
  parseSettings,
  parseAction,

  createGame(players, settings, match, ctx, options) {
    const n = players.length;
    const { minPlayers, maxPlayers } = oldMaidManifest;
    if (n < minPlayers || n > maxPlayers) {
      throw new Error(`old-maid: needs ${minPlayers}–${maxPlayers} players, got ${n}`);
    }
    const deck = options?.deck ? normalizeDeck(options.deck, settings) : shuffle(makeDeck(settings.oldMaid), ctx.randomInt);
    const dealerIndex = ((match.dealerSeat % n) + n) % n;

    // The whole deck, one at a time, clockwise from the dealer's left.
    const hands: Card[][] = players.map(() => []);
    deck.forEach((card, i) => hands[(dealerIndex + 1 + i) % n]!.push(card));

    const state: State = {
      phase: "playing",
      settings,
      players: players.map((p, i) => ({ id: p.id, hand: hands[i]!, removed: false })),
      dealerIndex,
      turnIndex: dealerIndex,
      turnNumber: 0,
      discard: [],
      outOrder: [],
      loserId: null,
      endReason: null,
    };

    const events: Events = [
      pub({
        type: "dealt",
        dealerId: players[dealerIndex]!.id,
        handSizes: Object.fromEntries(state.players.map((p) => [p.id, p.hand.length])),
      }),
    ];
    // Everyone lays down their pairs, starting on the dealer's left.
    for (let i = 1; i <= n; i++) discardPairs(state, state.players[(dealerIndex + i) % n]!, events);
    for (let i = 1; i <= n; i++) checkOut(state, state.players[(dealerIndex + i) % n]!, events);
    return settle(state, events, dealerIndex);
  },

  handleAction(prev, playerId, action, ctx) {
    if (prev.phase !== "playing") return reject("game-finished", "The game is over.");
    const seat = prev.players.findIndex((p) => p.id === playerId);
    if (seat < 0 || prev.players[seat]!.removed) return reject("not-in-game", "You're not in this game.");
    if (seat !== prev.turnIndex) return reject("not-your-turn", "It's not your turn.");

    const src = prev.players[sourceIndex(prev)]!;
    if (action.slot >= src.hand.length) return reject("bad-slot", "That card isn't there any more.");
    return { ok: true, transition: take(clone(prev), action.slot, ctx, []) };
  },

  /** A skipped player doesn't sit out: the host's nudge takes a card for them. */
  skipTurn(prev, playerId, ctx) {
    if (prev.phase !== "playing" || prev.players[prev.turnIndex]!.id !== playerId) return { state: prev, events: [] };
    const state = clone(prev);
    const slot = ctx.randomInt(state.players[sourceIndex(state)]!.hand.length);
    return take(state, slot, ctx, [pub({ type: "turn-skipped", playerId })]);
  },

  onPlayerRemoved(prev, playerId, ctx) {
    const idx = prev.players.findIndex((p) => p.id === playerId);
    if (prev.phase !== "playing" || idx < 0 || prev.players[idx]!.removed) return { state: prev, events: [] };

    const state = clone(prev);
    const leaver = state.players[idx]!;
    const cards = leaver.hand;
    const wasHolding = cards.length > 0;
    leaver.removed = true;
    leaver.hand = [];

    // Their cards go to whoever would have taken from them next. The Old Maid
    // might be in there, so dropping them isn't an option.
    const to = wasHolding ? nextHolder(state, idx, 1) : -1;
    const recipient = to >= 0 ? state.players[to]! : null;
    const events: Events = [pub({ type: "player-removed", playerId, toId: recipient?.id ?? null })];
    if (recipient) {
      recipient.hand = shuffle([...recipient.hand, ...cards], ctx.randomInt);
      discardPairs(state, recipient, events);
      checkOut(state, recipient, events);
    }
    return settle(state, events, state.turnIndex, idx !== state.turnIndex, "abandoned");
  },

  getPublicState(state) {
    const playing = state.phase === "playing";
    const loser = state.players.find((p) => p.id === state.loserId);
    return {
      players: state.players.map((p) => {
        const out = state.outOrder.indexOf(p.id);
        return { id: p.id, cardCount: p.hand.length, removed: p.removed, outPlace: out < 0 ? null : out + 1 };
      }),
      currentPlayerId: playing ? state.players[state.turnIndex]!.id : null,
      sourceId: playing ? state.players[sourceIndex(state)]!.id : null,
      dealerId: state.players[state.dealerIndex]!.id,
      discardCount: state.discard.length,
      lastPair: state.discard.length ? state.discard.slice(-2) : null,
      oldMaid: state.settings.oldMaid,
      loserId: state.loserId,
      loserCard: loser?.hand[0] ?? null,
      endReason: state.endReason,
    };
  },

  getPrivateState(state, playerId) {
    const p = state.players.find((x) => x.id === playerId);
    if (!p) return { hand: [], canTake: false };
    const myTurn = state.phase === "playing" && state.players[state.turnIndex]!.id === playerId;
    return { hand: [...p.hand].sort(compareCards), canTake: myTurn };
  },

  getAwaitedPlayerIds(state) {
    return state.phase === "playing" ? [state.players[state.turnIndex]!.id] : [];
  },

  getResult(state) {
    if (state.phase !== "finished") return null;
    // Out first in the order they got out, then whoever was still holding, then leavers.
    const rank = (p: Player) => {
      const out = state.outOrder.indexOf(p.id);
      return p.removed ? 1000 : out >= 0 ? out : 100 + p.hand.length;
    };
    const seated = state.players.filter((p) => !p.removed);
    return {
      // Everyone who isn't stuck with it got away. An abandoned game has no verdict.
      winnerIds: state.loserId ? seated.filter((p) => p.id !== state.loserId).map((p) => p.id) : [],
      loserIds: state.loserId ? [state.loserId] : [],
      standings: [...state.players]
        .sort((a, b) => rank(a) - rank(b))
        .map((p) => {
          const out = state.outOrder.indexOf(p.id);
          const label = p.removed
            ? "left"
            : p.id === state.loserId
              ? `stuck with ${cardName(p.hand[0]!)}`
              : out >= 0
                ? `out ${ordinal(out + 1)}`
                : `holding ${p.hand.length}`;
          return { playerId: p.id, value: p.hand.length, label };
        }),
    };
  },
};
