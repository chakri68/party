import {
  allVoted,
  castVote,
  dropVoter,
  type GameContext,
  type GameDefinition,
  type GameEventEnvelope,
  type GameResult,
  openBallot,
  shuffle,
  type TimerRequest,
} from "@games/game-core";
import { CATEGORIES } from "../shared/categories.ts";
import { faceOffManifest } from "../shared/manifest.ts";
import {
  CAP_MS,
  categoryId,
  type Choice,
  CHOICES,
  CONFIRM_MS,
  DEFAULT_SETTINGS,
  DUEL_MS,
  type EndReason,
  type FaceOffAction,
  type FaceOffCarry,
  type FaceOffEvent,
  type FaceOffPlayerState,
  type FaceOffPrivateState,
  type FaceOffPublicState,
  type FaceOffServerState,
  type FaceOffSettings,
  MIN_PLAYERS,
  type Outcome,
  type OutcomeKind,
  type Phase,
  REDO_MS,
  SPARK_MAX_MS,
  SPARK_MIN_MS,
  TARGET_OPTIONS,
} from "../shared/types.ts";

type State = FaceOffServerState;
type Player = FaceOffPlayerState;
type Events = GameEventEnvelope<FaceOffEvent>[];

const pub = (event: FaceOffEvent): GameEventEnvelope<FaceOffEvent> => ({ visibility: { kind: "public" }, event });

const reject = (code: string, message: string): GameResult<State, FaceOffEvent> => ({
  ok: false,
  error: { code, message },
});

/** The phase's deadline. Setting it again replaces it. */
const PHASE = "phase";
/** The match's 5 minutes. */
const CAP = "cap";
/** An alarm this early is a stray, not the deadline (Dominion's guard). */
const SLACK_MS = 500;
/** Phases whose deadline closes the door on actions. */
const TIMED: readonly Phase[] = ["duel", "confirm"];

// ---------------------------------------------------------------------------
// Internals. Helpers mutate the state they're given; the public API always
// hands them a fresh clone. `Out` gathers what the transition says besides state.
// ---------------------------------------------------------------------------

interface Out {
  events: Events;
  timers: TimerRequest[];
}

const clone = (state: State): State => structuredClone(state);
const newOut = (): Out => ({ events: [], timers: [] });
const done = (state: State, out: Out) => ({ state, events: out.events, timers: out.timers });

const active = (p: Player) => !p.removed;
const find = (state: State, id: string) => state.players.find((p) => p.id === id);
const deckOf = (state: State): readonly string[] => state.deck ?? CATEGORIES;
const isDuelist = (state: State, id: string) => !!state.duel && (state.duel.a === id || state.duel.b === id);
const otherDuelist = (state: State, id: string) => (state.duel!.a === id ? state.duel!.b : state.duel!.a);

/** Fresh categories first, then the ones the last match used, each part shuffled. */
function buildOrder(deck: readonly string[], usedBefore: readonly string[], rand: GameContext["randomInt"]): number[] {
  const idx = deck.map((_, i) => i);
  const fresh = idx.filter((i) => !usedBefore.includes(categoryId(deck[i]!)));
  const stale = idx.filter((i) => usedBefore.includes(categoryId(deck[i]!)));
  return [...shuffle(fresh, rand), ...shuffle(stale, rand)];
}

/**
 * A new card for one player. Never one somebody's holding: before a
 * reshuffle the order hasn't reached anything held, and a reshuffle leaves
 * out whatever's in a hand.
 */
function draw(state: State, playerId: string, ctx: GameContext, out: Out): void {
  const held = new Set(state.players.filter((p) => active(p) && p.card >= 0).map((p) => p.card));
  for (;;) {
    if (state.pos >= state.order.length) {
      state.order = shuffle(
        deckOf(state).map((_, i) => i).filter((i) => !held.has(i)),
        ctx.randomInt,
      );
      state.pos = 0;
      state.reshuffled = true;
      out.events.push(pub({ type: "reshuffled" }));
    }
    const card = state.order[state.pos++]!;
    if (held.has(card)) continue;
    find(state, playerId)!.card = card;
    return;
  }
}

function setPhase(state: State, phase: Phase, ms: number, ctx: GameContext, out: Out): void {
  state.phase = phase;
  state.deadline = ctx.now + ms;
  state.phaseMs = ms;
  out.timers.push({ kind: "set", timerId: PHASE, delayMs: ms });
}

function finish(state: State, reason: EndReason, out: Out): void {
  state.phase = "finished";
  state.deadline = 0;
  state.phaseMs = 0;
  state.duel = null;
  state.queued = null;
  state.endReason = reason;
  out.timers.push({ kind: "cancel", timerId: PHASE }, { kind: "cancel", timerId: CAP });
  out.events.push(pub({ type: "game-over", reason }));
}

/** The quiet before the next spark: 4 to 9 s, or the redo's 2. */
function lull(state: State, ctx: GameContext, out: Out, ms = SPARK_MIN_MS + ctx.randomInt(SPARK_MAX_MS - SPARK_MIN_MS + 1)): void {
  state.duel = null;
  setPhase(state, "lull", ms, ctx, out);
}

/** After a duel's settled: the end, if the target's reached or the cap fell during it; otherwise the next lull. */
function afterDuel(state: State, ctx: GameContext, out: Out): void {
  if (state.players.some((p) => active(p) && p.score >= state.settings.target)) return finish(state, "target", out);
  if (state.capped) return finish(state, "time", out);
  lull(state, ctx, out);
}

/**
 * Two connected players. The exact last pair is out whenever there's any
 * other; a player from the last pair weighs 1 against everyone else's 3.
 */
function pickPair(state: State, ctx: GameContext): [string, string] | null {
  const ids = state.players.filter((p) => active(p) && !p.away).map((p) => p.id);
  if (ids.length < 2) return null;
  const last: readonly string[] = state.lastPair ?? [];
  const same = (a: string, b: string) => last.includes(a) && last.includes(b);
  let pairs: [string, string][] = [];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) pairs.push([ids[i]!, ids[j]!]);
  if (pairs.length > 1) pairs = pairs.filter(([a, b]) => !same(a, b));
  const w = (id: string) => (last.includes(id) ? 1 : 3);
  const weights = pairs.map(([a, b]) => w(a) * w(b));
  let r = ctx.randomInt(weights.reduce((x, y) => x + y, 0));
  for (let i = 0; i < pairs.length; i++) {
    r -= weights[i]!;
    if (r < 0) return ctx.randomInt(2) ? pairs[i]! : [pairs[i]![1], pairs[i]![0]];
  }
  return pairs.at(-1)!;
}

function spark(state: State, ctx: GameContext, out: Out): void {
  const q = state.queued;
  state.queued = null;
  const ready = (id: string) => {
    const p = find(state, id);
    return !!p && active(p) && !p.away;
  };
  const redone = !!q && ready(q[0]) && ready(q[1]);
  const pair = redone ? q : pickPair(state, ctx);
  if (!pair) return lull(state, ctx, out);
  const [a, b] = pair;
  state.duel = { a, b, claimId: null, redone, ballot: null };
  state.lastPair = [a, b];
  state.duels++;
  setPhase(state, "duel", DUEL_MS, ctx, out);
  out.events.push(pub({ type: "spark", a, b, redone }));
}

function settle(state: State, kind: OutcomeKind, winnerId: string | null, drew: string[], ctx: GameContext, out: Out): void {
  const d = state.duel!;
  const votes = Object.values(d.ballot?.votes ?? {});
  const outcome: Outcome = {
    kind,
    a: d.a,
    b: d.b,
    winnerId,
    loserId: winnerId ? (winnerId === d.a ? d.b : d.a) : null,
    confirm: votes.filter((v) => v === "confirm").length,
    overturn: votes.filter((v) => v === "overturn").length,
    drew,
  };
  if (winnerId) find(state, winnerId)!.score++;
  for (const id of drew) draw(state, id, ctx, out);
  state.last = outcome;
  out.events.push(pub({ type: "outcome", outcome }));
  afterDuel(state, ctx, out);
}

/** The table's ruled (or had nothing to rule with). More overturns than confirms flips it. */
function resolveClaim(state: State, ctx: GameContext, out: Out): void {
  const d = state.duel!;
  const votes = Object.values(d.ballot?.votes ?? {});
  const flip = votes.filter((v) => v === "overturn").length > votes.filter((v) => v === "confirm").length;
  const winner = flip ? otherDuelist(state, d.claimId!) : d.claimId!;
  settle(state, flip ? "overturned" : "point", winner, [otherDuelist(state, winner)], ctx, out);
}

/** A buzz: the rest of the table gets its say, if anyone's there to say it. */
function claim(state: State, by: string, ctx: GameContext, out: Out): void {
  const d = state.duel!;
  d.claimId = by;
  out.events.push(pub({ type: "buzzed", by }));
  const voters = state.players.filter((p) => active(p) && !p.away && !isDuelist(state, p.id)).map((p) => p.id);
  d.ballot = openBallot<Choice>(voters);
  if (!voters.length) return resolveClaim(state, ctx, out);
  setPhase(state, "confirm", CONFIRM_MS, ctx, out);
}

/** Everyone who can still vote has. */
function closeIfDone(state: State, ctx: GameContext, out: Out): void {
  const b = state.duel?.ballot;
  if (state.phase !== "confirm" || !b) return;
  const waiting = b.eligible.filter((id) => !(id in b.votes) && !find(state, id)!.away);
  if (allVoted(b) || !waiting.length) resolveClaim(state, ctx, out);
}

function redo(state: State, by: string, ctx: GameContext, out: Out): void {
  const d = state.duel!;
  state.queued = [d.a, d.b];
  out.events.push(pub({ type: "redo", by }));
  if (state.capped) return finish(state, "time", out);
  lull(state, ctx, out, REDO_MS);
}

/** The clock ran out on the current phase. */
function expire(state: State, ctx: GameContext, out: Out): void {
  switch (state.phase) {
    case "lull":
      return spark(state, ctx, out);
    case "duel": {
      const d = state.duel!;
      return settle(state, "void", null, [d.a, d.b], ctx, out);
    }
    case "confirm":
      return resolveClaim(state, ctx, out);
    default:
      return;
  }
}

function awaited(state: State): string[] {
  const d = state.duel;
  if (!d) return [];
  if (state.phase === "duel") return [d.a, d.b];
  if (state.phase === "confirm" && d.ballot) return d.ballot.eligible.filter((id) => !(id in d.ballot!.votes) && !find(state, id)!.away);
  return [];
}

/** Last match's ids plus this one's. Once that's the whole deck, just this one's. */
function usedIds(state: State): string[] {
  const deck = deckOf(state);
  const held = state.players.map((p) => p.card).filter((c) => c >= 0);
  const dealt = state.reshuffled ? [...state.order.slice(0, state.pos), ...held] : state.order.slice(0, state.pos);
  const now = [...new Set(dealt.map((i) => categoryId(deck[i]!)))];
  const all = [...new Set([...state.usedBefore, ...now])];
  return all.length >= deck.length ? now : all;
}

function parseCarry(raw: unknown): FaceOffCarry | null {
  if (typeof raw !== "object" || raw === null) return null;
  const used = (raw as { used?: unknown }).used;
  return Array.isArray(used) && used.every((u) => typeof u === "string") ? { used } : null;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function parseSettings(input: unknown): FaceOffSettings | null {
  if (input === undefined || input === null) return { ...DEFAULT_SETTINGS };
  if (typeof input !== "object" || Array.isArray(input)) return null;
  const s = { ...DEFAULT_SETTINGS, ...(input as Partial<FaceOffSettings>) };
  if (!TARGET_OPTIONS.includes(s.target)) return null;
  return { target: s.target };
}

function parseAction(input: unknown): FaceOffAction | null {
  if (typeof input !== "object" || input === null) return null;
  const { type, choice } = input as { type?: unknown; choice?: unknown };
  if (type === "buzz" || type === "redo") return { type };
  if (type === "vote" && CHOICES.includes(choice as Choice)) return { type, choice: choice as Choice };
  return null;
}

// ---------------------------------------------------------------------------
// Definition
// ---------------------------------------------------------------------------

export const faceOffGame: GameDefinition<
  FaceOffServerState,
  FaceOffAction,
  FaceOffPublicState,
  FaceOffPrivateState,
  FaceOffSettings,
  FaceOffEvent
> = {
  manifest: faceOffManifest,
  defaultSettings: DEFAULT_SETTINGS,
  parseSettings,
  parseAction,

  createGame(players, settings, match, ctx, options) {
    const n = players.length;
    const { minPlayers, maxPlayers } = faceOffManifest;
    if (n < minPlayers || n > maxPlayers) {
      throw new Error(`face-off: needs ${minPlayers}–${maxPlayers} players, got ${n}`);
    }
    const deck = options?.deck ? (options.deck as string[]) : null;
    // Checked now, so a bad test deck fails at the start rather than mid-game.
    if (deck && (deck.some((c) => typeof c !== "string" || !c.trim()) || new Set(deck).size !== deck.length)) {
      throw new Error("A deck must be distinct categories.");
    }
    if (deck && deck.length < n + 2) throw new Error(`A deck needs at least ${n + 2} categories for ${n} players.`);
    const carry = parseCarry(match.carry);
    const state: State = {
      phase: "lull",
      settings,
      players: players.map((p, seat) => ({ id: p.id, seat, card: -1, score: 0, removed: false, away: false })),
      deadline: 0,
      phaseMs: 0,
      endsAt: ctx.now + CAP_MS,
      capped: false,
      duel: null,
      queued: null,
      lastPair: null,
      last: null,
      duels: 0,
      order: [],
      pos: 0,
      usedBefore: carry?.used ?? [],
      reshuffled: false,
      deck,
      endReason: null,
    };
    state.order = buildOrder(deckOf(state), state.usedBefore, ctx.randomInt);
    const out = newOut();
    for (const p of state.players) draw(state, p.id, ctx, out);
    lull(state, ctx, out);
    out.timers.push({ kind: "set", timerId: CAP, delayMs: CAP_MS });
    return done(state, out);
  },

  handleAction(prev, playerId, action, ctx) {
    if (prev.phase === "finished") return reject("game-finished", "The game is over.");
    const me = find(prev, playerId);
    if (!me || !active(me)) return reject("not-in-game", "You're not in this game.");
    if (TIMED.includes(prev.phase) && ctx.now >= prev.deadline) return reject("time-up", "Time's up.");
    const duelist = isDuelist(prev, playerId);

    const state = clone(prev);
    const out = newOut();

    switch (action.type) {
      case "buzz": {
        if (prev.phase === "confirm") return reject("too-late", `${prev.duel!.claimId === playerId ? "You" : "They"} buzzed first.`);
        if (prev.phase !== "duel") return reject("wrong-phase", "No duel on.");
        if (!duelist) return reject("not-dueling", "You're not in this duel.");
        claim(state, playerId, ctx, out);
        break;
      }
      case "redo": {
        if (prev.phase !== "duel" && prev.phase !== "confirm") return reject("wrong-phase", "No duel on.");
        if (!duelist) return reject("not-dueling", "Only the two in the duel can call a redo.");
        if (prev.duel!.redone) return reject("redone", "This one's already a redo.");
        redo(state, playerId, ctx, out);
        break;
      }
      case "vote": {
        if (prev.phase !== "confirm") return reject("wrong-phase", "Nothing to vote on.");
        if (duelist) return reject("not-eligible", "The table decides, not the duelists.");
        const error = castVote(state.duel!.ballot!, playerId, action.choice, CHOICES);
        if (error) return { ok: false, error };
        closeIfDone(state, ctx, out);
        break;
      }
    }
    return { ok: true, transition: done(state, out) };
  },

  onTimer(prev, timerId, ctx) {
    if (prev.phase === "finished") return { state: prev, events: [] };
    if (timerId === CAP) {
      if (prev.capped) return { state: prev, events: [] };
      if (ctx.now < prev.endsAt - SLACK_MS) {
        return { state: prev, events: [], timers: [{ kind: "set", timerId: CAP, delayMs: prev.endsAt - ctx.now }] };
      }
      const state = clone(prev);
      const out = newOut();
      // A live duel gets to finish.
      if (state.phase === "lull") finish(state, "time", out);
      else state.capped = true;
      return done(state, out);
    }
    if (timerId !== PHASE || prev.deadline === 0) return { state: prev, events: [] };
    // A duplicate or early alarm is harmless: only a due deadline moves the game.
    if (ctx.now < prev.deadline - SLACK_MS) {
      return { state: prev, events: [], timers: [{ kind: "set", timerId: PHASE, delayMs: prev.deadline - ctx.now }] };
    }
    const state = clone(prev);
    const out = newOut();
    expire(state, ctx, out);
    return done(state, out);
  },

  onPlayerDisconnected(prev, playerId, ctx) {
    const p = find(prev, playerId);
    if (prev.phase === "finished" || !p || p.removed) return { state: prev, events: [] };
    const state = clone(prev);
    const out = newOut();
    find(state, playerId)!.away = true;
    // A dropped voter stops holding the vote open.
    closeIfDone(state, ctx, out);
    return done(state, out);
  },

  onPlayerReconnected(prev, playerId) {
    const p = find(prev, playerId);
    if (!p || !p.away) return { state: prev, events: [] };
    const state = clone(prev);
    find(state, playerId)!.away = false;
    return { state, events: [] };
  },

  onPlayerRemoved(prev, playerId, ctx) {
    const p = find(prev, playerId);
    if (prev.phase === "finished" || !p || p.removed) return { state: prev, events: [] };
    const state = clone(prev);
    const out = newOut();
    find(state, playerId)!.removed = true;
    if (state.queued?.includes(playerId)) state.queued = null;
    if (state.players.filter(active).length < MIN_PLAYERS) {
      finish(state, "abandoned", out);
    } else if (isDuelist(state, playerId) && (state.phase === "duel" || state.phase === "confirm")) {
      settle(state, "left", null, [], ctx, out);
    } else if (state.phase === "confirm" && state.duel?.ballot) {
      dropVoter(state.duel.ballot, playerId);
      closeIfDone(state, ctx, out);
    }
    return done(state, out);
  },

  skipTurn(prev, playerId, ctx) {
    if (prev.phase === "finished" || !awaited(prev).includes(playerId)) return { state: prev, events: [] };
    const state = clone(prev);
    const out = newOut();
    out.events.push(pub({ type: "skipped", playerId }));
    if (state.phase === "duel") {
      const d = state.duel!;
      settle(state, "void", null, [d.a, d.b], ctx, out);
    } else if (state.phase === "confirm") {
      dropVoter(state.duel!.ballot!, playerId);
      closeIfDone(state, ctx, out);
    }
    return done(state, out);
  },

  getPublicState(state) {
    const deck = deckOf(state);
    const d = state.duel;
    return {
      phase: state.phase,
      deadline: state.deadline,
      phaseMs: state.phaseMs,
      endsAt: state.endsAt,
      target: state.settings.target,
      players: state.players.map((p) => ({ id: p.id, category: deck[p.card] ?? "", score: p.score, removed: p.removed })),
      duel: d
        ? {
            a: d.a,
            b: d.b,
            claimId: d.claimId,
            redone: d.redone,
            voted: d.ballot ? Object.keys(d.ballot.votes).length : 0,
            voters: d.ballot ? d.ballot.eligible.length : 0,
          }
        : null,
      queued: state.queued ? [...state.queued] : null,
      last: state.last ? { ...state.last, drew: [...state.last.drew] } : null,
      duels: state.duels,
      reshuffled: state.reshuffled,
      endReason: state.endReason,
    };
  },

  getPrivateState(state, playerId) {
    const p = find(state, playerId);
    const d = state.duel;
    if (!p || p.removed || !d) return { canBuzz: false, canRedo: false, canVote: false, myVote: null };
    const duelist = isDuelist(state, playerId);
    const confirm = state.phase === "confirm";
    return {
      canBuzz: state.phase === "duel" && duelist,
      canRedo: (state.phase === "duel" || confirm) && duelist && !d.redone,
      canVote: confirm && !!d.ballot?.eligible.includes(playerId),
      myVote: (confirm && d.ballot?.votes[playerId]) || null,
    };
  },

  getAwaitedPlayerIds: awaited,

  getResult(state) {
    if (state.phase !== "finished") return null;
    const here = state.players.filter(active);
    const top = Math.max(0, ...here.map((p) => p.score));
    const pts = (n: number) => `${n} ${n === 1 ? "point" : "points"}`;
    return {
      winnerIds: top > 0 ? here.filter((p) => p.score === top).map((p) => p.id) : [],
      standings: [...state.players]
        .sort((x, y) => Number(x.removed) - Number(y.removed) || y.score - x.score || x.seat - y.seat)
        .map((p) => ({ playerId: p.id, value: p.score, label: `${pts(p.score)}${p.removed ? ", left" : ""}` })),
    };
  },

  carryOver(state): FaceOffCarry {
    return { used: usedIds(state) };
  },
};
