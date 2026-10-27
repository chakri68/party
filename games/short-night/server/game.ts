import {
  type Ballot,
  castVote,
  dropVoter,
  type GameContext,
  type GameDefinition,
  type GameEventEnvelope,
  type GameResult,
  openBallot,
  shuffle,
  tally,
  type TimerRequest,
} from "@games/game-core";
import { shortNightManifest } from "../shared/manifest.ts";
import { deckOf, isRoleId, MAX_PLAYERS, MIN_PLAYERS, nightSteps, readsAsWolf, type RoleId, ROLES, roleById, setupProblem } from "../shared/roles.ts";
import { parseShortNightSettings } from "../shared/rules-text.ts";
import {
  DEFAULT_SETTINGS,
  type EndReason,
  MIN_LEFT,
  type NightLogEntry,
  type NightResult,
  NOBODY,
  REVEAL_MS,
  RUNOFF_MS,
  type ShortNightAction,
  type ShortNightEvent,
  type ShortNightPlayer,
  type ShortNightPrivateState,
  type ShortNightPublicState,
  type ShortNightServerState,
  type ShortNightSettings,
  VOTE_MS,
} from "../shared/types.ts";

type State = ShortNightServerState;
type Events = GameEventEnvelope<ShortNightEvent>[];

const pub = (event: ShortNightEvent): GameEventEnvelope<ShortNightEvent> => ({ visibility: { kind: "public" }, event });

const reject = (code: string, message: string): GameResult<State, ShortNightEvent> => ({
  ok: false,
  error: { code, message },
});

/** One timer: the phase's (or the night step's) deadline. Setting it again replaces it. */
const PHASE = "phase";
/** An alarm this early is a stray, not the deadline. */
const SLACK_MS = 500;

// ---------------------------------------------------------------------------
// Internals. Helpers mutate the state they're given; the public API always
// hands them a fresh clone.
// ---------------------------------------------------------------------------

interface Out {
  events: Events;
  timers: TimerRequest[];
}

const clone = (state: State): State => structuredClone(state);
const newOut = (): Out => ({ events: [], timers: [] });
const done = (state: State, out: Out) => ({ state, events: out.events, timers: out.timers });

const find = (state: State, id: string): ShortNightPlayer | undefined => state.players.find((p) => p.id === id);
const activeIds = (state: State) => state.players.filter((p) => !p.left).map((p) => p.id);
const allIds = (state: State) => state.players.map((p) => p.id);
const holders = (state: State, role: RoleId) => allIds(state).filter((id) => state.cards[id] === role);
const voting = (state: State) => state.phase === "vote" || state.phase === "runoff";
const ballotOf = (state: State): Ballot | null => (state.phase === "runoff" ? state.runoff : state.phase === "vote" ? state.ballot : null);
const pick = <T>(items: readonly T[], ctx: GameContext): T => items[ctx.randomInt(items.length)]!;

/** Everyone connected and still in has done it. Nobody connected: the clock decides. */
function allHere(state: State, ids: readonly string[], isDone: (id: string) => boolean): boolean {
  const here = ids.filter((id) => {
    const p = find(state, id);
    return p && !p.left && !p.away;
  });
  return here.length > 0 && here.every(isDone);
}

function setPhase(state: State, phase: State["phase"], ms: number, ctx: GameContext, out: Out): void {
  state.phase = phase;
  state.deadline = ctx.now + ms;
  state.phaseMs = ms;
  out.timers.push({ kind: "set", timerId: PHASE, delayMs: ms });
}

function finish(state: State, reason: EndReason, out: Out): void {
  state.phase = "finished";
  state.endReason = reason;
  state.deadline = 0;
  state.phaseMs = 0;
  if (reason !== "done") state.winner = null;
  out.timers.push({ kind: "cancel", timerId: PHASE });
  out.events.push(pub({ type: "game-over", winner: state.winner, out: state.out, reason }));
}

// ---- the deal ------------------------------------------------------------

/**
 * Results that need no pick, drawn now so the night never consults anything
 * but the deal. Each is shown from its role's step.
 */
function drawPassive(state: State, ctx: GameContext): void {
  const ids = allIds(state);
  const card = (id: string) => state.cards[id]!;
  const wolves = holders(state, "wolf");
  const villagers = holders(state, "villager");
  for (const id of wolves) {
    state.results[id] = { kind: "wolves", pack: wolves, villager: null };
  }
  if (wolves.length === 1) {
    // The lone Wolf's consolation.
    state.results[wolves[0]!] = { kind: "wolves", pack: wolves, villager: villagers.length ? pick(villagers, ctx) : null };
  }
  for (const id of holders(state, "bellringer")) {
    const i = ids.indexOf(id);
    const left = ids[(i - 1 + ids.length) % ids.length]!;
    const right = ids[(i + 1) % ids.length]!;
    const count = [left, right].filter((n) => readsAsWolf(card(n))).length;
    state.results[id] = { kind: "bell", neighbours: [left, right], count };
  }
  for (const id of holders(state, "gossip")) {
    const others = ids.filter((o) => o !== id);
    const wolf = pick(others.filter((o) => readsAsWolf(card(o))), ctx);
    const other = pick(others.filter((o) => o !== wolf), ctx);
    state.results[id] = { kind: "gossip", pair: ctx.randomInt(2) ? [wolf, other] : [other, wolf] };
  }
}

/** A picker's result. Team checks see the Stray as a wolf; the Wanderer sees cards. */
function resolvePick(state: State, role: RoleId, targets: string[], ctx: GameContext): NightResult {
  const card = (id: string) => state.cards[id]!;
  const reads = (id: string) => (readsAsWolf(card(id)) ? "wolves" : "village");
  switch (role) {
    case "lamplighter":
      return { kind: "lamp", target: targets[0]!, reads: reads(targets[0]!) };
    case "matchmaker":
      return { kind: "match", targets: [targets[0]!, targets[1]!], same: reads(targets[0]!) === reads(targets[1]!) };
    case "wanderer": {
      const theirs = card(targets[0]!);
      const others = (Object.keys(state.deck) as RoleId[]).filter((r) => r !== theirs);
      return { kind: "wander", target: targets[0]!, notRole: pick(others, ctx) };
    }
    default:
      throw new Error(`short-night: ${role} doesn't pick`);
  }
}

// ---- the night -----------------------------------------------------------

const stepRole = (state: State): RoleId | null => (state.phase === "night" ? (state.steps[state.step] ?? null) : null);

function startStep(state: State, index: number, ctx: GameContext, out: Out): void {
  state.step = index;
  setPhase(state, "night", state.settings.stepSeconds * 1000, ctx, out);
  out.events.push(pub({ type: "night-step", step: index, waking: state.steps[index]! }));
}

/** A step ran out: pickers who didn't pick get nothing, then the next step or morning. */
function endStep(state: State, ctx: GameContext, out: Out): void {
  const role = stepRole(state)!;
  if (roleById(role).picks) {
    for (const id of holders(state, role)) if (!state.results[id]) state.results[id] = { kind: "missed" };
  }
  if (state.step + 1 < state.steps.length) return startStep(state, state.step + 1, ctx, out);
  state.step = state.steps.length;
  setPhase(state, "day", state.settings.discussMinutes * 60_000, ctx, out);
  out.events.push(pub({ type: "day" }));
}

/** Has this role's step started (or the night passed)? */
function stepReached(state: State, role: RoleId): boolean {
  if (state.phase === "reveal") return false;
  if (state.phase !== "night") return true;
  return state.steps.indexOf(role) <= state.step;
}

// ---- the vote ------------------------------------------------------------

function openVote(state: State, ctx: GameContext, out: Out): void {
  state.ballot = openBallot(activeIds(state));
  setPhase(state, "vote", VOTE_MS, ctx, out);
  out.events.push(pub({ type: "vote-open", runoff: false }));
}

function openRunoff(state: State, tied: string[], ctx: GameContext, out: Out): void {
  state.tied = tied;
  state.runoff = openBallot(activeIds(state));
  setPhase(state, "runoff", RUNOFF_MS, ctx, out);
  out.events.push(pub({ type: "vote-open", runoff: true }));
}

/** Who a voter may pick right now. */
function choicesFor(state: State, voterId: string): string[] {
  if (state.phase === "vote") return [...activeIds(state).filter((id) => id !== voterId), NOBODY];
  if (state.phase === "runoff") return state.tied.filter((id) => id !== voterId);
  return [];
}

function settle(state: State, out: string | null, o: Out): void {
  state.out = out;
  state.winner = out !== null && state.cards[out] === "wolf" ? "village" : "wolves";
  finish(state, "done", o);
}

function closeVote(state: State, ctx: GameContext, out: Out): void {
  if (state.phase === "vote") {
    const named = activeIds(state);
    const { counts } = tally(state.ballot!, [...named, NOBODY], `${state.seed}:vote`);
    const top = Math.max(0, ...named.map((id) => counts[id]!));
    // Nobody goes if nobody got a vote, or if "nobody" beat every player outright.
    if (top === 0 || counts[NOBODY]! > top) return settle(state, null, out);
    const leaders = named.filter((id) => counts[id] === top);
    if (leaders.length === 1) return settle(state, leaders[0]!, out);
    return openRunoff(state, leaders, ctx, out);
  }
  const { counts } = tally(state.runoff!, state.tied, `${state.seed}:runoff`);
  const top = Math.max(0, ...state.tied.map((id) => counts[id]!));
  const leaders = state.tied.filter((id) => counts[id] === top);
  // Still tied (or nobody voted): nobody goes.
  settle(state, top > 0 && leaders.length === 1 ? leaders[0]! : null, out);
}

// ---- moving on -----------------------------------------------------------

function expire(state: State, ctx: GameContext, out: Out): void {
  switch (state.phase) {
    case "reveal":
      return startStep(state, 0, ctx, out);
    case "night":
      return endStep(state, ctx, out);
    case "day":
      return openVote(state, ctx, out);
    case "vote":
    case "runoff":
      return closeVote(state, ctx, out);
    case "finished":
      return;
  }
}

/** Moves on early where the phase allows: the reveal and the ballots. Never the night. */
function check(state: State, ctx: GameContext, out: Out): void {
  if (state.phase === "reveal") {
    if (allHere(state, activeIds(state), (id) => state.acks.includes(id))) startStep(state, 0, ctx, out);
    return;
  }
  const b = ballotOf(state);
  if (b && allHere(state, b.eligible, (id) => id in b.votes)) closeVote(state, ctx, out);
}

/** The round can't go on fairly. Checked whenever someone leaves. */
function brokenBy(state: State): EndReason | null {
  if (!activeIds(state).some((id) => state.cards[id] === "wolf")) return "last-wolf-left";
  if (activeIds(state).length < MIN_LEFT) return "too-few";
  return null;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function parseAction(input: unknown): ShortNightAction | null {
  if (typeof input !== "object" || input === null) return null;
  const a = input as Record<string, unknown>;
  switch (a.type) {
    case "ack":
    case "next":
      return { type: a.type };
    case "pick": {
      const t = a.targets;
      const ok = Array.isArray(t) && t.length >= 1 && t.length <= 2 && t.every((x) => typeof x === "string" && x.length <= 100);
      return ok ? { type: "pick", targets: [...(t as string[])] } : null;
    }
    case "vote":
      return typeof a.choice === "string" && a.choice.length <= 100 ? { type: "vote", choice: a.choice } : null;
    default:
      return null;
  }
}

/** Test decks: role ids in seat order. */
function parseCards(input: unknown[], n: number): RoleId[] {
  if (input.length !== n || !input.every(isRoleId) || !input.includes("wolf")) {
    throw new Error(`short-night: a test deck is ${n} role ids in seat order, with a wolf.`);
  }
  return input as RoleId[];
}

// ---------------------------------------------------------------------------
// Definition
// ---------------------------------------------------------------------------

export const shortNightGame: GameDefinition<
  ShortNightServerState,
  ShortNightAction,
  ShortNightPublicState,
  ShortNightPrivateState,
  ShortNightSettings,
  ShortNightEvent
> = {
  manifest: shortNightManifest,
  defaultSettings: DEFAULT_SETTINGS,
  parseSettings: parseShortNightSettings,
  setupProblem,
  parseAction,

  createGame(players, settings, _match, ctx, options) {
    const n = players.length;
    if (n < MIN_PLAYERS || n > MAX_PLAYERS) throw new Error(`short-night: needs ${MIN_PLAYERS}–${MAX_PLAYERS} players, got ${n}`);
    const ids = players.map((p) => p.id);
    let cards: RoleId[];
    if (options?.deck) {
      cards = parseCards(options.deck, n);
    } else {
      const problem = setupProblem(settings, n);
      if (problem) throw new Error(`short-night: ${problem}`);
      const deck = deckOf(settings, n);
      cards = shuffle(
        (Object.entries(deck) as [RoleId, number][]).flatMap(([id, k]) => Array<RoleId>(k).fill(id)),
        ctx.randomInt,
      );
    }
    // In role order, never deal order: key order goes out in the public state too.
    const deck: Record<string, number> = {};
    for (const r of ROLES) {
      const k = cards.filter((c) => c === r.id).length;
      if (k) deck[r.id] = k;
    }

    const state: State = {
      phase: "reveal",
      settings,
      seed: ctx.randomInt(2 ** 31),
      deadline: 0,
      phaseMs: 0,
      players: ids.map((id) => ({ id, left: false, away: false })),
      cards: Object.fromEntries(ids.map((id, i) => [id, cards[i]!])),
      deck,
      steps: nightSteps(deck),
      step: 0,
      results: {},
      targets: {},
      acks: [],
      ballot: null,
      runoff: null,
      tied: [],
      out: null,
      winner: null,
      endReason: null,
    };
    drawPassive(state, ctx);
    const out = newOut();
    setPhase(state, "reveal", REVEAL_MS, ctx, out);
    return done(state, out);
  },

  handleAction(prev, playerId, action, ctx) {
    if (prev.phase === "finished") return reject("game-finished", "The game is over.");
    const me = find(prev, playerId);
    if (!me || me.left) return reject("not-in-game", "You're not in this game.");
    if (ctx.now >= prev.deadline) return reject("time-up", "Time's up.");

    const state = clone(prev);
    const out = newOut();

    switch (action.type) {
      case "ack": {
        if (prev.phase !== "reveal") return reject("wrong-phase", "Not now.");
        if (!state.acks.includes(playerId)) state.acks.push(playerId);
        break;
      }
      case "pick": {
        const role = stepRole(prev);
        if (!role || prev.cards[playerId] !== role || !roleById(role).picks) return reject("wrong-phase", "Not your step.");
        if (prev.results[playerId]) return reject("already", "You've already picked.");
        const targets = action.targets;
        const want = roleById(role).picks!;
        if (targets.length !== want) return reject("bad-pick", want === 1 ? "Pick one player." : "Pick two players.");
        if (new Set(targets).size !== targets.length) return reject("bad-pick", "Pick two different players.");
        if (targets.some((t) => t === playerId || !find(prev, t))) return reject("bad-pick", "Pick other players.");
        state.targets[playerId] = [...targets];
        state.results[playerId] = resolvePick(state, role, targets, ctx);
        // The step runs on regardless: ending it early would say someone's acting.
        break;
      }
      case "vote": {
        if (!voting(prev)) return reject("wrong-phase", "Not voting now.");
        if (action.choice === playerId) return reject("self-vote", "Not yourself.");
        const error = castVote(ballotOf(state)!, playerId, action.choice, choicesFor(state, playerId));
        if (error) return { ok: false, error };
        break;
      }
      case "next": {
        if (ctx.hostId !== playerId) return reject("host-only", "Only the host can do that.");
        if (prev.phase !== "day") return reject("wrong-phase", "Not now.");
        openVote(state, ctx, out);
        break;
      }
    }
    check(state, ctx, out);
    return { ok: true, transition: done(state, out) };
  },

  onTimer(prev, timerId, ctx) {
    if (prev.phase === "finished" || timerId !== PHASE) return { state: prev, events: [] };
    // A duplicate or early alarm is harmless: only a due deadline moves things on.
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
    if (prev.phase === "finished" || !p || p.left) return { state: prev, events: [] };
    const state = clone(prev);
    const out = newOut();
    find(state, playerId)!.away = true;
    // They might have been the last one a ballot was waiting on.
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
    if (prev.phase === "finished" || !p || p.left) return { state: prev, events: [] };
    const state = clone(prev);
    const out = newOut();
    find(state, playerId)!.left = true;
    const broken = brokenBy(state);
    if (broken) {
      finish(state, broken, out);
      return done(state, out);
    }
    const b = ballotOf(state);
    if (b) {
      dropVoter(b, playerId);
      // Votes for them go back to their voters.
      for (const [voter, choice] of Object.entries(b.votes)) if (choice === playerId) delete b.votes[voter];
      if (state.phase === "runoff") {
        state.tied = state.tied.filter((id) => id !== playerId);
        if (state.tied.length === 1) {
          settle(state, state.tied[0]!, out);
          return done(state, out);
        }
      }
    }
    // Their night step, if it's still to come, runs its full length anyway.
    check(state, ctx, out);
    return done(state, out);
  },

  skipTurn(prev, playerId, ctx) {
    // Only the reveal waits on named players (rule 9).
    if (prev.phase !== "reveal" || prev.acks.includes(playerId) || !find(prev, playerId)) return { state: prev, events: [] };
    const state = clone(prev);
    const out = newOut();
    state.acks.push(playerId);
    check(state, ctx, out);
    return done(state, out);
  },

  getPublicState(state) {
    const over = state.phase === "finished";
    const b = ballotOf(state);
    const night: NightLogEntry[] | null = over
      ? state.steps.map((role) => {
          const who = holders(state, role);
          const first = who[0];
          return { role, holders: who, targets: (first && state.targets[first]) || [], result: (first && state.results[first]) || null };
        })
      : null;
    return {
      phase: state.phase,
      deadline: state.deadline,
      phaseMs: state.phaseMs,
      steps: state.steps,
      step: state.step,
      deck: state.deck,
      players: state.players.map((p) => ({ id: p.id, left: p.left })),
      acked: state.acks.length,
      voted: b ? Object.keys(b.votes).length : 0,
      voters: b ? b.eligible.length : 0,
      tied: state.phase === "runoff" || over ? state.tied : [],
      cards: over ? { ...state.cards } : null,
      night,
      votes: over && state.ballot ? { ...state.ballot.votes } : null,
      runoffVotes: over && state.runoff ? { ...state.runoff.votes } : null,
      out: over ? state.out : null,
      winner: over ? state.winner : null,
      endReason: state.endReason,
    };
  },

  getPrivateState(state, playerId) {
    const p = find(state, playerId);
    if (!p) return { role: null, result: null, picking: null, acked: false, vote: null, choices: [] };
    const role = state.cards[playerId]!;
    const live = state.phase !== "finished" && !p.left;
    const mine = stepRole(state) === role && !state.results[playerId];
    const picks = roleById(role).picks;
    const b = ballotOf(state);
    return {
      role,
      result: stepReached(state, role) ? (state.results[playerId] ?? null) : null,
      picking: live && mine && picks ? { count: picks as 1 | 2, choices: allIds(state).filter((id) => id !== playerId) } : null,
      acked: state.acks.includes(playerId),
      vote: b?.votes[playerId] ?? null,
      choices: live && b?.eligible.includes(playerId) ? choicesFor(state, playerId) : [],
    };
  },

  getAwaitedPlayerIds(state) {
    // Public, so only the reveal names anyone: at night it would name the actor,
    // and in a ballot it would say who's voted (rule 9).
    return state.phase === "reveal" ? activeIds(state).filter((id) => !state.acks.includes(id)) : [];
  },

  getResult(state) {
    if (state.phase !== "finished") return null;
    const winners = state.winner ? activeIds(state).filter((id) => roleById(state.cards[id]!).team === state.winner) : [];
    const headline =
      state.endReason === "last-wolf-left"
        ? "Interrupted: the last Wolf left"
        : state.endReason === "too-few"
          ? "Interrupted: too few players left"
          : state.winner === "village"
            ? "Village wins"
            : "Wolves win";
    return {
      winnerIds: winners,
      headline,
      standings: [...state.players]
        .sort((a, b) => Number(winners.includes(b.id)) - Number(winners.includes(a.id)) || Number(a.left) - Number(b.left))
        .map((p) => {
          const label = roleById(state.cards[p.id]!).label;
          const fate = p.left ? "left" : !state.winner ? "no result" : winners.includes(p.id) ? "won" : "lost";
          return { playerId: p.id, value: winners.includes(p.id) ? 1 : 0, label: `${label}, ${fate}` };
        }),
    };
  },
};
