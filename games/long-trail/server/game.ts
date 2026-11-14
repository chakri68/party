import {
  bumpStat,
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
import { CACHE_FOOD, drawEvent, resolveChoice, resolveEvent, rollDangers } from "../shared/events.ts";
import { jobInfo } from "../shared/info.ts";
import { longTrailManifest } from "../shared/manifest.ts";
import { N } from "../shared/numbers.ts";
import { packFor, stopById, type Leg, type LegKind, type RouteDef, type SettingPack } from "../shared/pack.ts";
import { buildRecap } from "../shared/recap.ts";
import { dealGoals, gradeOf, outcome, wealth, type EndView } from "../shared/scoring.ts";
import { MAX_PLAYERS, MIN_PLAYERS, parseLongTrailSettings, setupProblem } from "../shared/settings.ts";
import { applyTrades, arrived, failed, planProblem, rollPrices, startLeg, travelDay } from "../shared/travel.ts";
import {
  type ArmableJob,
  type Band,
  DEFAULT_SETTINGS,
  type Goal,
  type Health,
  type JobId,
  type LongTrailAction,
  type LongTrailEvent,
  type LongTrailPrivateState,
  type LongTrailPublicState,
  type LongTrailServerState,
  type LongTrailSettings,
  type Pace,
  type Phase,
  type Plan,
  type Rations,
  type Stock,
  TIMERS,
  type Trade,
  type Vote,
} from "../shared/types.ts";

type State = LongTrailServerState;
type Events = GameEventEnvelope<LongTrailEvent>[];

const pub = (event: LongTrailEvent): GameEventEnvelope<LongTrailEvent> => ({ visibility: { kind: "public" }, event });
const reject = (code: string, message: string): GameResult<State, LongTrailEvent> => ({ ok: false, error: { code, message } });

/** One timer: the phase's deadline. Setting it again replaces it. */
const PHASE = "phase";
/** An alarm this early is a stray, not the deadline. */
const SLACK_MS = 500;
const VOTES: readonly Vote[] = ["go", "no-go"];
const JOBS: JobId[] = ["guide", "healer", "trader", "quartermaster", "scout", "driver", "cook", "lookout"];
const ARMABLE: readonly JobId[] = ["guide", "scout", "quartermaster", "lookout"];
const isArmable = (job: JobId | undefined): job is ArmableJob => !!job && ARMABLE.includes(job);

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

const world = (state: State): { pack: SettingPack; route: RouteDef } => {
  const pack = packFor(state.settings.setting);
  return { pack, route: pack.routes[state.settings.length] };
};
const find = (state: State, id: string) => state.players.find((p) => p.id === id);
const activeIds = (state: State) => state.players.filter((p) => !p.left).map((p) => p.id);
const leaderOf = (state: State) => state.players[state.leader]!.id;
const isAlive = (state: State, id: string) => state.travellers.includes(id) && (state.caravan.health[id] ?? 0) > 0;
/** The job's holder is still travelling and alive. Dead travellers lose their ability. */
const jobAlive = (state: State, job: JobId) => state.travellers.some((id) => state.jobs[id] === job && isAlive(state, id));
const aliveJobs = (state: State) => Object.fromEntries(JOBS.map((j) => [j, jobAlive(state, j)])) as Record<JobId, boolean>;

/** Everyone connected and still in has done it. Nobody connected: the clock decides. */
function allHere(state: State, ids: readonly string[], isDone: (id: string) => boolean): boolean {
  const here = ids.filter((id) => {
    const p = find(state, id);
    return p && !p.left && !p.away;
  });
  return here.length > 0 && here.every(isDone);
}

function setPhase(state: State, phase: Phase, ctx: GameContext, out: Out): void {
  const ms = phase === "over" ? 0 : TIMERS[phase];
  state.phase = phase;
  state.deadline = ctx.now + ms;
  state.phaseMs = ms;
  state.acks = [];
  out.timers.push({ kind: "set", timerId: PHASE, delayMs: ms });
}

/** The next seat after `from` that's still in. Dead travellers' players still lead. */
function nextSeat(state: State, from: number): number {
  for (let i = 1; i <= state.players.length; i++) {
    const j = (from + i) % state.players.length;
    if (!state.players[j]!.left) return j;
  }
  return from;
}

/** The way out of a halted stop: the picked branch at a fork, the one leg otherwise. */
function legOut(route: RouteDef, at: string, fork: string | null): Leg | undefined {
  const next = stopById(route, at).next;
  return next.length === 2 ? (next.find((l) => l.to === fork) ?? next.find((l) => l.safe) ?? next[0]) : next[0];
}

/** Yesterday's pace and rations (day 1: steady, full), the safe branch at a fork, nothing else. */
function openPlan(state: State): Plan {
  const { route } = world(state);
  const c = state.caravan;
  const fork = c.leg === null && stopById(route, c.at).next.length === 2 ? (legOut(route, c.at, null)?.to ?? null) : null;
  const pace: Pace = state.lastPlan?.pace ?? "steady";
  const rations: Rations = state.lastPlan?.rations ?? "full";
  return { pace, rations, rest: false, fork, doses: [], trades: [] };
}

/** The leg the caravan last travelled, for events on days it doesn't move. Day 1: the first leg. */
function eventLeg(state: State): { kind: LegKind; key: string } {
  const { route } = world(state);
  const c = state.caravan;
  if (c.leg) return { kind: c.leg.kind, key: `${c.at}>${c.leg.to}` };
  const prev = c.visited.length > 1 ? c.visited[c.visited.length - 2]! : null;
  if (prev) {
    const leg = stopById(route, prev).next.find((l) => l.to === c.at);
    if (leg) return { kind: leg.kind, key: `${prev}>${c.at}` };
  }
  const first = stopById(route, route.start).next[0]!;
  return { kind: first.kind, key: `${route.start}>${first.to}` };
}

/** Fewer than two players: the game stops here, with no recap and no winner. */
function endIfOver(state: State, out: Out): boolean {
  if (activeIds(state).length >= 2) return false;
  state.phase = "over";
  state.interrupted = true;
  state.deadline = 0;
  state.phaseMs = 0;
  state.ballot = null;
  state.choiceBallot = null;
  out.timers.push({ kind: "cancel", timerId: PHASE });
  out.events.push(pub({ type: "game-over", interrupted: true }));
  return true;
}

// ---- the day ---------------------------------------------------------------

function startPlan(state: State, ctx: GameContext, out: Out): void {
  state.plan = null;
  state.ballot = null;
  setPhase(state, "plan", ctx, out);
  out.events.push(pub({ type: "plan", leader: leaderOf(state), proposalNo: state.proposalNo }));
}

function propose(state: State, plan: Plan, ctx: GameContext, out: Out): void {
  state.plan = plan;
  state.ballot = openBallot<Vote>(activeIds(state));
  setPhase(state, "vote", ctx, out);
  out.events.push(pub({ type: "proposed", by: leaderOf(state), plan }));
}

/** A majority of votes cast passes; a tie (0-0 too) fails. */
function closeVote(state: State, ctx: GameContext, out: Out): void {
  const b = state.ballot!;
  const votes = { ...b.votes };
  const go = Object.values(votes).filter((v) => v === "go").length;
  const noGo = Object.values(votes).length - go;
  for (const [id, v] of Object.entries(votes)) if (v === "no-go") bumpStat((state.stats ??= {}), id, "noGoVotes");
  const passed = go > noGo;
  const plan = state.plan!;
  state.proposals.push({ by: leaderOf(state), plan, votes, passed });
  state.ballot = null;
  state.plan = null;
  out.events.push(pub({ type: "vote-closed", passed, votes }));
  if (passed) return resolveDay(state, plan, false, ctx, out);
  if (state.proposalNo === 1) {
    state.proposalNo = 2;
    state.leader = nextSeat(state, state.leader);
    return startPlan(state, ctx, out);
  }
  resolveDay(state, openPlan(state), true, ctx, out);
}

/**
 * Trades and doses, travel, perks, the Quartermaster cache, then the event.
 * A choice event waits in `draft` for the table's vote.
 */
function resolveDay(state: State, plan: Plan, stayedCourse: boolean, ctx: GameContext, out: Out): void {
  const { pack, route } = world(state);
  const c = state.caravan;
  const before = structuredClone(c.stock);
  const day = c.day;
  const leader = leaderOf(state);
  const changes: { playerId: string; from: Health; to: Health }[] = [];

  if (c.leg === null) applyTrades(c, route, plan.trades, state.jobs[leader] === "trader" && isAlive(state, leader));
  if (plan.rest || jobAlive(state, "healer")) {
    for (const id of plan.doses) {
      const from = c.health[id] ?? 0;
      if (!isAlive(state, id) || from >= 3 || c.stock.medicine <= 0) continue;
      c.health[id] = (from + 1) as Health;
      c.stock.medicine -= 1;
      changes.push({ playerId: id, from, to: c.health[id]! });
    }
  }
  if (!plan.rest && c.leg === null) {
    startLeg(c, route, legOut(route, c.at, plan.fork)!.to);
    state.perksUsedThisLeg = { driver: false, cook: false };
  }
  const report = travelDay(
    c,
    pack,
    route,
    plan,
    state.travellers,
    {
      driverHardShield: jobAlive(state, "driver") && !state.perksUsedThisLeg.driver,
      cookHalfAsFull: jobAlive(state, "cook") && !state.perksUsedThisLeg.cook,
    },
    ctx.randomInt,
  );
  if (report.perksUsed.driver) state.perksUsedThisLeg.driver = true;
  if (report.perksUsed.cook) state.perksUsedThisLeg.cook = true;
  changes.push(...report.healthChanges);
  state.fired = [];
  if (!plan.rest && state.armed.quartermaster && !state.used.quartermaster && jobAlive(state, "quartermaster")) {
    c.stock.food += CACHE_FOOD;
    state.armed.quartermaster = false;
    state.used.quartermaster = true;
    state.fired.push("quartermaster");
  }
  state.lastPlan = plan;
  state.draft = {
    before,
    log: {
      day,
      leader,
      plan,
      proposals: state.proposals,
      stayedCourse,
      event: null,
      report: { km: report.km, reached: report.reached, healthChanges: changes, stockDelta: {}, cargoDelta: {} },
      where: "",
    },
  };
  state.proposals = [];

  // No event once the trip is over: arrived at the end, or nobody left alive.
  if (c.arrivedDay === null && failed(c, route) !== "all-dead") {
    const leg = eventLeg(state);
    const card = drawEvent(pack, leg.kind, state.dangers[leg.key] ?? 0, ctx.randomInt, state.drawn);
    const res = resolveEvent(c, pack, card, state.armed, state.used, aliveJobs(state), state.travellers, ctx.randomInt);
    for (const id of new Set([card.id, res.card.id])) state.drawn.push(id);
    state.fired.push(...res.fired);
    state.draft.log.event = { id: res.card.id, text: res.card.text };
    if (res.pendingChoice) {
      state.choice = res.pendingChoice;
      state.choiceBallot = { eligible: activeIds(state), votes: {} };
      setPhase(state, "choice", ctx, out);
      out.events.push(pub({ type: "choice", id: res.pendingChoice.id }));
      return;
    }
    changes.push(...res.report!.healthChanges);
  }
  finishDay(state, ctx, out);
}

/** Majority; a tie goes to the leader's vote, or option 0 if they didn't vote. */
function closeChoice(state: State, ctx: GameContext, out: Out): void {
  const b = state.choiceBallot!;
  const card = state.choice!;
  const counts = [0, 0];
  for (const v of Object.values(b.votes)) counts[v]!++;
  const picked: 0 | 1 = counts[0]! > counts[1]! ? 0 : counts[1]! > counts[0]! ? 1 : (b.votes[leaderOf(state)] ?? 0);
  const res = resolveChoice(state.caravan, card, picked, state.armed, state.used, aliveJobs(state), state.travellers, ctx.randomInt);
  state.fired.push(...res.fired);
  const log = state.draft!.log;
  log.event = { id: card.id, text: card.text, choice: { votes: { ...b.votes }, picked, label: card.options[picked].label } };
  log.report.healthChanges.push(...res.report.healthChanges);
  state.choice = null;
  state.choiceBallot = null;
  finishDay(state, ctx, out);
}

/** Closes the day's log with what changed, then the summary. */
function finishDay(state: State, ctx: GameContext, out: Out): void {
  const { route } = world(state);
  const c = state.caravan;
  const { log, before } = state.draft!;
  for (const k of ["food", "water", "medicine", "animals", "coins"] as const) {
    const d = c.stock[k] - before[k];
    if (d !== 0) log.report.stockDelta[k] = d;
  }
  for (const good of new Set([...Object.keys(before.cargo), ...Object.keys(c.stock.cargo)])) {
    const d = (c.stock.cargo[good] ?? 0) - (before.cargo[good] ?? 0);
    if (d !== 0) log.report.cargoDelta[good] = d;
  }
  const name = (id: string) => stopById(route, id).name;
  log.where = c.leg ? `between ${name(c.at)} and ${name(c.leg.to)}` : name(c.at);
  state.log.push(log);
  state.lastDay = log;
  state.draft = null;
  setPhase(state, "summary", ctx, out);
  out.events.push(pub({ type: "day-done", day: log.day }));
}

function tripOver(state: State): boolean {
  const { route } = world(state);
  return state.caravan.arrivedDay !== null || failed(state.caravan, route) !== null;
}

function endView(state: State): EndView {
  const { pack, route } = world(state);
  const c = state.caravan;
  const made = arrived(c, route);
  return {
    arrived: made,
    day: c.arrivedDay ?? c.day - 1,
    deadline: route.deadline,
    coins: c.stock.coins,
    cargo: { ...c.stock.cargo },
    endPrices: { ...(c.prices[route.end] ?? {}) },
    grade: made ? gradeOf(pack, wealth(c, route)) : null,
    alive: Object.fromEntries(state.travellers.map((id) => [id, isAlive(state, id)])),
    removed: state.players.filter((p) => p.left).map((p) => p.id),
    visited: [...c.visited],
    starved: c.starved,
    deaths: state.travellers.filter((id) => !isAlive(state, id)).length,
  };
}

function toRecap(state: State, ctx: GameContext, out: Out): void {
  const { pack, route } = world(state);
  state.plan = null;
  state.ballot = null;
  state.choice = null;
  state.choiceBallot = null;
  state.end = endView(state);
  state.recap = buildRecap(state.log, pack, route, state.end, state.jobs, state.goals, state.goalText, ctx.randomInt);
  setPhase(state, "recap", ctx, out);
  out.events.push(pub({ type: "recap" }));
}

function afterSummary(state: State, ctx: GameContext, out: Out): void {
  if (tripOver(state)) return toRecap(state, ctx, out);
  state.leader = nextSeat(state, state.leader);
  state.proposalNo = 1;
  startPlan(state, ctx, out);
}

function finish(state: State, out: Out): void {
  state.phase = "over";
  state.deadline = 0;
  state.phaseMs = 0;
  out.timers.push({ kind: "cancel", timerId: PHASE });
  out.events.push(pub({ type: "game-over", interrupted: false }));
}

// ---- moving on -------------------------------------------------------------

function expire(state: State, ctx: GameContext, out: Out): void {
  switch (state.phase) {
    case "reveal":
      return startPlan(state, ctx, out);
    case "plan":
      return propose(state, openPlan(state), ctx, out);
    case "vote":
      return closeVote(state, ctx, out);
    case "choice":
      return closeChoice(state, ctx, out);
    case "summary":
      return afterSummary(state, ctx, out);
    case "recap":
      return finish(state, out);
    case "over":
      return;
  }
}

/** Moves on early once everyone connected has done their part. */
function check(state: State, ctx: GameContext, out: Out): void {
  const acked = (id: string) => state.acks.includes(id);
  const b = state.ballot;
  const cb = state.choiceBallot;
  if (state.phase === "reveal" && allHere(state, activeIds(state), acked)) startPlan(state, ctx, out);
  else if (state.phase === "vote" && b && allHere(state, b.eligible, (id) => id in b.votes)) closeVote(state, ctx, out);
  else if (state.phase === "choice" && cb && allHere(state, cb.eligible, (id) => id in cb.votes)) closeChoice(state, ctx, out);
  else if (state.phase === "summary" && allHere(state, activeIds(state), acked)) afterSummary(state, ctx, out);
  else if (state.phase === "recap" && allHere(state, activeIds(state), acked)) finish(state, out);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const isId = (x: unknown): x is string => typeof x === "string" && x.length > 0 && x.length <= 100;
const oneOf = <T extends string>(x: unknown, list: readonly T[]): x is T => typeof x === "string" && (list as readonly string[]).includes(x);

function parsePlan(input: unknown): Plan | null {
  if (typeof input !== "object" || input === null) return null;
  const p = input as Record<string, unknown>;
  if (!oneOf(p.pace, ["slow", "steady", "hard"] as const) || !oneOf(p.rations, ["full", "half", "none"] as const)) return null;
  if (typeof p.rest !== "boolean" || !(p.fork === null || isId(p.fork))) return null;
  const doses = p.doses;
  if (!Array.isArray(doses) || doses.length > MAX_PLAYERS || !doses.every(isId) || new Set(doses).size !== doses.length) return null;
  const trades = p.trades;
  if (!Array.isArray(trades) || trades.length > 20) return null;
  const out: Trade[] = [];
  for (const t of trades) {
    if (typeof t !== "object" || t === null) return null;
    const { item, qty } = t as Record<string, unknown>;
    if (!isId(item) || typeof qty !== "number" || !Number.isInteger(qty) || Math.abs(qty) > 999) return null;
    out.push({ item, qty });
  }
  return { pace: p.pace, rations: p.rations, rest: p.rest, fork: p.fork, doses: [...doses], trades: out };
}

function parseAction(input: unknown): LongTrailAction | null {
  if (typeof input !== "object" || input === null) return null;
  const a = input as Record<string, unknown>;
  switch (a.type) {
    case "ack":
      return { type: "ack" };
    case "next":
      return { type: "next" };
    case "propose": {
      const plan = parsePlan(a.plan);
      return plan ? { type: "propose", plan } : null;
    }
    case "vote":
      return oneOf(a.vote, VOTES) ? { type: "vote", vote: a.vote } : null;
    case "choose":
      return a.option === 0 || a.option === 1 ? { type: "choose", option: a.option } : null;
    case "arm":
      return typeof a.on === "boolean" ? { type: "arm", on: a.on } : null;
    default:
      return null;
  }
}

/** The goal card's own words, or plain words when the deal changed its details. */
function goalTexts(pack: SettingPack, route: RouteDef, goals: Record<string, Goal>, ids: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  const seen = { protect: 0, visit: 0 };
  const protects = pack.goals.filter((g) => g.goal === "protect-someone");
  const visits = pack.goals.filter((g) => typeof g.goal !== "string" && g.goal.kind === "visit");
  for (const id of ids) {
    const goal = goals[id]!;
    if (goal.kind === "protect") {
      out[id] = protects[seen.protect++ % protects.length]?.text ?? "Make sure this traveller reaches the end alive.";
    } else if (goal.kind === "visit") {
      const card = visits[seen.visit++ % Math.max(1, visits.length)];
      const same = card && typeof card.goal !== "string" && card.goal.kind === "visit" && card.goal.stop === goal.stop;
      out[id] = same ? card.text : `Visit ${stopById(route, goal.stop).name}.`;
    } else {
      out[id] = pack.goals.find((g) => JSON.stringify(g.goal) === JSON.stringify(goal))?.text ?? "Help the caravan arrive.";
    }
  }
  return out;
}

// ---- projections -----------------------------------------------------------

function band(stock: number, perDay: number): Band {
  const days = perDay <= 0 ? Infinity : Math.floor(stock / perDay);
  return days >= 6 ? "plenty" : days >= 3 ? "some" : days >= 1 ? "low" : "out";
}

function publicState(state: State): LongTrailPublicState {
  const { pack, route } = world(state);
  const c = state.caravan;
  const plan = state.plan ?? openPlan(state);
  const living = state.travellers.filter((id) => isAlive(state, id)).length;
  const nextKind = c.leg?.kind ?? (c.at === route.end ? undefined : legOut(route, c.at, plan.fork)?.kind);
  const stop = stopById(route, c.at);
  const market = c.leg === null ? stop.market : undefined;
  const b = state.phase === "vote" ? state.ballot : state.phase === "choice" ? state.choiceBallot : null;
  const revealed = state.phase === "recap" || (state.phase === "over" && !state.interrupted);
  return {
    phase: state.phase,
    deadline: state.deadline,
    phaseMs: state.phaseMs,
    settings: { ...state.settings },
    players: state.players.map((p) => ({ id: p.id, left: p.left, job: state.jobs[p.id]! })),
    leader: leaderOf(state),
    proposalNo: state.proposalNo,
    day: c.day,
    deadlineDay: route.deadline,
    route: { start: route.start, end: route.end, stops: route.stops.map((s) => ({ id: s.id, name: s.name, next: s.next.map((l) => l.to), market: !!s.market })) },
    at: c.at,
    leg: c.leg ? { to: c.leg.to, km: c.leg.km, kind: c.leg.kind, kmLeft: c.kmLeft } : null,
    visited: [...c.visited],
    stock: {
      food: band(c.stock.food, living * N.foodPerTraveller[plan.rations]),
      water: band(c.stock.water, living * N.waterPerTraveller[nextKind === "desert" ? "desert" : "other"]),
      medicine: c.stock.medicine,
      coins: c.stock.coins,
      animals: c.stock.animals,
      cargo: { ...c.stock.cargo },
    },
    capacity: c.stock.animals * pack.capacityPerAnimal,
    prices: market ? { goods: { ...(c.prices[c.at] ?? {}) }, supplies: { ...market.supplies } } : null,
    travellers: state.travellers.map((id) => ({ id, health: c.health[id] ?? 0 })),
    openPlan: openPlan(state),
    plan: state.plan,
    votes: b ? { voted: b.eligible.filter((id) => id in b.votes), of: b.eligible.length } : null,
    proposals: state.proposals,
    choice: state.choice ? { id: state.choice.id, text: state.choice.text, options: [state.choice.options[0].label, state.choice.options[1].label] } : null,
    fired: [...state.fired],
    lastDay: state.lastDay,
    acked: activeIds(state).filter((id) => state.acks.includes(id)),
    recap: revealed ? state.recap : null,
    goals: revealed ? { ...state.goals } : null,
    interrupted: state.interrupted,
  };
}

function privateState(state: State, playerId: string): LongTrailPrivateState {
  const p = find(state, playerId);
  const job = state.jobs[playerId];
  if (!p || !job) return { job: null, info: null, goal: null, goalText: null, ability: null, vote: null, choiceVote: null, acked: false };
  const { pack, route } = world(state);
  const live = !p.left && state.phase !== "over";
  const info = live ? jobInfo(job, state.caravan, pack, route, { dangers: state.dangers, plan: state.plan ?? openPlan(state), travellers: state.travellers, choice: state.choice }) : null;
  const ability = isArmable(job)
    ? { job, armed: state.armed[job], used: state.used[job], canArm: live && !state.used[job] && isAlive(state, playerId) }
    : null;
  return {
    job,
    info,
    goal: state.goals[playerId] ?? null,
    goalText: state.goalText[playerId] ?? null,
    ability,
    vote: state.ballot?.votes[playerId] ?? null,
    choiceVote: state.choiceBallot?.votes[playerId] ?? null,
    acked: state.acks.includes(playerId),
  };
}

// ---------------------------------------------------------------------------
// Definition
// ---------------------------------------------------------------------------

export const longTrailGame: GameDefinition<State, LongTrailAction, LongTrailPublicState, LongTrailPrivateState, LongTrailSettings, LongTrailEvent> = {
  manifest: longTrailManifest,
  defaultSettings: DEFAULT_SETTINGS,
  parseSettings: parseLongTrailSettings,
  setupProblem,
  parseAction,

  createGame(players, settings, _match, ctx) {
    const n = players.length;
    if (n < MIN_PLAYERS || n > MAX_PLAYERS) throw new Error(`long-trail: needs ${MIN_PLAYERS}–${MAX_PLAYERS} players, got ${n}`);
    const ids = players.map((p) => p.id);
    const pack = packFor(settings.setting);
    const route = pack.routes[settings.length];
    const jobs = shuffle([...JOBS], ctx.randomInt).slice(0, n);
    const goals = dealGoals(pack, route, ids, ctx.randomInt);
    const stock: Stock = pack.start(n);
    const state: State = {
      phase: "reveal",
      deadline: 0,
      phaseMs: 0,
      settings,
      players: ids.map((id) => ({ id, left: false, away: false })),
      travellers: [...ids],
      caravan: {
        stock,
        at: route.start,
        leg: null,
        kmLeft: 0,
        day: 1,
        health: Object.fromEntries(ids.map((id) => [id, 3 as Health])),
        fatigue: 0,
        prices: rollPrices(route, ctx.randomInt),
        visited: [route.start],
        starved: false,
        arrivedDay: null,
      },
      dangers: rollDangers(route, ctx.randomInt),
      jobs: Object.fromEntries(ids.map((id, i) => [id, jobs[i]!])),
      goals,
      goalText: goalTexts(pack, route, goals, ids),
      armed: { guide: false, scout: false, quartermaster: false, lookout: false },
      used: { guide: false, scout: false, quartermaster: false, lookout: false },
      perksUsedThisLeg: { driver: false, cook: false },
      leader: ctx.randomInt(n),
      proposalNo: 1,
      plan: null,
      lastPlan: null,
      ballot: null,
      choiceBallot: null,
      choice: null,
      acks: [],
      drawn: [],
      proposals: [],
      draft: null,
      fired: [],
      log: [],
      lastDay: null,
      recap: null,
      end: null,
      interrupted: false,
      stats: {},
    };
    const out = newOut();
    setPhase(state, "reveal", ctx, out);
    return done(state, out);
  },

  handleAction(prev, playerId, action, ctx) {
    if (prev.phase === "over") return reject("game-finished", "The game is over.");
    const me = find(prev, playerId);
    if (!me || me.left) return reject("not-in-game", "You are not in this game.");
    if (ctx.now >= prev.deadline) return reject("time-up", "Time is up.");
    const wrong = () => reject("wrong-phase", "You cannot do that now.");

    const state = clone(prev);
    const out = newOut();
    switch (action.type) {
      case "ack":
      case "next": {
        const phases: Phase[] = action.type === "ack" ? ["reveal"] : ["summary", "recap"];
        if (!phases.includes(prev.phase)) return wrong();
        if (!state.acks.includes(playerId)) state.acks.push(playerId);
        break;
      }
      case "propose": {
        if (prev.phase !== "plan") return wrong();
        if (leaderOf(prev) !== playerId) return reject("not-leader", "You are not the leader.");
        const { pack, route } = world(prev);
        const problem = planProblem(prev.caravan, pack, route, action.plan, prev.travellers, {
          healerAlive: jobAlive(prev, "healer"),
          traderLeads: prev.jobs[playerId] === "trader" && isAlive(prev, playerId),
        });
        if (problem) return reject("bad-plan", problem);
        propose(state, action.plan, ctx, out);
        break;
      }
      case "vote": {
        if (prev.phase !== "vote") return wrong();
        const error = castVote(state.ballot!, playerId, action.vote, VOTES);
        if (error) return { ok: false, error };
        break;
      }
      case "choose": {
        if (prev.phase !== "choice") return wrong();
        if (!prev.choiceBallot!.eligible.includes(playerId)) return reject("not-eligible", "You are not in this vote.");
        state.choiceBallot!.votes[playerId] = action.option;
        break;
      }
      case "arm": {
        const job = prev.jobs[playerId];
        if (!isArmable(job)) return reject("no-ability", "Your job has nothing to get ready.");
        if (prev.phase !== "plan" && prev.phase !== "vote") return wrong();
        if (!isAlive(prev, playerId)) return reject("dead", "Your traveller has died.");
        if (prev.used[job]) return reject("used", "You have used this already.");
        state.armed[job] = action.on;
        break;
      }
    }
    check(state, ctx, out);
    return { ok: true, transition: done(state, out) };
  },

  onTimer(prev, timerId, ctx) {
    if (prev.phase === "over" || timerId !== PHASE) return { state: prev, events: [] };
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
    if (prev.phase === "over" || !p || p.left) return { state: prev, events: [] };
    const state = clone(prev);
    const out = newOut();
    find(state, playerId)!.away = true;
    // They might have been the last one a phase was waiting on.
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
    if (prev.phase === "over" || !p || p.left) return { state: prev, events: [] };
    const state = clone(prev);
    const out = newOut();
    const seat = state.players.findIndex((x) => x.id === playerId);
    state.players[seat]!.left = true;
    // Their traveller leaves the caravan; it is not a death.
    state.travellers = state.travellers.filter((id) => id !== playerId);
    delete state.caravan.health[playerId];
    if (state.ballot) dropVoter(state.ballot, playerId);
    if (state.choiceBallot) {
      state.choiceBallot.eligible = state.choiceBallot.eligible.filter((id) => id !== playerId);
      delete state.choiceBallot.votes[playerId];
    }
    if (endIfOver(state, out)) return done(state, out);
    const { route } = world(state);
    // The recap stands as shown; the result counts them as gone.
    if (state.phase === "recap") state.end = endView(state);
    else if (failed(state.caravan, route) === "all-dead") {
      toRecap(state, ctx, out);
      return done(state, out);
    }
    if (state.leader === seat && (state.phase === "plan" || state.phase === "vote")) {
      // Nothing was decided, so nothing failed: the next seat plans afresh.
      state.leader = nextSeat(state, seat);
      startPlan(state, ctx, out);
      return done(state, out);
    }
    // Leading a choice or a summary: the tie-break falls to option 0, and the lead moves on from this seat as usual.
    check(state, ctx, out);
    return done(state, out);
  },

  skipTurn(prev, playerId, ctx) {
    const p = find(prev, playerId);
    if (prev.phase === "over" || !p || p.left) return { state: prev, events: [] };
    const state = clone(prev);
    const out = newOut();
    if (prev.phase === "plan" && leaderOf(prev) === playerId) {
      propose(state, openPlan(state), ctx, out);
      return done(state, out);
    }
    if (prev.phase === "vote" && state.ballot) dropVoter(state.ballot, playerId);
    else if (prev.phase === "choice" && state.choiceBallot) {
      state.choiceBallot.eligible = state.choiceBallot.eligible.filter((id) => id !== playerId);
      delete state.choiceBallot.votes[playerId];
    } else if (["reveal", "summary", "recap"].includes(prev.phase) && !state.acks.includes(playerId)) state.acks.push(playerId);
    else return { state: prev, events: [] };
    check(state, ctx, out);
    return done(state, out);
  },

  getPublicState: publicState,
  getPrivateState: privateState,

  getAwaitedPlayerIds(state) {
    const b = state.phase === "vote" ? state.ballot : state.phase === "choice" ? state.choiceBallot : null;
    if (b) return b.eligible.filter((id) => !(id in b.votes));
    if (state.phase === "plan") return [leaderOf(state)];
    if (state.phase === "over") return [];
    return activeIds(state).filter((id) => !state.acks.includes(id));
  },

  getResult(state) {
    if (state.phase !== "over") return null;
    if (state.interrupted || !state.end) return { winnerIds: [], standings: [], headline: "The game ended early." };
    const { pack } = world(state);
    return outcome(state.players.map((p) => p.id), state.goals, state.end, pack, state.caravan.day - 1);
  },

  partyStats(state) {
    return state.stats ?? {};
  },
};
