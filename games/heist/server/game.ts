import {
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
import { heistManifest } from "../shared/manifest.ts";
import { BUDGET, crewSizes, MAX_HEAT, MAX_PLAYERS, MIN_PLAYERS, molesFor, setupProblem, TO_WIN } from "../shared/rules.ts";
import { parseHeistSettings } from "../shared/rules-text.ts";
import {
  type Alignment,
  DEFAULT_SETTINGS,
  type EndReason,
  type HeistAction,
  type HeistEvent,
  type HeistPlayer,
  type HeistPrivateState,
  type HeistPublicState,
  type HeistServerState,
  type HeistSettings,
  type ProposalRecord,
  REVEAL_MS,
  TIMERS,
  type Vote,
} from "../shared/types.ts";

type State = HeistServerState;
type Events = GameEventEnvelope<HeistEvent>[];

const pub = (event: HeistEvent): GameEventEnvelope<HeistEvent> => ({ visibility: { kind: "public" }, event });

const reject = (code: string, message: string): GameResult<State, HeistEvent> => ({
  ok: false,
  error: { code, message },
});

/** One timer: the phase's deadline. Setting it again replaces it. */
const PHASE = "phase";
/** An alarm this early is a stray, not the deadline. */
const SLACK_MS = 500;
const VOTES: readonly Vote[] = ["go", "no-go"];

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

const find = (state: State, id: string): HeistPlayer | undefined => state.players.find((p) => p.id === id);
const activeIds = (state: State) => state.players.filter((p) => !p.left).map((p) => p.id);
const leaderOf = (state: State) => state.players[state.leader]!.id;
const timers = (state: State) => TIMERS[state.settings.preset];
/** Sizes for whoever's still in. Below five the game's already over. */
const sizesOf = (state: State) => crewSizes(Math.max(MIN_PLAYERS, activeIds(state).length));

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
  state.crew = [];
  state.ballot = null;
  state.cards = {};
  if (reason !== "done") state.winner = null;
  out.timers.push({ kind: "cancel", timerId: PHASE });
  out.events.push(pub({ type: "game-over", winner: state.winner, reason }));
}

/** The next seat after `from` that's still in. */
function nextSeat(state: State, from: number): number {
  for (let i = 1; i <= state.players.length; i++) {
    const j = (from + i) % state.players.length;
    if (!state.players[j]!.left) return j;
  }
  return from;
}

// ---- the round -------------------------------------------------------------

function startPropose(state: State, ctx: GameContext, out: Out): void {
  state.crew = [];
  state.ballot = null;
  state.cards = {};
  setPhase(state, "propose", timers(state).leaderMs, ctx, out);
  out.events.push(pub({ type: "propose", leader: leaderOf(state), job: state.job }));
}

/** A side's job: score it, cool off, and either the next job or the end. */
function endJob(state: State, winner: Alignment, crew: string[], sabotaged: number, auto: number, heat: boolean, ctx: GameContext, out: Out): void {
  state.jobs.push({ job: state.job, crew, sabotaged, auto, winner, heat });
  state.score[winner]++;
  state.heat = 0;
  out.events.push(pub({ type: "job-done", job: state.job, winner, sabotaged, heat }));
  if (state.score[winner] >= TO_WIN) {
    state.winner = winner;
    return finish(state, "done", out);
  }
  state.job++;
  startPropose(state, ctx, out);
}

/** A proposal that didn't go: heat, the lead moves on, maybe the job's lost. */
function failProposal(state: State, record: ProposalRecord, ctx: GameContext, out: Out): void {
  state.proposals.push(record);
  state.heat++;
  state.leader = nextSeat(state, state.leader);
  out.events.push(pub({ type: "vote-closed", passed: false, heat: state.heat }));
  if (state.heat >= MAX_HEAT) return endJob(state, "mole", [], 0, 0, true, ctx, out);
  startPropose(state, ctx, out);
}

function leaderTimedOut(state: State, ctx: GameContext, out: Out): void {
  failProposal(state, { job: state.job, leader: leaderOf(state), crew: [], votes: {}, missed: [], passed: false, timedOut: true, voided: false }, ctx, out);
}

function closeVote(state: State, ctx: GameContext, out: Out): void {
  const b = state.ballot!;
  const votes: Record<string, Vote> = {};
  const missed: string[] = [];
  for (const id of b.eligible) {
    votes[id] = b.votes[id] ?? "no-go";
    if (!(id in b.votes)) missed.push(id);
  }
  // More than half of everyone in the game; a tie fails.
  const go = Object.values(votes).filter((v) => v === "go").length;
  const passed = go * 2 > b.eligible.length;
  const record: ProposalRecord = { job: state.job, leader: leaderOf(state), crew: [...state.crew], votes, missed, passed, timedOut: false, voided: false };
  state.ballot = null;
  if (!passed) return failProposal(state, record, ctx, out);
  state.proposals.push(record);
  state.leader = nextSeat(state, state.leader);
  state.cards = {};
  out.events.push(pub({ type: "vote-closed", passed: true, heat: state.heat }));
  setPhase(state, "job", timers(state).cardMs, ctx, out);
}

/** The card clock ran out: missing cards are Clean, Sabotage cards are spent. */
function playCards(state: State, ctx: GameContext, out: Out): void {
  let sabotaged = 0;
  let auto = 0;
  for (const id of state.crew) {
    const card = state.cards[id];
    if (!card) auto++;
    if (card === "sabotage") {
      sabotaged++;
      state.budget[id]!--;
    }
  }
  const crew = [...state.crew];
  state.cards = {};
  endJob(state, sabotaged > 0 ? "mole" : "crew", crew, sabotaged, auto, false, ctx, out);
}

/** Someone on the crew left before the job was played: as if it was never proposed. */
function voidProposal(state: State, ctx: GameContext, out: Out): void {
  if (state.phase === "job") state.proposals.at(-1)!.voided = true;
  // Cards put in are dropped unplayed; budgets only ever drop when a job's played.
  state.leader = state.players[state.proposer]!.left ? nextSeat(state, state.proposer) : state.proposer;
  out.events.push(pub({ type: "voided" }));
  startPropose(state, ctx, out);
}

// ---- moving on -------------------------------------------------------------

function expire(state: State, ctx: GameContext, out: Out): void {
  switch (state.phase) {
    case "reveal":
      return startPropose(state, ctx, out);
    case "propose":
      return leaderTimedOut(state, ctx, out);
    case "vote":
      return closeVote(state, ctx, out);
    case "job":
      return playCards(state, ctx, out);
    case "finished":
      return;
  }
}

/** Moves on early where the phase allows: the reveal and the vote. Never the job (ruling 3). */
function check(state: State, ctx: GameContext, out: Out): void {
  if (state.phase === "reveal") {
    if (allHere(state, activeIds(state), (id) => state.acks.includes(id))) startPropose(state, ctx, out);
    return;
  }
  const b = state.ballot;
  if (state.phase === "vote" && b && allHere(state, b.eligible, (id) => id in b.votes)) closeVote(state, ctx, out);
}

/** The game can't go on fairly. Checked whenever someone leaves. */
function brokenBy(state: State): EndReason | null {
  const ids = activeIds(state);
  if (ids.length < MIN_PLAYERS) return "too-few";
  if (!ids.some((id) => state.alignment[id] === "mole")) return "no-moles";
  if (!ids.some((id) => state.alignment[id] === "crew")) return "no-crew";
  return null;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const isId = (x: unknown): x is string => typeof x === "string" && x.length > 0 && x.length <= 100;

function parseAction(input: unknown): HeistAction | null {
  if (typeof input !== "object" || input === null) return null;
  const a = input as Record<string, unknown>;
  switch (a.type) {
    case "ack":
      return { type: "ack" };
    case "propose": {
      const c = a.crew;
      return Array.isArray(c) && c.length >= 1 && c.length <= MAX_PLAYERS && c.every(isId) ? { type: "propose", crew: [...c] } : null;
    }
    case "vote":
      return a.vote === "go" || a.vote === "no-go" ? { type: "vote", vote: a.vote } : null;
    case "card":
      return a.card === "clean" || a.card === "sabotage" ? { type: "card", card: a.card } : null;
    default:
      return null;
  }
}

/** Test decks: alignments in seat order, at least one of each. */
function parseDeck(input: unknown[], n: number): Alignment[] {
  const ok = input.length === n && input.every((a) => a === "crew" || a === "mole") && input.includes("crew") && input.includes("mole");
  if (!ok) throw new Error(`heist: a test deck is ${n} alignments in seat order, both sides present.`);
  return input as Alignment[];
}

// ---------------------------------------------------------------------------
// Definition
// ---------------------------------------------------------------------------

export const heistGame: GameDefinition<HeistServerState, HeistAction, HeistPublicState, HeistPrivateState, HeistSettings, HeistEvent> = {
  manifest: heistManifest,
  defaultSettings: DEFAULT_SETTINGS,
  parseSettings: parseHeistSettings,
  setupProblem,
  parseAction,

  createGame(players, settings, _match, ctx, options) {
    const n = players.length;
    if (n < MIN_PLAYERS || n > MAX_PLAYERS) throw new Error(`heist: needs ${MIN_PLAYERS}–${MAX_PLAYERS} players, got ${n}`);
    const ids = players.map((p) => p.id);
    let deal: Alignment[];
    if (options?.deck) {
      deal = parseDeck(options.deck, n);
    } else {
      const problem = setupProblem(settings, n);
      if (problem) throw new Error(`heist: ${problem}`);
      const moles = molesFor(settings, n);
      deal = shuffle([...Array<Alignment>(moles).fill("mole"), ...Array<Alignment>(n - moles).fill("crew")], ctx.randomInt);
    }
    const alignment = Object.fromEntries(ids.map((id, i) => [id, deal[i]!]));
    const leader = ctx.randomInt(n);

    const state: State = {
      phase: "reveal",
      settings,
      deadline: 0,
      phaseMs: 0,
      players: ids.map((id) => ({ id, left: false, away: false })),
      alignment,
      // Seat order, never deal order.
      budget: Object.fromEntries(ids.filter((id) => alignment[id] === "mole").map((id) => [id, BUDGET])),
      leader,
      proposer: leader,
      job: 0,
      heat: 0,
      score: { crew: 0, mole: 0 },
      crew: [],
      ballot: null,
      cards: {},
      proposals: [],
      jobs: [],
      acks: [],
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
    if (ctx.now >= prev.deadline) return reject("time-up", "Time's up.");

    const state = clone(prev);
    const out = newOut();

    switch (action.type) {
      case "ack": {
        if (prev.phase !== "reveal") return reject("wrong-phase", "Not now.");
        if (!state.acks.includes(playerId)) state.acks.push(playerId);
        break;
      }
      case "propose": {
        if (prev.phase !== "propose") return reject("wrong-phase", "Not now.");
        if (leaderOf(prev) !== playerId) return reject("not-leader", "You're not leading this one.");
        const want = sizesOf(prev)[prev.job]!;
        const crew = action.crew;
        if (crew.length !== want) return reject("bad-crew", `Pick exactly ${want}.`);
        if (new Set(crew).size !== crew.length) return reject("bad-crew", "Pick different players.");
        if (crew.some((id) => !find(prev, id) || find(prev, id)!.left)) return reject("bad-crew", "Pick players still in the game.");
        // Seat order, so the crew reads the same whichever order it was tapped in.
        state.crew = activeIds(state).filter((id) => crew.includes(id));
        state.proposer = state.leader;
        state.ballot = openBallot<Vote>(activeIds(state));
        setPhase(state, "vote", timers(state).voteMs, ctx, out);
        out.events.push(pub({ type: "proposed", crew: state.crew }));
        break;
      }
      case "vote": {
        if (prev.phase !== "vote") return reject("wrong-phase", "Not voting now.");
        const error = castVote(state.ballot!, playerId, action.vote, VOTES);
        if (error) return { ok: false, error };
        break;
      }
      case "card": {
        if (prev.phase !== "job") return reject("wrong-phase", "No job on.");
        if (!prev.crew.includes(playerId)) return reject("not-on-job", "You're not on this job.");
        if (action.card === "sabotage") {
          if (prev.alignment[playerId] !== "mole") return reject("crew-only-clean", "Crew can only play Clean.");
          if ((prev.budget[playerId] ?? 0) <= 0) return reject("no-sabotage-left", "You're out of Sabotage cards.");
        }
        state.cards[playerId] = action.card;
        // The job runs on regardless: ending it early would time the slowest card.
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
    // They might have been the last one the reveal or the vote was waiting on.
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
    const seat = state.players.findIndex((x) => x.id === playerId);
    state.players[seat]!.left = true;
    const broken = brokenBy(state);
    if (broken) {
      finish(state, broken, out);
      return done(state, out);
    }
    if ((state.phase === "vote" || state.phase === "job") && state.crew.includes(playerId)) {
      voidProposal(state, ctx, out);
      return done(state, out);
    }
    if (state.phase === "propose" && state.leader === seat) {
      // Nothing was proposed, so nothing failed: the next seat starts afresh.
      state.leader = nextSeat(state, seat);
      startPropose(state, ctx, out);
      return done(state, out);
    }
    // A leader not on their own crew can leave and the proposal stands; the
    // vote's close moves the lead on from their seat as usual. Any other time
    // the lead they were holding passes now.
    if (state.leader === seat && state.phase !== "vote") state.leader = nextSeat(state, seat);
    if (state.ballot) dropVoter(state.ballot, playerId);
    check(state, ctx, out);
    return done(state, out);
  },

  skipTurn(prev, playerId, ctx) {
    const state = clone(prev);
    const out = newOut();
    if (prev.phase === "reveal" && find(prev, playerId) && !prev.acks.includes(playerId)) {
      state.acks.push(playerId);
      check(state, ctx, out);
      return done(state, out);
    }
    if (prev.phase === "propose" && leaderOf(prev) === playerId) {
      leaderTimedOut(state, ctx, out);
      return done(state, out);
    }
    return { state: prev, events: [] };
  },

  getPublicState(state) {
    const over = state.phase === "finished";
    const b = state.ballot;
    return {
      phase: state.phase,
      deadline: state.deadline,
      phaseMs: state.phaseMs,
      players: state.players.map((p) => ({ id: p.id, left: p.left })),
      leader: leaderOf(state),
      job: state.job,
      sizes: sizesOf(state),
      heat: state.heat,
      score: { ...state.score },
      moleCount: Object.keys(state.budget).length,
      crew: [...state.crew],
      acked: state.acks.length,
      voted: b ? Object.keys(b.votes).length : 0,
      voters: b ? b.eligible.length : 0,
      proposals: state.proposals,
      jobs: state.jobs,
      alignments: over ? { ...state.alignment } : null,
      winner: over ? state.winner : null,
      endReason: state.endReason,
    };
  },

  getPrivateState(state, playerId) {
    const p = find(state, playerId);
    if (!p) return { alignment: null, moles: null, budget: null, acked: false, vote: null, canVote: false, onJob: false, card: null };
    const alignment = state.alignment[playerId]!;
    const mole = alignment === "mole";
    const live = state.phase !== "finished" && !p.left;
    const b = state.ballot;
    return {
      alignment,
      moles: mole ? state.players.map((x) => x.id).filter((id) => state.alignment[id] === "mole") : null,
      budget: mole ? state.budget[playerId]! : null,
      acked: state.acks.includes(playerId),
      vote: b?.votes[playerId] ?? null,
      canVote: live && state.phase === "vote" && !!b?.eligible.includes(playerId),
      onJob: live && state.phase === "job" && state.crew.includes(playerId),
      card: state.phase === "job" ? (state.cards[playerId] ?? null) : null,
    };
  },

  getAwaitedPlayerIds(state) {
    // Public. The reveal and the leader are fair to name; who's still voting or
    // holding a card is not (design ruling 7).
    if (state.phase === "reveal") return activeIds(state).filter((id) => !state.acks.includes(id));
    if (state.phase === "propose") return [leaderOf(state)];
    return [];
  },

  getResult(state) {
    if (state.phase !== "finished") return null;
    const winners = state.winner ? activeIds(state).filter((id) => state.alignment[id] === state.winner) : [];
    const headline =
      state.endReason === "too-few"
        ? "Interrupted: too few players left"
        : state.endReason === "no-moles"
          ? "Interrupted: no moles left"
          : state.endReason === "no-crew"
            ? "Interrupted: no crew left"
            : state.winner === "crew"
              ? "The crew wins"
              : "The moles win";
    return {
      winnerIds: winners,
      headline,
      standings: [...state.players]
        .sort((a, b) => Number(winners.includes(b.id)) - Number(winners.includes(a.id)) || Number(a.left) - Number(b.left))
        .map((p) => {
          const label = state.alignment[p.id] === "mole" ? "Mole" : "Crew";
          const fate = p.left ? "left" : !state.winner ? "no result" : winners.includes(p.id) ? "won" : "lost";
          return { playerId: p.id, value: winners.includes(p.id) ? 1 : 0, label: `${label}, ${fate}` };
        }),
    };
  },
};
