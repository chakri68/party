import {
  allVoted,
  castVote,
  dropVoter,
  type GameContext,
  type GameDefinition,
  type GameEventEnvelope,
  type GameManifest,
  type GameResult,
  openBallot,
  shuffle,
  type TimerRequest,
} from "@games/game-core";
import { editDistance } from "@games/words";
import { isWord } from "@games/words/dictionary";
import { bluffDefinitionsManifest, fakeWordManifest } from "../shared/manifest.ts";
import { cleanDefinition, cleanFake, definitionShapeProblem, displayDefinition, fakeShapeProblem, nearSame } from "../shared/rules.ts";
import {
  type BluffAction,
  type BluffEvent,
  type BluffPlayerState,
  type BluffPrivateState,
  type BluffPublicState,
  type BluffServerState,
  type BluffSettings,
  DEFAULT_SETTINGS,
  type EndReason,
  type Entry,
  FOOLED_POINTS,
  FOUND_POINTS,
  MIN_PLAYERS,
  REVEAL_MS,
  ROUND_OPTIONS,
  type RoundPhase,
  type RoundState,
  type Variant,
  VOTE_MS,
  WRITE_MS,
} from "../shared/types.ts";
import { WORDS } from "./words.ts";

type State = BluffServerState;
type Player = BluffPlayerState;
type Events = GameEventEnvelope<BluffEvent>[];
type Definition = GameDefinition<BluffServerState, BluffAction, BluffPublicState, BluffPrivateState, BluffSettings, BluffEvent>;

const pub = (event: BluffEvent): GameEventEnvelope<BluffEvent> => ({ visibility: { kind: "public" }, event });

const reject = (code: string, message: string): GameResult<State, BluffEvent> => ({
  ok: false,
  error: { code, message },
});

/** One timer: the phase's deadline. Setting it again replaces it. */
const PHASE = "phase";
/** An alarm this early is a stray, not the deadline (Dominion's guard). */
const SLACK_MS = 500;
/** Fake words this close to the real one are turned away. */
const NEAR_REAL = 2;
const ID_CHARS = 6;

// ---------------------------------------------------------------------------
// What differs between the two games: what's written, how it's checked, and
// what goes on the board. Everything else is one state machine.
// ---------------------------------------------------------------------------

interface Rules {
  manifest: GameManifest;
  /** Server-side cleaning of a submission. */
  clean(text: string): string;
  /** Why it can't go in, or null. `others` is everyone else's, cleaned. */
  problem(text: string, entry: Entry, others: string[]): string | null;
  /** How a submission (or the real answer) shows on the board. */
  show(text: string): string;
  /** The real answer, as written in the list. */
  answer(entry: Entry): string;
}

const RULES: Record<Variant, Rules> = {
  "fake-word": {
    manifest: fakeWordManifest,
    clean: cleanFake,
    problem(word, entry, others) {
      const shape = fakeShapeProblem(word);
      if (shape) return shape;
      // One message for all three, so it doesn't single out the answer.
      if (word === entry.word || isWord(word) || editDistance(word, entry.word, NEAR_REAL) <= NEAR_REAL) {
        return "That's a real word, or too close to one. Make one up.";
      }
      if (others.includes(word)) return "Someone's already made that one up.";
      return null;
    },
    show: (word) => word,
    answer: (entry) => entry.word,
  },
  "bluff-definitions": {
    manifest: bluffDefinitionsManifest,
    clean: cleanDefinition,
    problem(text, entry, others) {
      const shape = definitionShapeProblem(text);
      if (shape) return shape;
      if (nearSame(text, entry.definition)) return "That's the real meaning. Bluff.";
      if (others.some((o) => nearSame(text, o))) return "Someone wrote nearly the same. Try another.";
      return null;
    },
    show: displayDefinition,
    answer: (entry) => entry.definition,
  },
};

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
/** Submissions actually written, skips left out. */
const written = (r: RoundState) => Object.entries(r.entries).filter((e): e is [string, string] => e[1] !== null);

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

/** Test decks are "word|definition" or "word|definition|notes" strings. */
function parseDeck(input: unknown[]): Entry[] {
  const ok = input.every((e) => typeof e === "string" && /^[a-z]+\|[^|]+(\|[^|]*)?$/.test(e));
  if (!input.length || !ok) throw new Error('A deck must be "word|definition" strings, e.g. ["adze|a tool for shaping wood"].');
  return (input as string[]).map((e) => {
    const [word, definition, notes = ""] = e.split("|") as [string, string, string?];
    return { word, definition, notes };
  });
}

/** A word nobody's had this game (or the last); once they're spent, it starts over. */
function pickEntry(state: State, ctx: GameContext): Entry {
  const deck = state.deck ?? WORDS;
  let fresh = deck.filter((e) => !state.used.includes(e.word));
  if (!fresh.length) {
    state.used = [];
    fresh = [...deck];
  }
  const pick = fresh[ctx.randomInt(fresh.length)]!;
  state.used.push(pick.word);
  return pick;
}

function blankRound(entry: Entry): RoundState {
  return { phase: "write", deadline: 0, phaseMs: 0, entry, entries: {}, options: [], ballot: null, gained: {} };
}

function startRound(state: State, ctx: GameContext, out: Out): void {
  state.round = blankRound(pickEntry(state, ctx));
  setPhase(state, "write", WRITE_MS[state.variant], ctx, out);
  out.events.push(pub({ type: "round-started", round: state.roundNumber }));
}

function nextRound(state: State, ctx: GameContext, out: Out): void {
  if (state.roundNumber >= state.settings.rounds) return finish(state, "done", out);
  state.roundNumber++;
  startRound(state, ctx, out);
}

/** Six random base-36 characters, unique in the round. Nothing to read in them. */
function freshId(taken: Set<string>, ctx: GameContext): string {
  for (;;) {
    let id = "";
    for (let i = 0; i < ID_CHARS; i++) id += ctx.randomInt(36).toString(36);
    if (!taken.has(id)) {
      taken.add(id);
      return id;
    }
  }
}

function openVote(state: State, ctx: GameContext, out: Out): void {
  const r = state.round;
  const rules = RULES[state.variant];
  const fakes = written(r);
  for (const id of activeIds(state)) if (!(id in r.entries)) r.entries[id] = null;
  if (!fakes.length) {
    out.events.push(pub({ type: "no-fakes" }));
    return reveal(state, ctx, out);
  }
  const pool: { author: string | null; text: string }[] = [
    { author: null, text: rules.show(rules.answer(r.entry)) },
    ...fakes.map(([author, text]) => ({ author, text: rules.show(text) })),
  ];
  shuffle(pool, ctx.randomInt);
  const taken = new Set<string>();
  r.options = pool.map((o) => ({ id: freshId(taken, ctx), ...o }));
  r.ballot = openBallot(activeIds(state));
  setPhase(state, "vote", VOTE_MS, ctx, out);
  out.events.push(pub({ type: "vote-open" }));
}

/** Points, then the answer on screen for a bit. */
function reveal(state: State, ctx: GameContext, out: Out): void {
  const r = state.round;
  const gained: Record<string, number> = {};
  const real = r.options.find((o) => o.author === null);
  if (r.ballot) {
    for (const voter of r.ballot.eligible) {
      const choice = r.options.find((o) => o.id === r.ballot!.votes[voter]);
      if (!choice) continue;
      if (choice.author === null) gained[voter] = (gained[voter] ?? 0) + FOUND_POINTS;
      else gained[choice.author] = (gained[choice.author] ?? 0) + FOOLED_POINTS;
    }
  }
  for (const p of state.players) p.score += gained[p.id] ?? 0;
  r.gained = gained;
  setPhase(state, "reveal", REVEAL_MS, ctx, out);
  out.events.push(pub({ type: "revealed", realId: real?.id ?? null }));
}

/** The clock ran out on the current phase. */
function expire(state: State, ctx: GameContext, out: Out): void {
  switch (state.round.phase) {
    case "write":
      return openVote(state, ctx, out);
    case "vote":
      return reveal(state, ctx, out);
    case "reveal":
      return nextRound(state, ctx, out);
  }
}

/** Moves on early if everyone still here has done this phase's thing. */
function check(state: State, ctx: GameContext, out: Out): void {
  if (state.phase === "finished") return;
  const r = state.round;
  if (r.phase === "write") {
    if (allHere(state, activeIds(state), (id) => id in r.entries)) openVote(state, ctx, out);
  } else if (r.phase === "vote") {
    const b = r.ballot!;
    if (allVoted(b) || allHere(state, b.eligible, (id) => id in b.votes)) reveal(state, ctx, out);
  }
}

/** Who the phase is waiting on, dropped or not: the host can skip the dropped. */
function awaited(state: State): string[] {
  if (state.phase === "finished") return [];
  const r = state.round;
  if (r.phase === "write") return activeIds(state).filter((id) => !(id in r.entries));
  if (r.phase === "vote") return r.ballot!.eligible.filter((id) => !(id in r.ballot!.votes));
  return [];
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function parseSettings(input: unknown): BluffSettings | null {
  if (input === undefined || input === null) return { ...DEFAULT_SETTINGS };
  if (typeof input !== "object" || Array.isArray(input)) return null;
  const s = { ...DEFAULT_SETTINGS, ...(input as Partial<BluffSettings>) };
  if (!ROUND_OPTIONS.includes(s.rounds)) return null;
  return { rounds: s.rounds };
}

function parseAction(input: unknown): BluffAction | null {
  if (typeof input !== "object" || input === null) return null;
  const a = input as Record<string, unknown>;
  switch (a.type) {
    case "next":
      return { type: "next" };
    case "submit":
      return typeof a.text === "string" && a.text.length <= 1000 ? { type: "submit", text: a.text } : null;
    case "vote":
      return typeof a.optionId === "string" && a.optionId.length <= 20 ? { type: "vote", optionId: a.optionId } : null;
    default:
      return null;
  }
}

/** What a rematch of the same game gets: the words already played. */
function parseCarry(carry: unknown): string[] {
  if (typeof carry !== "object" || carry === null) return [];
  const used = (carry as { used?: unknown }).used;
  return Array.isArray(used) ? used.filter((w): w is string => typeof w === "string").slice(-500) : [];
}

// ---------------------------------------------------------------------------
// Definition
// ---------------------------------------------------------------------------

export function makeBluffGame(variant: Variant): Definition {
  const rules = RULES[variant];
  const { manifest } = rules;
  return {
    manifest,
    defaultSettings: DEFAULT_SETTINGS,
    parseSettings,
    parseAction,

    createGame(players, settings, match, ctx, options) {
      const n = players.length;
      if (n < manifest.minPlayers || n > manifest.maxPlayers) {
        throw new Error(`${manifest.id}: needs ${manifest.minPlayers}–${manifest.maxPlayers} players, got ${n}`);
      }
      // Checked now, so a bad test deck fails at the start rather than mid-game.
      const deck = options?.deck ? parseDeck(options.deck) : null;
      const placeholder: Entry = { word: "", definition: "", notes: "" };
      const state: State = {
        variant,
        phase: "playing",
        settings,
        players: players.map((p) => ({ id: p.id, score: 0, removed: false, away: false })),
        roundNumber: 1,
        round: blankRound(placeholder),
        used: parseCarry(match.carry),
        deck,
        endReason: null,
      };
      const out = newOut();
      startRound(state, ctx, out);
      return done(state, out);
    },

    handleAction(prev, playerId, action, ctx) {
      if (prev.phase === "finished") return reject("game-finished", "The game is over.");
      const me = find(prev, playerId);
      if (!me || !active(me)) return reject("not-in-game", "You're not in this game.");
      const r = prev.round;
      if (r.phase !== "reveal" && ctx.now >= r.deadline) return reject("time-up", "Time's up.");

      const state = clone(prev);
      const s = state.round;
      const out = newOut();

      switch (action.type) {
        case "submit": {
          if (r.phase !== "write") return reject("wrong-phase", "Writing's over.");
          if (playerId in r.entries) return reject("already", "You've sent yours.");
          const text = rules.clean(action.text);
          const others = written(r)
            .filter(([id]) => id !== playerId)
            .map(([, t]) => t);
          const problem = rules.problem(text, r.entry, others);
          if (problem) return reject("bad-entry", problem);
          s.entries[playerId] = text;
          break;
        }
        case "vote": {
          if (r.phase !== "vote") return reject("wrong-phase", "Not voting now.");
          const mine = s.options.find((o) => o.author === playerId);
          if (mine && action.optionId === mine.id) return reject("own-entry", "That one's yours.");
          const allowed = s.options.filter((o) => o.author !== playerId).map((o) => o.id);
          const error = castVote(s.ballot!, playerId, action.optionId, allowed);
          if (error) return { ok: false, error };
          break;
        }
        case "next": {
          if (ctx.hostId !== playerId) return reject("host-only", "Only the host can do that.");
          if (r.phase !== "reveal") return reject("wrong-phase", "Not now.");
          nextRound(state, ctx, out);
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
      if (activeIds(state).length < MIN_PLAYERS) {
        finish(state, "abandoned", out);
        return done(state, out);
      }
      // Mid-write, whatever they sent stays in. Mid-vote, their vote goes;
      // their fake stays on the board.
      if (state.round.phase === "vote") dropVoter(state.round.ballot!, playerId);
      check(state, ctx, out);
      return done(state, out);
    },

    skipTurn(prev, playerId, ctx) {
      if (prev.phase === "finished" || !awaited(prev).includes(playerId)) return { state: prev, events: [] };
      const state = clone(prev);
      const out = newOut();
      const r = state.round;
      out.events.push(pub({ type: "skipped", playerId }));
      if (r.phase === "write") r.entries[playerId] = null;
      else if (r.phase === "vote") dropVoter(r.ballot!, playerId);
      check(state, ctx, out);
      return done(state, out);
    },

    getPublicState(state) {
      const r = state.round;
      const over = state.phase === "finished";
      const shown = r.phase === "reveal";
      const isDone = (id: string): boolean => {
        if (over) return false;
        if (r.phase === "write") return id in r.entries;
        if (r.phase === "vote") return !!r.ballot && id in r.ballot.votes;
        return false;
      };
      const fake = variant === "fake-word";
      let authors: Record<string, string> | null = null;
      if (shown) {
        authors = {};
        for (const o of r.options) if (o.author !== null) authors[o.id] = o.author;
      }
      return {
        variant,
        phase: over ? "finished" : r.phase,
        round: state.roundNumber,
        rounds: state.settings.rounds,
        deadline: r.deadline,
        phaseMs: r.phaseMs,
        players: state.players.map((p) => ({ id: p.id, score: p.score, removed: p.removed, done: isDone(p.id) })),
        word: !fake || shown ? r.entry.word : null,
        definition: fake || shown ? r.entry.definition : null,
        notes: shown ? r.entry.notes : null,
        options: r.phase === "write" ? null : r.options.map((o) => ({ id: o.id, text: o.text })),
        realId: shown ? (r.options.find((o) => o.author === null)?.id ?? null) : null,
        authors,
        votes: shown && r.ballot ? { ...r.ballot.votes } : null,
        gained: shown ? { ...r.gained } : null,
        noFakes: r.phase !== "write" && r.options.length === 0,
        endReason: state.endReason,
      };
    },

    getPrivateState(state, playerId) {
      const r = state.round;
      const p = find(state, playerId);
      if (!p || p.removed) return { mine: null, sent: false, mineId: null, vote: null, choices: [] };
      const live = state.phase === "playing";
      const voting = live && r.phase === "vote" && !!r.ballot?.eligible.includes(playerId);
      return {
        mine: r.entries[playerId] ?? null,
        sent: playerId in r.entries,
        mineId: r.options.find((o) => o.author === playerId)?.id ?? null,
        vote: r.ballot?.votes[playerId] ?? null,
        choices: voting ? r.options.filter((o) => o.author !== playerId).map((o) => o.id) : [],
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

    carryOver(state) {
      return { used: state.used };
    },
  };
}

export const fakeWordGame = makeBluffGame("fake-word");
export const bluffDefinitionsGame = makeBluffGame("bluff-definitions");
