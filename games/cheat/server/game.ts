import {
  shuffle,
  type GameContext,
  type GameDefinition,
  type GameEventEnvelope,
  type GameResult,
  type TimerRequest,
} from "@games/game-core";
import { cheatManifest } from "../shared/manifest.ts";
import { allowedClaims, compareCards, isHonest, makeDeck, parseCardId, resolveDecks } from "../shared/rules.ts";
import {
  DEFAULT_SETTINGS,
  MAX_DECKS,
  MAX_PLAY,
  WINDOW_SECONDS_OPTIONS,
  type Card,
  type CheatAction,
  type CheatEvent,
  type CheatPlayerState,
  type CheatPrivateState,
  type CheatPublicState,
  type CheatServerState,
  type CheatSettings,
  type EndReason,
  type Rank,
} from "../shared/types.ts";

type State = CheatServerState;
type Player = CheatPlayerState;
type Events = GameEventEnvelope<CheatEvent>[];

const pub = (event: CheatEvent): GameEventEnvelope<CheatEvent> => ({ visibility: { kind: "public" }, event });
const only = (playerId: string, event: CheatEvent): GameEventEnvelope<CheatEvent> => ({
  visibility: { kind: "private", playerId },
  event,
});

const reject = (code: string, message: string): GameResult<State, CheatEvent> => ({
  ok: false,
  error: { code, message },
});

/** One timer, reused: the call window after each play. */
const WINDOW = "window";

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

const inGame = (p: Player) => !p.removed;

function current(state: State): Player {
  return state.players[state.turnIndex]!;
}

/** Everyone who could call the play on top: still seated, and not the one who made it. */
function callers(state: State): Player[] {
  return state.players.filter((p) => inGame(p) && p.id !== state.lastPlay?.playerId);
}

/**
 * Nobody left who might call: they've all let it go, or dropped out. No
 * point running the clock down on an empty room.
 */
function nobodyLeftToCall(state: State): boolean {
  return callers(state).every((p) => p.away || state.passed.includes(p.id));
}

function finish(state: State, winnerId: string | null, reason: EndReason, out: Out): void {
  state.phase = "finished";
  state.winnerId = winnerId;
  state.endReason = reason;
  out.timers.push({ kind: "cancel", timerId: WINDOW });
  out.events.push(pub({ type: "game-over", winnerId, reason }));
}

/** The turn goes to the next seated player after seat `from`. */
function advance(state: State, from: number): void {
  const n = state.players.length;
  for (let step = 1; step <= n; step++) {
    const idx = (from + step) % n;
    if (inGame(state.players[idx]!)) {
      state.turnIndex = idx;
      break;
    }
  }
  state.step = "play";
  state.turnNumber++;
  state.passed = [];
}

/** Cards go down face down; the window opens for everyone else. */
function play(state: State, cards: Card[], claim: Rank, ctx: GameContext, out: Out): void {
  const me = current(state);
  const ids = new Set(cards.map((c) => c.id));
  me.hand = me.hand.filter((c) => !ids.has(c.id));
  state.pile.push(...cards);
  state.lastPlay = { playerId: me.id, cards, claim };
  state.lastClaim = claim;
  state.lastReveal = null;
  state.passed = [];
  state.step = "window";
  state.windowMs = state.settings.windowSeconds * 1000;
  state.windowEndsAt = ctx.now + state.windowMs;
  out.timers.push({ kind: "set", timerId: WINDOW, delayMs: state.windowMs });
  out.events.push(
    pub({ type: "played", playerId: me.id, count: cards.length, claim }),
    only(me.id, { type: "you-played", cards }),
  );
  if (nobodyLeftToCall(state)) accept(state, out);
}

/** Nobody called it. An empty hand now stands; otherwise play moves on. */
function accept(state: State, out: Out): void {
  const owner = current(state);
  out.timers.push({ kind: "cancel", timerId: WINDOW });
  out.events.push(pub({ type: "accepted", playerId: owner.id }));
  if (!owner.hand.length) finish(state, owner.id, "out", out);
  else advance(state, state.turnIndex);
}

/** "Cheat!" The play flips; whoever was wrong takes the lot. */
function call(state: State, caller: Player, out: Out): void {
  const owner = current(state);
  const { cards, claim } = state.lastPlay!;
  const lied = !isHonest(cards, claim);
  const taker = lied ? owner : caller;
  const taken = state.pile.length;
  taker.hand.push(...state.pile);
  state.pile = [];
  state.lastPlay = null;
  state.lastReveal = { callerId: caller.id, playerId: owner.id, claim, cards, lied, takerId: taker.id, taken };
  out.timers.push({ kind: "cancel", timerId: WINDOW });
  out.events.push(pub({ type: "called", ...state.lastReveal }));
  // A last play that was true wins, call or no call.
  if (!owner.hand.length) finish(state, owner.id, "out", out);
  else advance(state, state.turnIndex);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Injected decks (tests, dev tools) may be Cards or card ids, dealt in order
 * from the dealer's left. Every card of every deck exactly once.
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

function parseSettings(input: unknown): CheatSettings | null {
  if (input === undefined || input === null) return { ...DEFAULT_SETTINGS };
  if (typeof input !== "object" || Array.isArray(input)) return null;
  const s = { ...DEFAULT_SETTINGS, ...(input as Partial<CheatSettings>) };
  const ok =
    (s.decks === "auto" || (Number.isInteger(s.decks) && s.decks >= 1 && s.decks <= MAX_DECKS)) &&
    (s.claims === "strict" || s.claims === "near") &&
    (WINDOW_SECONDS_OPTIONS as readonly unknown[]).includes(s.windowSeconds);
  return ok ? { decks: s.decks, claims: s.claims, windowSeconds: s.windowSeconds } : null;
}

function parseAction(input: unknown): CheatAction | null {
  if (typeof input !== "object" || input === null) return null;
  const a = input as Record<string, unknown>;
  if (a.type === "call") return { type: "call" };
  if (a.type === "pass") return { type: "pass" };
  if (a.type !== "play" || !Array.isArray(a.cardIds)) return null;
  const ids = a.cardIds as unknown[];
  if (ids.length < 1 || ids.length > MAX_PLAY || !ids.every((id) => typeof id === "string" && id.length <= 16)) return null;
  if (a.claim === undefined) return { type: "play", cardIds: ids as string[] };
  if (Number.isInteger(a.claim) && (a.claim as number) >= 1 && (a.claim as number) <= 13) {
    return { type: "play", cardIds: ids as string[], claim: a.claim as number };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Definition
// ---------------------------------------------------------------------------

export const cheatGame: GameDefinition<
  CheatServerState,
  CheatAction,
  CheatPublicState,
  CheatPrivateState,
  CheatSettings,
  CheatEvent
> = {
  manifest: cheatManifest,
  defaultSettings: DEFAULT_SETTINGS,
  parseSettings,
  parseAction,

  createGame(players, settings, match, ctx, options) {
    const n = players.length;
    const { minPlayers, maxPlayers } = cheatManifest;
    if (n < minPlayers || n > maxPlayers) {
      throw new Error(`cheat: needs ${minPlayers}–${maxPlayers} players, got ${n}`);
    }
    const decks = resolveDecks(settings.decks, n);
    const deck = options?.deck ? normalizeDeck(options.deck, decks) : shuffle(makeDeck(decks), ctx.randomInt);
    const dealerIndex = ((match.dealerSeat % n) + n) % n;

    // The whole deck, one at a time, clockwise from the dealer's left.
    const hands: Card[][] = players.map(() => []);
    deck.forEach((card, i) => hands[(dealerIndex + 1 + i) % n]!.push(card));

    const state: State = {
      phase: "playing",
      step: "play",
      settings,
      players: players.map((p, i) => ({ id: p.id, hand: hands[i]!, removed: false, away: false })),
      decks,
      dealerIndex,
      turnIndex: (dealerIndex + 1) % n,
      turnNumber: 0,
      pile: [],
      lastPlay: null,
      lastClaim: null,
      windowEndsAt: 0,
      windowMs: 0,
      passed: [],
      lastReveal: null,
      winnerId: null,
      endReason: null,
    };
    const events: Events = [
      pub({
        type: "dealt",
        dealerId: players[dealerIndex]!.id,
        decks,
        handSizes: Object.fromEntries(state.players.map((p) => [p.id, p.hand.length])),
      }),
    ];
    return { state, events };
  },

  handleAction(prev, playerId, action, ctx) {
    if (prev.phase !== "playing") return reject("game-finished", "The game is over.");
    const seat = prev.players.findIndex((p) => p.id === playerId);
    if (seat < 0 || prev.players[seat]!.removed) return reject("not-in-game", "You're not in this game.");
    const owner = prev.lastPlay?.playerId;

    switch (action.type) {
      case "play": {
        if (prev.step !== "play") return reject("window-open", "Hang on: the last play can still be called.");
        if (seat !== prev.turnIndex) return reject("not-your-turn", "It's not your turn.");
        const hand = prev.players[seat]!.hand;
        const cards = action.cardIds.map((id) => hand.find((c) => c.id === id));
        if (new Set(action.cardIds).size !== action.cardIds.length || cards.some((c) => !c)) {
          return reject("card-not-owned", "You don't have that card.");
        }
        const allowed = allowedClaims(prev.lastClaim, prev.settings.claims);
        const claim = action.claim ?? (allowed.length === 1 ? allowed[0] : undefined);
        if (claim === undefined || !allowed.includes(claim)) return reject("bad-claim", "You can't claim that rank now.");
        const state = clone(prev);
        const out = newOut();
        play(state, cards as Card[], claim, ctx, out);
        return { ok: true, transition: done(state, out) };
      }
      case "call":
      case "pass": {
        // After a call the step's back to "play": whoever called second was too slow.
        if (prev.step !== "window") return reject("too-late", "Too late: that play's already settled.");
        if (playerId === owner) return reject("own-play", "That's your own play.");
        if (prev.passed.includes(playerId)) return reject("passed", "You already let that one go.");
        const state = clone(prev);
        const out = newOut();
        if (action.type === "call") call(state, state.players[seat]!, out);
        else {
          state.passed.push(playerId);
          out.events.push(pub({ type: "passed", playerId }));
          if (nobodyLeftToCall(state)) accept(state, out);
        }
        return { ok: true, transition: done(state, out) };
      }
    }
  },

  onTimer(prev, timerId) {
    if (prev.phase !== "playing" || prev.step !== "window" || timerId !== WINDOW) return { state: prev, events: [] };
    const state = clone(prev);
    const out = newOut();
    accept(state, out);
    return done(state, out);
  },

  /**
   * The host moves an idle player along with one card: a true one if they
   * hold any rank they could claim, otherwise a random card and a lie.
   */
  skipTurn(prev, playerId, ctx) {
    if (prev.phase !== "playing" || prev.step !== "play" || current(prev).id !== playerId) return { state: prev, events: [] };
    const state = clone(prev);
    const out = newOut([pub({ type: "turn-skipped", playerId })]);
    const hand = current(state).hand;
    const allowed = allowedClaims(state.lastClaim, state.settings.claims);
    const honest = hand.filter((c) => allowed.includes(c.rank));
    const card = honest.length ? honest[ctx.randomInt(honest.length)]! : hand[ctx.randomInt(hand.length)]!;
    const claim = allowed.includes(card.rank) ? card.rank : allowed[ctx.randomInt(allowed.length)]!;
    play(state, [card], claim, ctx, out);
    return done(state, out);
  },

  onPlayerDisconnected(prev, playerId) {
    const idx = prev.players.findIndex((p) => p.id === playerId);
    if (prev.phase !== "playing" || idx < 0 || prev.players[idx]!.away) return { state: prev, events: [] };
    const state = clone(prev);
    const out = newOut();
    state.players[idx]!.away = true;
    // They were the last one who might have called it.
    if (state.step === "window" && nobodyLeftToCall(state)) accept(state, out);
    return done(state, out);
  },

  onPlayerReconnected(prev, playerId) {
    const idx = prev.players.findIndex((p) => p.id === playerId);
    if (idx < 0 || !prev.players[idx]!.away) return { state: prev, events: [] };
    const state = clone(prev);
    state.players[idx]!.away = false;
    return { state, events: [] };
  },

  /**
   * A leaver's hand goes under the pile: it has to go somewhere, and whoever
   * takes the pile next can have it. If they made the play on top, it can't
   * be called any more (nobody's left to take it), so play moves on.
   */
  onPlayerRemoved(prev, playerId) {
    const idx = prev.players.findIndex((p) => p.id === playerId);
    if (prev.phase !== "playing" || idx < 0 || prev.players[idx]!.removed) return { state: prev, events: [] };
    const state = clone(prev);
    const out = newOut([pub({ type: "player-removed", playerId })]);
    const leaver = state.players[idx]!;
    leaver.removed = true;
    state.pile.unshift(...leaver.hand);
    leaver.hand = [];

    const left = state.players.filter(inGame);
    if (left.length < 2) finish(state, left[0]?.id ?? null, "abandoned", out);
    else if (idx === state.turnIndex) {
      if (state.step === "window") {
        state.lastPlay = null;
        out.timers.push({ kind: "cancel", timerId: WINDOW });
      }
      advance(state, idx);
    } else if (state.step === "window" && nobodyLeftToCall(state)) accept(state, out);
    return done(state, out);
  },

  getPublicState(state) {
    const playing = state.phase === "playing";
    const window = playing && state.step === "window";
    return {
      players: state.players.map((p) => ({
        id: p.id,
        cardCount: p.hand.length,
        removed: p.removed,
        passed: window && state.passed.includes(p.id),
      })),
      currentPlayerId: playing && state.step === "play" ? current(state).id : null,
      dealerId: state.players[state.dealerIndex]!.id,
      step: playing ? state.step : "finished",
      claims: playing && state.step === "play" ? allowedClaims(state.lastClaim, state.settings.claims) : [],
      claimRule: state.settings.claims,
      pileCount: state.pile.length,
      lastPlay: state.lastPlay && { playerId: state.lastPlay.playerId, count: state.lastPlay.cards.length, claim: state.lastPlay.claim },
      window: window ? { playerId: current(state).id, endsAt: state.windowEndsAt, ms: state.windowMs } : null,
      lastReveal: state.lastReveal,
      winnerId: state.winnerId,
      endReason: state.endReason,
    };
  },

  getPrivateState(state, playerId) {
    const p = state.players.find((x) => x.id === playerId);
    if (!p) return { hand: [], myPlay: null, canPlay: false, canCall: false };
    const playing = state.phase === "playing" && !p.removed;
    const window = playing && state.step === "window";
    const mine = state.lastPlay?.playerId === playerId;
    return {
      hand: [...p.hand].sort(compareCards),
      myPlay: mine ? state.lastPlay!.cards : null,
      canPlay: playing && state.step === "play" && current(state).id === playerId,
      canCall: window && !mine && !state.passed.includes(playerId),
    };
  },

  // During a window nobody's holding things up: the clock is.
  getAwaitedPlayerIds(state) {
    return state.phase === "playing" && state.step === "play" ? [current(state).id] : [];
  },

  getResult(state) {
    if (state.phase !== "finished") return null;
    // The winner, then fewest cards, then leavers.
    const rank = (p: Player) => (p.removed ? 1000 : p.id === state.winnerId ? -1 : p.hand.length);
    return {
      winnerIds: state.winnerId ? [state.winnerId] : [],
      standings: [...state.players]
        .sort((a, b) => rank(a) - rank(b))
        .map((p) => {
          const n = p.hand.length;
          const label = p.removed
            ? "left"
            : p.id === state.winnerId
              ? state.endReason === "abandoned" ? "last one standing" : "out of cards"
              : `${n} ${n === 1 ? "card" : "cards"} left`;
          return { playerId: p.id, value: n, label };
        }),
    };
  },
};
