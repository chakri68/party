import type { GameContext, GameDefinition, GameEventEnvelope, GameResult, TimerRequest } from "@games/game-core";
import { samePageManifest } from "../shared/manifest.ts";
import { PROMPT_POOL, promptId } from "../shared/pool.ts";
import { biggestFirst, groupAnswers, mergeProblem, nearMerges, pruneMerges, scoreRound, splitGroup, topLevel, viewGroups } from "../shared/rules.ts";
import {
  ALL_IN_MS,
  ANSWER_SECONDS_OPTIONS,
  DEFAULT_SETTINGS,
  type EndReason,
  MAX_ANSWER,
  MIN_PLAYERS,
  type Phase,
  type Prompt,
  REVEAL_MS,
  ROUNDS_OPTIONS,
  type SamePageAction,
  type SamePageCarry,
  type SamePageEvent,
  type SamePagePlayerState,
  type SamePagePrivateState,
  type SamePagePublicState,
  type SamePageServerState,
  type SamePageSettings,
  TIDY_MS,
} from "../shared/types.ts";

type State = SamePageServerState;
type Player = SamePagePlayerState;
type Events = GameEventEnvelope<SamePageEvent>[];

const pub = (event: SamePageEvent): GameEventEnvelope<SamePageEvent> => ({ visibility: { kind: "public" }, event });
const priv = (playerId: string, event: SamePageEvent): GameEventEnvelope<SamePageEvent> => ({ visibility: { kind: "private", playerId }, event });

const reject = (code: string, message: string): GameResult<State, SamePageEvent> => ({ ok: false, error: { code, message } });

/** The phase's deadline. Setting it again replaces it. */
const PHASE = "phase";
/** An alarm this early is a stray, not the deadline. */
const SLACK_MS = 500;
/** Longest raw answer parseAction lets through; the real limit is checked after trimming. */
const RAW_MAX = 200;

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
const deckOf = (state: State): readonly Prompt[] => state.deck ?? PROMPT_POOL;
const here = (state: State) => state.players.filter((p) => active(p) && !p.away);
const noteHost = (state: State, ctx: GameContext) => {
  if (ctx.hostId !== undefined) state.hostId = ctx.hostId;
};

function setPhase(state: State, phase: Phase, ms: number, ctx: GameContext, out: Out): void {
  state.phase = phase;
  state.deadline = ctx.now + ms;
  state.phaseMs = ms;
  out.timers.push({ kind: "set", timerId: PHASE, delayMs: ms });
}

/** Fresh to this match and the last one if there are any, else just fresh to this one. */
function pickPrompt(state: State, ctx: GameContext): Prompt {
  const deck = deckOf(state);
  let pool = deck.filter((p) => !state.used.includes(p.id) && !state.usedBefore.includes(p.id));
  if (!pool.length) pool = deck.filter((p) => !state.used.includes(p.id));
  const prompt = pool[ctx.randomInt(pool.length)]!;
  state.used.push(prompt.id);
  return prompt;
}

function startRound(state: State, number: number, ctx: GameContext, out: Out): void {
  const prompt = pickPrompt(state, ctx);
  state.round = { number, promptId: prompt.id, prompt: prompt.text, answers: {}, groups: [], merges: [], ready: [], hurried: false, result: null };
  setPhase(state, "answering", state.settings.answerSeconds * 1000, ctx, out);
  out.events.push(pub({ type: "round", round: number, prompt: prompt.text }));
}

function finish(state: State, reason: EndReason, out: Out): void {
  state.phase = "over";
  state.deadline = 0;
  state.phaseMs = 0;
  state.endReason = reason;
  out.timers.push({ kind: "cancel", timerId: PHASE });
  out.events.push(pub({ type: "game-over", reason }));
}

/** The machine's groups from whoever's still in, seat order. */
function rebuildGroups(state: State): void {
  const r = state.round;
  const entries = state.players.filter((p) => active(p) && r.answers[p.id]).map((p) => ({ id: p.id, text: r.answers[p.id]! }));
  r.groups = groupAnswers(entries);
  // The machine's merges are worked out afresh; the host's survive if both sides still exist.
  r.merges = [...nearMerges(r.groups, r.answers), ...pruneMerges(r.groups, r.merges.filter((m) => !m.auto))];
}

/** Answers are in: group them, and let the host tidy if there's anything to tidy. */
function endAnswering(state: State, ctx: GameContext, out: Out): void {
  rebuildGroups(state);
  // Nothing to tidy: one group and nothing in it the host could split.
  if (topLevel(state.round.groups, state.round.merges).length < 2 && !state.round.merges.length) return reveal(state, ctx, out);
  setPhase(state, "tidying", TIDY_MS, ctx, out);
  out.events.push(pub({ type: "tidying" }));
}

function reveal(state: State, ctx: GameContext, out: Out): void {
  const r = state.round;
  const groups = biggestFirst(viewGroups(r.groups, r.merges, r.answers));
  const scores = Object.fromEntries(state.players.filter(active).map((p) => [p.id, p.score]));
  const { winners, points, loneId } = scoreRound(groups, state.settings.lone, scores);
  for (const [id, n] of Object.entries(points)) find(state, id)!.score += n;
  r.result = {
    groups,
    winners,
    blanks: state.players.filter((p) => active(p) && !r.answers[p.id]).map((p) => p.id),
    points,
    loneId,
  };
  setPhase(state, "reveal", REVEAL_MS, ctx, out);
  out.events.push(pub({ type: "revealed", round: r.number }));
}

function nextRound(state: State, ctx: GameContext, out: Out): void {
  if (state.round.number >= state.settings.rounds) return finish(state, "rounds", out);
  startRound(state, state.round.number + 1, ctx, out);
}

/** Everyone who's here has answered: the clock drops so nobody waits out the rest. */
function checkAllIn(state: State, ctx: GameContext, out: Out): void {
  const r = state.round;
  if (state.phase !== "answering" || r.hurried) return;
  const people = here(state);
  if (!people.length || !people.every((p) => r.answers[p.id])) return;
  r.hurried = true;
  if (state.deadline - ctx.now <= ALL_IN_MS) return;
  state.deadline = ctx.now + ALL_IN_MS;
  out.timers.push({ kind: "set", timerId: PHASE, delayMs: ALL_IN_MS });
  out.events.push(pub({ type: "hurry" }));
}

function checkAllReady(state: State, ctx: GameContext, out: Out): void {
  if (state.phase !== "reveal") return;
  const people = here(state);
  if (people.length && people.every((p) => state.round.ready.includes(p.id))) nextRound(state, ctx, out);
}

function expire(state: State, ctx: GameContext, out: Out): void {
  switch (state.phase) {
    case "answering":
      return endAnswering(state, ctx, out);
    case "tidying":
      return reveal(state, ctx, out);
    case "reveal":
      return nextRound(state, ctx, out);
    default:
      return;
  }
}

function awaited(state: State): string[] {
  const r = state.round;
  switch (state.phase) {
    case "answering":
      return here(state).filter((p) => !r.answers[p.id]).map((p) => p.id);
    case "tidying": {
      const host = state.hostId ? find(state, state.hostId) : undefined;
      return host && active(host) && !host.away ? [host.id] : [];
    }
    case "reveal":
      return here(state).filter((p) => !r.ready.includes(p.id)).map((p) => p.id);
    default:
      return [];
  }
}

/** Last match's ids plus this one's, unless that leaves too few for another full game. */
function usedIds(state: State): string[] {
  const all = [...new Set([...state.usedBefore, ...state.used])];
  const most = Math.max(...ROUNDS_OPTIONS);
  return deckOf(state).length - all.length < most ? [...state.used] : all;
}

function parseCarry(raw: unknown): SamePageCarry | null {
  if (typeof raw !== "object" || raw === null) return null;
  const used = (raw as { used?: unknown }).used;
  return Array.isArray(used) && used.every((u) => typeof u === "string") ? { used } : null;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function parseSettings(input: unknown): SamePageSettings | null {
  if (input === undefined || input === null) return { ...DEFAULT_SETTINGS };
  if (typeof input !== "object" || Array.isArray(input)) return null;
  const s = { ...DEFAULT_SETTINGS, ...(input as Partial<SamePageSettings>) };
  if (!ROUNDS_OPTIONS.includes(s.rounds)) return null;
  if (!ANSWER_SECONDS_OPTIONS.includes(s.answerSeconds)) return null;
  if (typeof s.lone !== "boolean") return null;
  return { rounds: s.rounds, answerSeconds: s.answerSeconds, lone: s.lone };
}

function parseAction(input: unknown): SamePageAction | null {
  if (typeof input !== "object" || input === null) return null;
  const a = input as Record<string, unknown>;
  const str = (v: unknown, max = 64): v is string => typeof v === "string" && v.length <= max;
  switch (a.type) {
    case "answer":
      return str(a.text, RAW_MAX) ? { type: "answer", text: a.text } : null;
    case "merge":
      return str(a.from) && str(a.into) ? { type: "merge", from: a.from, into: a.into } : null;
    case "split":
      return str(a.group) ? { type: "split", group: a.group } : null;
    case "done":
    case "ready":
      return { type: a.type };
    default:
      return null;
  }
}

/** Trimmed, inner runs of space squashed to one. */
const tidyText = (text: string) => text.trim().replace(/\s+/g, " ");

// ---------------------------------------------------------------------------
// Definition
// ---------------------------------------------------------------------------

export const samePageGame: GameDefinition<
  SamePageServerState,
  SamePageAction,
  SamePagePublicState,
  SamePagePrivateState,
  SamePageSettings,
  SamePageEvent
> = {
  manifest: samePageManifest,
  defaultSettings: DEFAULT_SETTINGS,
  parseSettings,
  parseAction,

  createGame(players, settings, match, ctx, options) {
    const n = players.length;
    const { minPlayers, maxPlayers } = samePageManifest;
    if (n < minPlayers || n > maxPlayers) throw new Error(`same-page: needs ${minPlayers}–${maxPlayers} players, got ${n}`);
    let deck: Prompt[] | null = null;
    if (options?.deck) {
      const texts = options.deck as string[];
      if (texts.some((t) => typeof t !== "string" || !t.trim())) throw new Error("A deck must be prompts.");
      deck = texts.map((text) => ({ id: promptId(text), text }));
      if (new Set(deck.map((p) => p.id)).size !== deck.length) throw new Error("A deck's prompts must be distinct.");
      if (deck.length < settings.rounds) throw new Error(`A deck needs at least ${settings.rounds} prompts.`);
    }
    const state: State = {
      phase: "answering",
      settings,
      players: players.map((p, seat) => ({ id: p.id, seat, score: 0, removed: false, away: false })),
      deadline: 0,
      phaseMs: 0,
      round: { number: 0, promptId: "", prompt: "", answers: {}, groups: [], merges: [], ready: [], hurried: false, result: null },
      used: [],
      usedBefore: parseCarry(match.carry)?.used ?? [],
      deck,
      hostId: ctx.hostId ?? null,
      endReason: null,
    };
    const out = newOut();
    startRound(state, 1, ctx, out);
    return done(state, out);
  },

  handleAction(prev, playerId, action, ctx) {
    if (prev.phase === "over") return reject("game-finished", "The game is over.");
    const me = find(prev, playerId);
    if (!me || !active(me)) return reject("not-in-game", "You're not in this game.");
    const host = ctx.hostId === playerId;

    const state = clone(prev);
    noteHost(state, ctx);
    const out = newOut();
    const r = state.round;

    switch (action.type) {
      case "answer": {
        if (prev.phase !== "answering") return reject("wrong-phase", "Answers are closed.");
        if (ctx.now >= prev.deadline) return reject("time-up", "Time's up.");
        const text = tidyText(action.text);
        if (text.length > MAX_ANSWER) return reject("too-long", `Keep it under ${MAX_ANSWER} characters.`);
        const was = !!r.answers[playerId];
        if (text) r.answers[playerId] = text;
        else delete r.answers[playerId];
        out.events.push(priv(playerId, { type: "you-answered", text }));
        if (was !== !!text) out.events.push(pub({ type: "answered", playerId, in: !!text }));
        checkAllIn(state, ctx, out);
        break;
      }
      case "merge": {
        if (!host) return reject("host-only", "Only the host can merge groups.");
        if (prev.phase !== "tidying") return reject("wrong-phase", "Nothing to tidy right now.");
        const problem = mergeProblem(r.groups, r.merges, action.from, action.into);
        if (problem) return reject("bad-merge", problem);
        r.merges.push({ from: action.from, into: action.into });
        out.events.push(pub({ type: "merged", from: action.from, into: action.into }));
        break;
      }
      case "split": {
        if (!host) return reject("host-only", "Only the host can split groups.");
        if (prev.phase !== "tidying") return reject("wrong-phase", "Nothing to tidy right now.");
        const top = topLevel(r.groups, r.merges).some((g) => g.id === action.group);
        if (!top || !r.merges.some((m) => m.into === action.group)) return reject("bad-split", "Nothing was merged into that group.");
        r.merges = splitGroup(r.merges, action.group);
        out.events.push(pub({ type: "split", group: action.group }));
        break;
      }
      case "done": {
        if (!host) return reject("host-only", "Only the host can finish tidying.");
        if (prev.phase !== "tidying") return reject("wrong-phase", "Nothing to tidy right now.");
        reveal(state, ctx, out);
        break;
      }
      case "ready": {
        if (prev.phase !== "reveal") return reject("wrong-phase", "Nothing to be ready for.");
        if (!r.ready.includes(playerId)) r.ready.push(playerId);
        checkAllReady(state, ctx, out);
        break;
      }
    }
    return { ok: true, transition: done(state, out) };
  },

  onTimer(prev, timerId, ctx) {
    if (prev.phase === "over" || timerId !== PHASE || prev.deadline === 0) return { state: prev, events: [] };
    // A duplicate or early alarm is harmless: only a due deadline moves the game.
    if (ctx.now < prev.deadline - SLACK_MS) {
      return { state: prev, events: [], timers: [{ kind: "set", timerId: PHASE, delayMs: prev.deadline - ctx.now }] };
    }
    const state = clone(prev);
    noteHost(state, ctx);
    const out = newOut();
    expire(state, ctx, out);
    return done(state, out);
  },

  onPlayerDisconnected(prev, playerId, ctx) {
    const p = find(prev, playerId);
    if (prev.phase === "over" || !p || p.removed) return { state: prev, events: [] };
    const state = clone(prev);
    const out = newOut();
    find(state, playerId)!.away = true;
    // An answer already in stays in. Nobody else waits on them either way.
    checkAllIn(state, ctx, out);
    checkAllReady(state, ctx, out);
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
    if (prev.phase === "over" || !p || p.removed) return { state: prev, events: [] };
    const state = clone(prev);
    const out = newOut();
    const r = state.round;
    find(state, playerId)!.removed = true;
    out.events.push(pub({ type: "player-removed", playerId }));
    delete r.answers[playerId];
    r.ready = r.ready.filter((id) => id !== playerId);
    if (state.players.filter(active).length < MIN_PLAYERS) {
      finish(state, "abandoned", out);
    } else if (state.phase === "answering") {
      checkAllIn(state, ctx, out);
    } else if (state.phase === "tidying") {
      rebuildGroups(state);
    } else if (state.phase === "reveal" && r.result) {
      // Points are settled; the groups just stop showing them.
      const res = r.result;
      res.groups = res.groups
        .map((g) => ({ ...g, members: g.members.filter((m) => m.id !== playerId) }))
        .filter((g) => g.members.length);
      res.winners = res.winners.filter((id) => res.groups.some((g) => g.id === id));
      res.blanks = res.blanks.filter((id) => id !== playerId);
      delete res.points[playerId];
      if (res.loneId === playerId) res.loneId = null;
      checkAllReady(state, ctx, out);
    }
    return done(state, out);
  },

  skipTurn(prev, playerId, ctx) {
    if (prev.phase === "over" || !awaited(prev).includes(playerId)) return { state: prev, events: [] };
    const state = clone(prev);
    const out = newOut();
    // Answering runs on its clock: a skip there changes nothing. A stalled
    // tidy-up goes to the reveal; a reveal counts them as ready.
    if (state.phase === "tidying") reveal(state, ctx, out);
    else if (state.phase === "reveal") {
      state.round.ready.push(playerId);
      checkAllReady(state, ctx, out);
    }
    return done(state, out);
  },

  getPublicState(state) {
    const r = state.round;
    const answering = state.phase === "answering";
    const groups =
      state.phase === "tidying" ? viewGroups(r.groups, r.merges, r.answers) : state.phase === "reveal" || state.phase === "over" ? (r.result?.groups ?? null) : null;
    return {
      phase: state.phase,
      round: r.number,
      rounds: state.settings.rounds,
      prompt: r.prompt,
      deadline: state.deadline,
      phaseMs: state.phaseMs,
      lone: state.settings.lone,
      players: state.players.map((p) => ({ id: p.id, score: p.score, removed: p.removed, answered: answering && !!r.answers[p.id] })),
      groups: groups ? structuredClone(groups) : null,
      result: r.result && !answering ? structuredClone(r.result) : null,
      endReason: state.endReason,
    };
  },

  getPrivateState(state, playerId) {
    const p = find(state, playerId);
    if (!p || p.removed) return { answer: null, canAnswer: false };
    return { answer: state.round.answers[playerId] ?? null, canAnswer: state.phase === "answering" };
  },

  getAwaitedPlayerIds: awaited,

  getResult(state) {
    if (state.phase !== "over") return null;
    const live = state.players.filter(active);
    const top = Math.max(0, ...live.map((p) => p.score));
    const pts = (n: number) => `${n} ${n === 1 ? "point" : "points"}`;
    return {
      winnerIds: top > 0 ? live.filter((p) => p.score === top).map((p) => p.id) : [],
      standings: [...state.players]
        .sort((x, y) => Number(x.removed) - Number(y.removed) || y.score - x.score || x.seat - y.seat)
        .map((p) => ({ playerId: p.id, value: p.score, label: `${pts(p.score)}${p.removed ? ", left" : ""}` })),
    };
  },

  carryOver(state): SamePageCarry {
    return { used: usedIds(state) };
  },
};
