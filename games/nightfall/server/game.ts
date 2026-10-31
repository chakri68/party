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
import { nightfallManifest } from "../shared/manifest.ts";
import { deckOf, isRoleId, MAX_PLAYERS, MIN_PLAYERS, type RoleId, ROLES, roleById, setupProblem, type Team, teamOf } from "../shared/roles.ts";
import { parseNightfallSettings } from "../shared/rules-text.ts";
import {
  type DayRecord,
  DEFAULT_SETTINGS,
  type EndReason,
  type NightfallAction,
  type NightfallEvent,
  type NightfallPlayer,
  type NightfallPrivateState,
  type NightfallPublicState,
  type NightfallServerState,
  type NightfallSettings,
  REVEAL_MS,
  RUNOFF_MS,
  SKIP,
  VOTE_MS,
} from "../shared/types.ts";

type State = NightfallServerState;
type Events = GameEventEnvelope<NightfallEvent>[];

const pub = (event: NightfallEvent): GameEventEnvelope<NightfallEvent> => ({ visibility: { kind: "public" }, event });

const reject = (code: string, message: string): GameResult<State, NightfallEvent> => ({
  ok: false,
  error: { code, message },
});

/** One timer: the phase's deadline. Setting it again replaces it. */
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

const find = (state: State, id: string): NightfallPlayer | undefined => state.players.find((p) => p.id === id);
/** Alive and still here: may act, may be picked or voted for. */
const canAct = (p: NightfallPlayer | undefined): boolean => !!p && !p.dead && !p.left;
const actingIds = (state: State) => state.players.filter(canAct).map((p) => p.id);
const holderOf = (state: State, role: RoleId) => state.players.find((p) => state.cards[p.id] === role)?.id ?? null;
const isWolf = (state: State, id: string) => state.cards[id] === "wolf";
const voting = (state: State) => state.phase === "vote" || state.phase === "runoff";
const ballotOf = (state: State): Ballot | null => (state.phase === "runoff" ? state.runoff : state.phase === "vote" ? state.ballot : null);

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
  state.pack = null;
  state.picks = {};
  if (reason !== "done") state.winner = null;
  out.timers.push({ kind: "cancel", timerId: PHASE });
  out.events.push(pub({ type: "game-over", winner: state.winner, reason }));
}

/** Who's won, if anyone: no Wolves alive, or Wolves at parity. `abandoned` counts leavers as still alive. */
function winnerOf(state: State, abandoned: boolean): Team | null {
  const living = state.players.filter((p) => !p.dead && (abandoned || !p.abandoned)).map((p) => p.id);
  const wolves = living.filter((id) => isWolf(state, id)).length;
  if (wolves === 0) return "village";
  if (wolves >= living.length - wolves) return "wolves";
  return null;
}

/**
 * The win check, run twice (ruling 11): counting the abandoned as still alive,
 * and without them. Decided the first way is a real win. Decided only the
 * second way means leavers settled it, so nobody wins. True if it's over.
 */
function decided(state: State, out: Out): boolean {
  const real = winnerOf(state, true);
  if (real) {
    state.winner = real;
    finish(state, "done", out);
    return true;
  }
  if (!winnerOf(state, false)) return false;
  finish(state, "abandoned", out);
  return true;
}

/**
 * Every phase boundary starts here (ruling 12): living leavers become abandoned,
 * then the win check. No one has died since the last one, so only leavers can
 * decide it here, and that ends it with no winner. True if it's over.
 */
function boundary(state: State, out: Out): boolean {
  for (const p of state.players) if (p.left && !p.dead) p.abandoned = true;
  return decided(state, out);
}

// ---- the night -------------------------------------------------------------

function startNight(state: State, ctx: GameContext, out: Out): void {
  if (boundary(state, out)) return;
  state.round++;
  state.pack = openBallot(actingIds(state).filter((id) => isWolf(state, id)));
  state.picks = {};
  setPhase(state, "night", state.settings.nightSeconds * 1000, ctx, out);
  out.events.push(pub({ type: "night", round: state.round }));
}

/** Who a card may pick tonight. Null: its picks don't count. */
function targetsFor(state: State, id: string): string[] | null {
  const role = state.cards[id];
  if (!role || !roleById(role).acts) return null;
  const alive = actingIds(state);
  switch (role) {
    case "wolf":
      return alive.filter((t) => !isWolf(state, t));
    case "watcher":
      return alive.filter((t) => t !== id);
    case "keeper":
      return alive.filter((t) => t !== state.lastShelter);
    default:
      return null;
  }
}

/** Shelter, then attack, then reading (spec §5.2). */
function endNight(state: State, ctx: GameContext, out: Out): void {
  if (boundary(state, out)) return;
  const pack = state.pack!;
  const { winner: target } = tally(pack, state.players.map((p) => p.id), `${state.seed}:night${state.round}`);
  const keeper = holderOf(state, "keeper");
  const watcher = holderOf(state, "watcher");
  // SKIP: a pick the card couldn't make. No shelter, no reading.
  const real = (id: string | null) => (id && state.picks[id] !== SKIP && state.picks[id]) || null;
  const sheltered = real(keeper);
  const read = real(watcher);
  const died = target && target !== sheltered ? target : null;
  if (died) find(state, died)!.dead = true;
  state.lastShelter = sheltered;
  const readWolf = read ? isWolf(state, read) : null;
  if (read) state.readings.push({ night: state.round, target: read, wolf: readWolf! });
  state.nights.push({ night: state.round, wolfVotes: { ...pack.votes }, target, sheltered, read, readWolf, died });
  state.pack = null;
  state.picks = {};
  const team = died ? teamOf(state.cards[died]!) : null;
  out.events.push(pub({ type: "dawn", died, team }));
  if (decided(state, out)) return;
  setPhase(state, "day", state.settings.discussMinutes * 60_000, ctx, out);
}

// ---- the vote --------------------------------------------------------------

function openVote(state: State, ctx: GameContext, out: Out): void {
  if (boundary(state, out)) return;
  state.ballot = openBallot(actingIds(state));
  state.runoff = null;
  state.tied = [];
  setPhase(state, "vote", VOTE_MS, ctx, out);
  out.events.push(pub({ type: "vote-open", runoff: false }));
}

/** Who a voter may pick right now. */
function choicesFor(state: State, voterId: string): string[] {
  if (state.phase === "vote") return [...actingIds(state).filter((id) => id !== voterId), SKIP];
  if (state.phase === "runoff") return [...state.tied.filter((id) => id !== voterId), SKIP];
  return [];
}

/** The day's over: someone out or nobody, then a win check or the next night. */
function verdict(state: State, outId: string | null, ctx: GameContext, out: Out): void {
  if (outId) find(state, outId)!.dead = true;
  const team = outId ? teamOf(state.cards[outId]!) : null;
  const record: DayRecord = {
    day: state.round,
    votes: { ...state.ballot!.votes },
    tied: [...state.tied],
    runoffVotes: state.runoff ? { ...state.runoff.votes } : null,
    out: outId,
    team,
  };
  state.days.push(record);
  state.ballot = null;
  state.runoff = null;
  state.tied = [];
  out.events.push(pub({ type: "verdict", out: outId, team }));
  if (decided(state, out)) return;
  startNight(state, ctx, out);
}

/** Leaders among `named` in this ballot; empty if nobody got a vote. */
function leaders(b: Ballot, named: string[], key: string): string[] {
  const { counts } = tally(b, named, key);
  const top = Math.max(0, ...named.map((id) => counts[id]!));
  return top === 0 ? [] : named.filter((id) => counts[id] === top);
}

function closeVote(state: State, ctx: GameContext, out: Out): void {
  if (boundary(state, out)) return;
  if (state.phase === "vote") {
    // Votes for a leaver were handed back when they left, so they can't lead.
    const top = leaders(state.ballot!, actingIds(state), `${state.seed}:day${state.round}`);
    if (top.length === 1) return verdict(state, top[0]!, ctx, out);
    if (top.length === 0) return verdict(state, null, ctx, out);
    state.tied = top;
    state.runoff = openBallot(actingIds(state));
    setPhase(state, "runoff", RUNOFF_MS, ctx, out);
    out.events.push(pub({ type: "vote-open", runoff: true }));
    return;
  }
  const top = leaders(state.runoff!, state.tied, `${state.seed}:runoff${state.round}`);
  // Still tied, nobody voted, or the rest of the runoff walked out: nobody goes.
  verdict(state, top.length === 1 && state.tied.length > 1 ? top[0]! : null, ctx, out);
}

// ---- moving on -------------------------------------------------------------

function expire(state: State, ctx: GameContext, out: Out): void {
  switch (state.phase) {
    case "reveal":
      return startNight(state, ctx, out);
    case "night":
      return endNight(state, ctx, out);
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
    if (allHere(state, actingIds(state), (id) => state.acks.includes(id))) startNight(state, ctx, out);
    return;
  }
  const b = ballotOf(state);
  if (b && allHere(state, b.eligible, (id) => id in b.votes)) closeVote(state, ctx, out);
}

/** Drops whatever a leaver had in, or had coming to them, in this phase. */
function forget(state: State, id: string): void {
  delete state.picks[id];
  // Picks aimed at them go too, so every picker can pick again.
  for (const [picker, target] of Object.entries(state.picks)) if (target === id) delete state.picks[picker];
  for (const b of [state.pack, ballotOf(state)]) {
    if (!b) continue;
    dropVoter(b, id);
    for (const [voter, choice] of Object.entries(b.votes)) if (choice === id) delete b.votes[voter];
  }
  state.tied = state.tied.filter((t) => t !== id);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const isId = (x: unknown): x is string => typeof x === "string" && x.length > 0 && x.length <= 100;

function parseAction(input: unknown): NightfallAction | null {
  if (typeof input !== "object" || input === null) return null;
  const a = input as Record<string, unknown>;
  switch (a.type) {
    case "ack":
    case "next":
      return { type: a.type };
    case "pick":
      return isId(a.target) ? { type: "pick", target: a.target } : null;
    case "vote":
      return isId(a.choice) ? { type: "vote", choice: a.choice } : null;
    default:
      return null;
  }
}

/** Test decks: role ids in seat order. */
function parseCards(input: unknown[], n: number): RoleId[] {
  if (input.length !== n || !input.every(isRoleId) || !input.includes("wolf") || input.every((c) => c === "wolf")) {
    throw new Error(`nightfall: a test deck is ${n} role ids in seat order, with a wolf and a non-wolf.`);
  }
  return input as RoleId[];
}

// ---------------------------------------------------------------------------
// Definition
// ---------------------------------------------------------------------------

export const nightfallGame: GameDefinition<
  NightfallServerState,
  NightfallAction,
  NightfallPublicState,
  NightfallPrivateState,
  NightfallSettings,
  NightfallEvent
> = {
  manifest: nightfallManifest,
  defaultSettings: DEFAULT_SETTINGS,
  parseSettings: parseNightfallSettings,
  setupProblem,
  parseAction,

  createGame(players, settings, _match, ctx, options) {
    const n = players.length;
    if (n < MIN_PLAYERS || n > MAX_PLAYERS) throw new Error(`nightfall: needs ${MIN_PLAYERS}–${MAX_PLAYERS} players, got ${n}`);
    const ids = players.map((p) => p.id);
    let cards: RoleId[];
    if (options?.deck) {
      cards = parseCards(options.deck, n);
    } else {
      const problem = setupProblem(settings, n);
      if (problem) throw new Error(`nightfall: ${problem}`);
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
      round: 0,
      players: ids.map((id) => ({ id, dead: false, left: false, abandoned: false, away: false })),
      cards: Object.fromEntries(ids.map((id, i) => [id, cards[i]!])),
      deck,
      pack: null,
      picks: {},
      lastShelter: null,
      readings: [],
      acks: [],
      ballot: null,
      runoff: null,
      tied: [],
      nights: [],
      days: [],
      winner: null,
      endReason: null,
    };
    const out = newOut();
    setPhase(state, "reveal", REVEAL_MS, ctx, out);
    return done(state, out);
  },

  handleAction(prev, playerId, action, ctx) {
    if (prev.phase === "finished") return reject("game-finished", "The game is over.");
    const me = find(prev, playerId);
    if (!me || me.left) return reject("not-in-game", "You're not in this game.");
    // The host's "Vote now" is a clock move, not a play: the dead host keeps it (ruling 17).
    if (action.type !== "next" && me.dead) return reject("dead", "You're out of the game.");
    if (ctx.now >= prev.deadline) return reject("time-up", "Time's up.");

    const state = clone(prev);
    const out = newOut();

    switch (action.type) {
      case "ack": {
        if (prev.phase !== "reveal") return reject("wrong-phase", "You can't do that now.");
        if (!state.acks.includes(playerId)) state.acks.push(playerId);
        break;
      }
      case "pick": {
        if (prev.phase !== "night") return reject("wrong-phase", "You can't do that now.");
        const allowed = targetsFor(prev, playerId);
        if (!allowed) return reject("no-pick", "Your card has no power at night.");
        const had = isWolf(prev, playerId) ? prev.pack!.votes[playerId] : prev.picks[playerId];
        if (had) return reject("already", "You have already chosen.");
        if (!actingIds(prev).includes(action.target)) return reject("bad-pick", "You can't choose that player.");
        // A pick the card can't make is taken, silently, as no pick: a refusal
        // only an acting card could ever see would mark it (ruling 4).
        const target = allowed.includes(action.target) ? action.target : SKIP;
        if (isWolf(prev, playerId)) state.pack!.votes[playerId] = target;
        else state.picks[playerId] = target;
        // The night runs on regardless: ending it early would say who's acting.
        break;
      }
      case "vote": {
        if (!voting(prev)) return reject("wrong-phase", "There's no vote right now.");
        if (action.choice === playerId) return reject("self-vote", "You can't vote for yourself.");
        const error = castVote(ballotOf(state)!, playerId, action.choice, choicesFor(state, playerId));
        if (error) return { ok: false, error };
        break;
      }
      case "next": {
        if (ctx.hostId !== playerId) return reject("host-only", "Only the host can do that.");
        if (prev.phase !== "day") return reject("wrong-phase", "You can't do that now.");
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
    // They might have been the last one the reveal or a ballot was waiting on.
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
    // Abandoned at the next boundary, not now (ruling 11). Until then they're
    // nobody's pick and nobody's vote.
    if (!p.dead) forget(state, playerId);
    // A runoff down to one candidate can't finish fairly: close it now, nobody goes.
    if (state.phase === "runoff" && state.tied.length < 2) {
      closeVote(state, ctx, out);
      return done(state, out);
    }
    check(state, ctx, out);
    return done(state, out);
  },

  skipTurn(prev, playerId, ctx) {
    // Only the reveal waits on named players.
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
    return {
      phase: state.phase,
      deadline: state.deadline,
      phaseMs: state.phaseMs,
      round: state.round,
      deck: state.deck,
      players: state.players.map((p) => ({
        id: p.id,
        dead: p.dead,
        left: p.left,
        abandoned: p.abandoned,
        team: p.dead ? teamOf(state.cards[p.id]!) : null,
      })),
      // Leavers' acks don't count: "still looking" is of the living who're still in (as Heist).
      acked: state.players.filter((p) => !p.left && !p.dead && state.acks.includes(p.id)).length,
      voted: b ? Object.keys(b.votes).length : 0,
      voters: b ? b.eligible.length : 0,
      tied: state.phase === "runoff" ? [...state.tied] : [],
      dawns: state.nights.map((n) => ({ night: n.night, died: n.died, team: n.died ? teamOf(state.cards[n.died]!) : null })),
      days: state.days,
      cards: over ? { ...state.cards } : null,
      nights: over ? state.nights : null,
      winner: over ? state.winner : null,
      endReason: state.endReason,
    };
  },

  getPrivateState(state, playerId) {
    const p = find(state, playerId);
    if (!p) {
      return { role: null, pack: null, packPicks: null, pick: null, picking: false, lastShelter: null, readings: null, acked: false, vote: null, choices: [] };
    }
    const role = state.cards[playerId]!;
    const wolf = role === "wolf";
    const night = state.phase === "night" && canAct(p);
    const b = ballotOf(state);
    return {
      role,
      pack: wolf ? state.players.map((x) => x.id).filter((id) => isWolf(state, id)) : null,
      packPicks: wolf && night ? { ...state.pack!.votes } : null,
      pick: night ? ((wolf ? state.pack!.votes[playerId] : state.picks[playerId]) ?? null) : null,
      picking: night,
      lastShelter: role === "keeper" ? state.lastShelter : null,
      readings: role === "watcher" ? state.readings : null,
      acked: state.acks.includes(playerId),
      vote: b?.votes[playerId] ?? null,
      choices: canAct(p) && b?.eligible.includes(playerId) ? choicesFor(state, playerId) : [],
    };
  },

  getAwaitedPlayerIds(state) {
    // Public, so only the reveal names anyone: at night it would name the actors,
    // and in a ballot it would say who's voted (ruling 10).
    return state.phase === "reveal" ? actingIds(state).filter((id) => !state.acks.includes(id)) : [];
  },

  getResult(state) {
    if (state.phase !== "finished") return null;
    const winners = state.winner ? state.players.filter((p) => !p.left && teamOf(state.cards[p.id]!) === state.winner).map((p) => p.id) : [];
    const headline =
      state.endReason === "abandoned" ? "Stopped: a team left the game" : state.winner === "village" ? "Village wins" : "Wolves win";
    return {
      winnerIds: winners,
      headline,
      standings: [...state.players]
        .sort((a, b) => Number(winners.includes(b.id)) - Number(winners.includes(a.id)) || Number(a.left) - Number(b.left))
        .map((p) => {
          const label = roleById(state.cards[p.id]!).label;
          const fate = p.left ? "left" : !state.winner ? "no result" : winners.includes(p.id) ? "won" : "lost";
          return { playerId: p.id, value: winners.includes(p.id) ? 1 : 0, label: `${label}${p.dead ? ", out" : ""}, ${fate}` };
        }),
    };
  },
};
