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
  stableHash,
  tally,
  type TimerRequest,
} from "@games/game-core";
import { imposterManifest } from "../shared/manifest.ts";
import { cleanClue, cleanGuess, clueProblem, guessMatches } from "../shared/rules.ts";
import {
  CLUES_MS,
  DEFAULT_SETTINGS,
  DISCUSS_OPTIONS,
  type EndReason,
  GUESS_MS,
  type ImposterAction,
  type ImposterEvent,
  type ImposterPlayerState,
  type ImposterPrivateState,
  type ImposterPublicState,
  type ImposterServerState,
  type ImposterSettings,
  MIN_PLAYERS,
  POINTS,
  RESULT_MS,
  REVEAL_MS,
  ROLE_MS,
  ROUND_OPTIONS,
  type RoundPhase,
  type RoundState,
  type Side,
  VOTE_MS,
} from "../shared/types.ts";
import { PACK } from "./words.ts";

type State = ImposterServerState;
type Player = ImposterPlayerState;
type Events = GameEventEnvelope<ImposterEvent>[];

const pub = (event: ImposterEvent): GameEventEnvelope<ImposterEvent> => ({ visibility: { kind: "public" }, event });

const reject = (code: string, message: string): GameResult<State, ImposterEvent> => ({
  ok: false,
  error: { code, message },
});

/** One timer: the phase's deadline. Setting it again replaces it. */
const PHASE = "phase";
/** An alarm this early is a stray, not the deadline (Dominion's guard). */
const SLACK_MS = 500;
/** Phases whose deadline closes the door on actions. */
const TIMED: readonly RoundPhase[] = ["reveal", "clues", "vote", "runoff", "guess"];
/** Phases where the round's outcome is public. */
const REVEALED: readonly RoundPhase[] = ["reveal-role", "guess", "round-result"];

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
const activeIds = (state: State) => state.players.filter(active).map((p) => p.id);
const find = (state: State, id: string) => state.players.find((p) => p.id === id);
const voting = (phase: string) => phase === "vote" || phase === "runoff";

/**
 * Everyone still here has done it. Dropped players don't hold a phase up,
 * but if nobody's here at all, the clock decides.
 */
function allHere(state: State, ids: readonly string[], isDone: (id: string) => boolean): boolean {
  const here = ids.filter((id) => {
    const p = find(state, id);
    return p && active(p) && !p.away;
  });
  return here.length > 0 && here.every(isDone);
}

function setPhase(state: State, phase: RoundPhase, ms: number, ctx: GameContext, out: Out): void {
  state.round.phase = phase;
  state.round.deadline = ctx.now + ms;
  state.round.phaseMs = ms;
  out.timers.push({ kind: "set", timerId: PHASE, delayMs: ms });
}

function finish(state: State, reason: EndReason, out: Out): void {
  state.phase = "finished";
  state.endReason = reason;
  out.timers.push({ kind: "cancel", timerId: PHASE });
  out.events.push(pub({ type: "game-over", reason }));
}

/** Test decks are "category|word" strings. */
function parseDeck(input: unknown[]): { category: string; word: string }[] {
  const ok = input.every((e) => typeof e === "string" && /^[^|]+\|[^|]+$/.test(e));
  if (!input.length || !ok) throw new Error('A deck must be "category|word" strings, e.g. ["Food|toast"].');
  return (input as string[]).map((e) => {
    const [category, word] = e.split("|") as [string, string];
    return { category, word };
  });
}

const ALL = PACK.flatMap((c) => c.words.map((word) => ({ category: c.name, word })));
const key = (e: { category: string; word: string }) => `${e.category}|${e.word}`;

/**
 * A word nobody's had this game, from a different category than last time
 * if there's one left. Once the pack's spent, it starts over.
 */
function pickWord(state: State, deck: { category: string; word: string }[], ctx: GameContext) {
  let fresh = deck.filter((e) => !state.used.includes(key(e)));
  if (!fresh.length) {
    state.used = [];
    fresh = deck;
  }
  const other = fresh.filter((e) => e.category !== state.round.category);
  const from = other.length ? other : fresh;
  const pick = from[ctx.randomInt(from.length)]!;
  state.used.push(key(pick));
  return pick;
}

/** Among whoever's been Imposter the fewest times. */
function pickImposter(state: State, ctx: GameContext): Player {
  const pool = state.players.filter(active);
  const least = Math.min(...pool.map((p) => p.imposterCount));
  const fewest = pool.filter((p) => p.imposterCount === least);
  return fewest[ctx.randomInt(fewest.length)]!;
}

function blankRound(): RoundState {
  return {
    phase: "reveal",
    deadline: 0,
    phaseMs: 0,
    imposterId: "",
    category: "",
    word: "",
    acks: [],
    clues: {},
    order: [],
    ballot: null,
    candidates: [],
    tied: [],
    accusedId: null,
    guess: null,
    guessRight: false,
    guessClose: false,
    winner: null,
  };
}

function startRound(state: State, deck: { category: string; word: string }[], restarted: boolean, ctx: GameContext, out: Out): void {
  const pick = pickWord(state, deck, ctx);
  const imposter = pickImposter(state, ctx);
  imposter.imposterCount++;
  state.round = {
    ...blankRound(),
    imposterId: imposter.id,
    category: pick.category,
    word: pick.word,
    order: shuffle(activeIds(state), ctx.randomInt),
  };
  setPhase(state, "reveal", REVEAL_MS, ctx, out);
  out.events.push(pub({ type: "round-started", round: state.roundNumber, restarted }));
}

function deckOf(state: State): { category: string; word: string }[] {
  return state.deck ? parseDeck(state.deck) : ALL;
}

function nextRound(state: State, ctx: GameContext, out: Out): void {
  if (state.roundNumber >= state.settings.rounds) return finish(state, "done", out);
  state.roundNumber++;
  startRound(state, deckOf(state), false, ctx, out);
}

function toClues(state: State, ctx: GameContext, out: Out): void {
  setPhase(state, "clues", CLUES_MS, ctx, out);
}

function toDiscuss(state: State, ctx: GameContext, out: Out): void {
  const r = state.round;
  for (const id of activeIds(state)) if (!(id in r.clues)) r.clues[id] = null;
  out.events.push(pub({ type: "clues-in" }));
  setPhase(state, "discuss", state.settings.discussSeconds * 1000, ctx, out);
}

function openVote(state: State, candidates: string[], runoff: boolean, ctx: GameContext, out: Out): void {
  const r = state.round;
  r.candidates = candidates;
  r.ballot = openBallot(activeIds(state));
  setPhase(state, runoff ? "runoff" : "vote", VOTE_MS, ctx, out);
  out.events.push(pub({ type: "vote-open", runoff }));
}

function accuse(state: State, id: string, ctx: GameContext, out: Out): void {
  const r = state.round;
  r.accusedId = id;
  out.events.push(pub({ type: "accused", playerId: id, role: id === r.imposterId ? "imposter" : "innocent" }));
  setPhase(state, "reveal-role", ROLE_MS, ctx, out);
}

function closeVote(state: State, ctx: GameContext, out: Out): void {
  const r = state.round;
  const runoff = r.phase === "runoff";
  const seedKey = `${state.seed}:${state.roundNumber}:${runoff ? "runoff" : "vote"}`;
  const { winner, tied } = tally(r.ballot!, r.candidates, seedKey);
  if (!runoff) {
    if (winner === null) {
      out.events.push(pub({ type: "nobody-accused" }));
      return settle(state, "imposter", ctx, out);
    }
    if (tied.length) {
      r.tied = tied;
      return openVote(state, tied, true, ctx, out);
    }
    return accuse(state, winner, ctx, out);
  }
  // A runoff nobody voted in is as tied as one everybody did.
  accuse(state, winner ?? r.candidates[stableHash(`${seedKey}:${r.candidates.join(",")}`) % r.candidates.length]!, ctx, out);
}

/** The round's decided: points, then the result on screen for a bit. */
function settle(state: State, winner: Side, ctx: GameContext, out: Out): void {
  const r = state.round;
  r.winner = winner;
  for (const p of state.players) {
    if (!active(p)) continue;
    if (winner === "innocents" ? p.id !== r.imposterId : p.id === r.imposterId) p.score += POINTS;
  }
  out.events.push(pub({ type: "round-over", winner, imposterId: r.imposterId, word: r.word }));
  setPhase(state, "round-result", RESULT_MS, ctx, out);
}

function afterRole(state: State, ctx: GameContext, out: Out): void {
  const r = state.round;
  if (r.accusedId === r.imposterId) setPhase(state, "guess", GUESS_MS, ctx, out);
  else settle(state, "imposter", ctx, out);
}

function makeGuess(state: State, text: string | null, ctx: GameContext, out: Out): void {
  const r = state.round;
  const m = text ? guessMatches(text, r.word) : { right: false, close: false };
  r.guess = text;
  r.guessRight = m.right;
  r.guessClose = m.close;
  out.events.push(pub({ type: "guessed", right: m.right }));
  settle(state, m.right ? "imposter" : "innocents", ctx, out);
}

/** The clock ran out on the current phase. */
function expire(state: State, ctx: GameContext, out: Out): void {
  const r = state.round;
  switch (r.phase) {
    case "reveal":
      return toClues(state, ctx, out);
    case "clues":
      return toDiscuss(state, ctx, out);
    case "discuss":
      return openVote(state, activeIds(state), false, ctx, out);
    case "vote":
    case "runoff":
      return closeVote(state, ctx, out);
    case "reveal-role":
      return afterRole(state, ctx, out);
    case "guess":
      return makeGuess(state, null, ctx, out);
    case "round-result":
      return nextRound(state, ctx, out);
  }
}

/** Moves on early if everyone still here has done this phase's thing. */
function check(state: State, ctx: GameContext, out: Out): void {
  if (state.phase === "finished") return;
  const r = state.round;
  const ids = activeIds(state);
  switch (r.phase) {
    case "reveal":
      if (allHere(state, ids, (id) => r.acks.includes(id))) toClues(state, ctx, out);
      break;
    case "clues":
      if (allHere(state, ids, (id) => id in r.clues)) toDiscuss(state, ctx, out);
      break;
    case "vote":
    case "runoff":
      if (allVoted(r.ballot!) || allHere(state, r.ballot!.eligible, (id) => id in r.ballot!.votes)) closeVote(state, ctx, out);
      break;
    default:
      break;
  }
}

/** Who the phase is waiting on, dropped or not: the host can skip the dropped. */
function awaited(state: State): string[] {
  if (state.phase === "finished") return [];
  const r = state.round;
  const ids = activeIds(state);
  switch (r.phase) {
    case "reveal":
      return ids.filter((id) => !r.acks.includes(id));
    case "clues":
      return ids.filter((id) => !(id in r.clues));
    case "vote":
    case "runoff":
      return r.ballot!.eligible.filter((id) => !(id in r.ballot!.votes));
    case "guess":
      return [r.imposterId];
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function parseSettings(input: unknown): ImposterSettings | null {
  if (input === undefined || input === null) return { ...DEFAULT_SETTINGS };
  if (typeof input !== "object" || Array.isArray(input)) return null;
  const s = { ...DEFAULT_SETTINGS, ...(input as Partial<ImposterSettings>) };
  if (!ROUND_OPTIONS.includes(s.rounds) || !DISCUSS_OPTIONS.includes(s.discussSeconds)) return null;
  return { rounds: s.rounds, discussSeconds: s.discussSeconds };
}

function parseAction(input: unknown): ImposterAction | null {
  if (typeof input !== "object" || input === null) return null;
  const a = input as Record<string, unknown>;
  switch (a.type) {
    case "ack":
    case "next":
      return { type: a.type };
    case "clue":
    case "guess":
      return typeof a.text === "string" && a.text.length <= 400 ? { type: a.type, text: a.text } : null;
    case "vote":
      return typeof a.playerId === "string" && a.playerId.length <= 100 ? { type: "vote", playerId: a.playerId } : null;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Definition
// ---------------------------------------------------------------------------

export const imposterGame: GameDefinition<
  ImposterServerState,
  ImposterAction,
  ImposterPublicState,
  ImposterPrivateState,
  ImposterSettings,
  ImposterEvent
> = {
  manifest: imposterManifest,
  defaultSettings: DEFAULT_SETTINGS,
  parseSettings,
  parseAction,

  createGame(players, settings, _match, ctx, options) {
    const n = players.length;
    const { minPlayers, maxPlayers } = imposterManifest;
    if (n < minPlayers || n > maxPlayers) {
      throw new Error(`imposter: needs ${minPlayers}–${maxPlayers} players, got ${n}`);
    }
    // Checked now, so a bad test deck fails at the start rather than mid-game.
    if (options?.deck) parseDeck(options.deck);
    const state: State = {
      phase: "playing",
      settings,
      seed: ctx.randomInt(2 ** 31),
      players: players.map((p) => ({ id: p.id, score: 0, removed: false, away: false, imposterCount: 0 })),
      roundNumber: 1,
      round: blankRound(),
      used: [],
      deck: options?.deck ? (options.deck as string[]) : null,
      endReason: null,
    };
    const out = newOut();
    startRound(state, deckOf(state), false, ctx, out);
    return done(state, out);
  },

  handleAction(prev, playerId, action, ctx) {
    if (prev.phase === "finished") return reject("game-finished", "The game is over.");
    const me = find(prev, playerId);
    if (!me || !active(me)) return reject("not-in-game", "You're not in this game.");
    const r = prev.round;
    if (TIMED.includes(r.phase) && ctx.now >= r.deadline) return reject("time-up", "Time's up.");

    const state = clone(prev);
    const s = state.round;
    const out = newOut();

    switch (action.type) {
      case "ack": {
        if (r.phase !== "reveal") return reject("wrong-phase", "Not now.");
        if (!s.acks.includes(playerId)) s.acks.push(playerId);
        break;
      }
      case "clue": {
        if (r.phase !== "clues") return reject("wrong-phase", "Not clue time.");
        if (playerId in r.clues) return reject("already", "You've sent your clue.");
        const clue = cleanClue(action.text);
        // The Imposter's clue is never checked against the word: a rejection
        // would tell them what it is.
        const problem = playerId === r.imposterId ? (clue ? null : "Type a clue.") : clueProblem(clue, r.word);
        if (problem) return reject("bad-clue", problem);
        s.clues[playerId] = clue;
        break;
      }
      case "vote": {
        if (!voting(r.phase)) return reject("wrong-phase", "Not voting yet.");
        const allowed = s.candidates.filter((id) => id !== playerId);
        if (action.playerId === playerId) return reject("self-vote", "Not yourself.");
        const error = castVote(s.ballot!, playerId, action.playerId, allowed);
        if (error) return { ok: false, error };
        break;
      }
      case "guess": {
        if (r.phase !== "guess") return reject("wrong-phase", "Not now.");
        if (playerId !== r.imposterId) return reject("not-yours", "Only the Imposter guesses.");
        const text = cleanGuess(action.text);
        if (!text) return reject("bad-guess", "Type a guess.");
        makeGuess(state, text, ctx, out);
        break;
      }
      case "next": {
        if (ctx.hostId !== playerId) return reject("host-only", "Only the host can do that.");
        if (r.phase === "discuss") openVote(state, activeIds(state), false, ctx, out);
        else if (r.phase === "round-result") nextRound(state, ctx, out);
        else return reject("wrong-phase", "Not now.");
        break;
      }
    }
    check(state, ctx, out);
    return { ok: true, transition: done(state, out) };
  },

  onTimer(prev, timerId, ctx) {
    if (prev.phase === "finished" || timerId !== PHASE) return { state: prev, events: [] };
    // A duplicate or early alarm is harmless: only a due deadline moves the round.
    if (ctx.now < prev.round.deadline - SLACK_MS) {
      return { state: prev, events: [], timers: [{ kind: "set", timerId: PHASE, delayMs: prev.round.deadline - ctx.now }] };
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
    // They might have been the last one everyone was waiting on.
    check(state, ctx, out);
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
    const r = state.round;
    if (activeIds(state).length < MIN_PLAYERS) {
      finish(state, "abandoned", out);
      return done(state, out);
    }
    if (playerId === r.imposterId && !REVEALED.includes(r.phase)) {
      // Nothing's been shown yet: drop the round, word and all, and deal again.
      out.events.push(pub({ type: "round-dropped" }));
      startRound(state, deckOf(state), true, ctx, out);
      return done(state, out);
    }
    if (playerId === r.imposterId && r.accusedId === r.imposterId && r.phase !== "round-result") {
      // Caught, then gone before guessing: that's a miss.
      makeGuess(state, null, ctx, out);
      return done(state, out);
    }
    if (voting(r.phase)) {
      const b = r.ballot!;
      dropVoter(b, playerId);
      // Votes for them go back to their voters.
      for (const [voter, choice] of Object.entries(b.votes)) if (choice === playerId) delete b.votes[voter];
      r.candidates = r.candidates.filter((id) => id !== playerId);
      if (r.phase === "runoff" && r.candidates.length === 1) {
        accuse(state, r.candidates[0]!, ctx, out);
        return done(state, out);
      }
    }
    check(state, ctx, out);
    return done(state, out);
  },

  skipTurn(prev, playerId, ctx) {
    if (prev.phase === "finished" || !awaited(prev).includes(playerId)) return { state: prev, events: [] };
    const state = clone(prev);
    const out = newOut();
    const r = state.round;
    out.events.push(pub({ type: "skipped", playerId }));
    switch (r.phase) {
      case "reveal":
        r.acks.push(playerId);
        break;
      case "clues":
        r.clues[playerId] = null;
        break;
      case "vote":
      case "runoff":
        dropVoter(r.ballot!, playerId);
        break;
      case "guess":
        makeGuess(state, null, ctx, out);
        return done(state, out);
      default:
        break;
    }
    check(state, ctx, out);
    return done(state, out);
  },

  getPublicState(state) {
    const r = state.round;
    const after = (phases: readonly RoundPhase[]) => phases.includes(r.phase);
    const shown = after(REVEALED);
    const over = r.phase === "round-result";
    const isDone = (id: string): boolean => {
      if (state.phase === "finished") return false;
      switch (r.phase) {
        case "reveal":
          return r.acks.includes(id);
        case "clues":
          return id in r.clues;
        case "vote":
        case "runoff":
          return !!r.ballot && id in r.ballot.votes;
        default:
          return false;
      }
    };
    let counts: Record<string, number> | null = null;
    if (shown && r.ballot) {
      counts = {};
      for (const id of r.ballot.eligible) {
        const v = r.ballot.votes[id];
        if (v !== undefined) counts[v] = (counts[v] ?? 0) + 1;
      }
    }
    return {
      phase: state.phase === "finished" ? "finished" : r.phase,
      round: state.roundNumber,
      rounds: state.settings.rounds,
      deadline: r.deadline,
      phaseMs: r.phaseMs,
      category: r.category,
      players: state.players.map((p) => ({ id: p.id, score: p.score, removed: p.removed, done: isDone(p.id) })),
      clues: after(["discuss", "vote", "runoff", ...REVEALED])
        ? r.order.filter((id) => id in r.clues).map((id) => ({ playerId: id, text: r.clues[id] ?? null }))
        : null,
      candidates: voting(r.phase) && state.phase !== "finished" ? r.candidates : [],
      tied: r.tied,
      accusedId: shown ? r.accusedId : null,
      accusedRole: shown && r.accusedId ? (r.accusedId === r.imposterId ? "imposter" : "innocent") : null,
      votes: shown && r.ballot ? { ...r.ballot.votes } : null,
      counts,
      imposterId: over ? r.imposterId : null,
      word: over ? r.word : null,
      guess: over ? r.guess : null,
      guessRight: over && r.guessRight,
      guessClose: over && r.guessClose,
      winner: over ? r.winner : null,
      endReason: state.endReason,
    };
  },

  getPrivateState(state, playerId) {
    const r = state.round;
    const p = find(state, playerId);
    const live = state.phase === "playing";
    if (!p || p.removed) {
      return { role: null, word: null, acked: false, clue: null, sentClue: false, vote: null, choices: [], guessing: false };
    }
    const imposter = r.imposterId === playerId;
    const canVote = live && voting(r.phase) && !!r.ballot?.eligible.includes(playerId);
    return {
      role: imposter ? "imposter" : "innocent",
      word: !imposter || r.phase === "round-result" ? r.word : null,
      acked: r.acks.includes(playerId),
      clue: r.clues[playerId] ?? null,
      sentClue: playerId in r.clues,
      vote: voting(r.phase) ? (r.ballot?.votes[playerId] ?? null) : null,
      choices: canVote ? r.candidates.filter((id) => id !== playerId) : [],
      guessing: live && r.phase === "guess" && imposter,
    };
  },

  getAwaitedPlayerIds: awaited,

  getResult(state) {
    if (state.phase !== "finished") return null;
    const standing = state.players.filter(active);
    const top = Math.max(...standing.map((p) => p.score));
    return {
      winnerIds: state.endReason === "abandoned" ? [] : standing.filter((p) => p.score === top).map((p) => p.id),
      standings: [...state.players]
        .sort((a, b) => Number(a.removed) - Number(b.removed) || b.score - a.score)
        .map((p) => ({
          playerId: p.id,
          value: p.score,
          label: `${p.score} ${p.score === 1 ? "point" : "points"}${p.removed ? ", left" : ""}`,
        })),
    };
  },
};
