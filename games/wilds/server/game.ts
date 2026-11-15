import {
  allVoted,
  bumpStat,
  castVote,
  dropVoter,
  type GameContext,
  type GameDefinition,
  type GameEventEnvelope,
  type GameResult,
  openBallot,
  type TimerRequest,
} from "@games/game-core";
import { EVENTS } from "../shared/events.ts";
import { within, TILE_ORDER } from "../shared/hex.ts";
import { roundLines } from "../shared/lines.ts";
import { wildsManifest } from "../shared/manifest.ts";
import { buildBoard, ISLANDS } from "../shared/maps.ts";
import { N } from "../shared/numbers.ts";
import { MAX_PLAYERS, MIN_PLAYERS, parseWildsSettings, setupProblem } from "../shared/settings.ts";
import {
  DEFAULT_SETTINGS,
  type ItemId,
  type Phase,
  type Plan,
  type RuinId,
  type Step,
  type WildsAction,
  type WildsEvent,
  type WildsPrivateState,
  type WildsPublicState,
  type WildsServerState,
  type WildsSettings,
  type World,
} from "../shared/types.ts";
import { planProblem, playBeats } from "./beats.ts";
import { applyEvent, canApply, draw, newDeck, pickTiles } from "./deck.ts";
import { islandTurn } from "./island.ts";
import { parseAction, ROLES } from "./parse.ts";
import { spiderPlan } from "./spider.ts";
import { privateState, publicState, shownSteps } from "./views.ts";
import { addNoise, cloneWorld } from "./world.ts";

type State = WildsServerState;
type Events = GameEventEnvelope<WildsEvent>[];

const ITEMS: ItemId[] = ["torch", "planks", "medkit", "lure"];
const GUARDS: Plan = [{ kind: "guard" }, { kind: "guard" }];

/** One timer: the phase's deadline. Setting it again replaces it. */
const PHASE = "phase";
/** An alarm this early is a stray, not the deadline. */
const SLACK_MS = 500;

const pub = (event: WildsEvent): GameEventEnvelope<WildsEvent> => ({ visibility: { kind: "public" }, event });
const reject = (code: string, message: string): GameResult<State, WildsEvent> => ({ ok: false, error: { code, message } });

interface Out {
  events: Events;
  timers: TimerRequest[];
}

const clone = (state: State): State => structuredClone(state);
const newOut = (): Out => ({ events: [], timers: [] });
const done = (state: State, out: Out) => ({ state, events: out.events, timers: out.timers });

const inGame = (state: State) => state.world.explorers.filter((e) => !e.left);
/** Up and still in: the explorers who plan. */
const planners = (state: State) => inGame(state).filter((e) => !e.down);
const find = (state: State, id: string) => state.world.explorers.find((e) => e.id === id);

function phaseMs(state: State, phase: Phase): number {
  switch (phase) {
    case "roles": return N.timers.roles;
    case "plan": return state.settings.planSeconds * 1000;
    case "choice": return N.timers.choice;
    case "report": return N.timers.report;
    case "over": return 0;
  }
}

function setPhase(state: State, phase: Phase, ctx: GameContext, out: Out): void {
  const ms = phaseMs(state, phase);
  state.phase = phase;
  state.deadline = ctx.now + ms;
  out.timers.push({ kind: "set", timerId: PHASE, delayMs: ms });
  out.events.push(pub({ type: "phase", phase, round: state.world.round }));
}

function finish(state: State, interrupted: boolean, out: Out): void {
  state.phase = "over";
  state.deadline = 0;
  state.interrupted = interrupted;
  state.ballot = null;
  state.plans = {};
  state.ready = [];
  out.timers.push({ kind: "cancel", timerId: PHASE });
  out.events.push(pub({ type: "game-over", interrupted }));
}

// ---- the round -------------------------------------------------------------

/** applyEvent takes a random source but never draws from it. */
const NO_RANDOM = () => 0;

/**
 * The spider's move if nothing changes. On a copy of the world it plays what the island turn
 * plays before the spider moves and the team already knows: a stone hand's noise due this round,
 * then this round's event. An event with a vote is left out (the vote is not known yet), and so is
 * fire spread (it is random).
 */
function arrowFor(state: State) {
  const w = cloneWorld(state.world);
  let pending = state.pending;
  if (pending && pending.due === w.round) {
    addNoise(w, pending.tile, N.stoneNoise, []);
    pending = null;
  }
  if (state.event && !EVENTS[state.event.id].options) applyEvent(w, state.event, null, pending, NO_RANDOM, []);
  return spiderPlan(w);
}

/** Round 1 uses the card drawn at the start. Later rounds move on one round and draw ahead. */
function startPlan(state: State, ctx: GameContext, out: Out): void {
  const w = state.world;
  if (state.lastRound !== null) {
    w.round += 1;
    const id = state.next ?? draw(state.deck, w, w.round, state.pending, state.event?.id ?? null, ctx.randomInt);
    state.event = { id, tiles: pickTiles(w, id, ctx.randomInt) };
    state.next = draw(state.deck, w, w.round + 1, state.pending, id, ctx.randomInt);
  } else if (state.event) {
    state.event = { id: state.event.id, tiles: pickTiles(w, state.event.id, ctx.randomInt) };
  }
  state.plans = {};
  state.ready = [];
  state.ballot = null;
  state.nexts = [];
  state.beatSteps = [];
  state.arrow = arrowFor(state);
  setPhase(state, "plan", ctx, out);
}

function closePlan(state: State, ctx: GameContext, out: Out): void {
  const plans: Record<string, Plan> = {};
  for (const e of planners(state)) plans[e.id] = state.plans[e.id] ?? GUARDS;
  const steps: Step[] = [];
  playBeats(state.world, plans, ctx.randomInt, (state.stats ??= {}), steps);
  state.plans = {};
  state.ready = [];
  state.arrow = null;
  const card = EVENTS[state.event!.id];
  // The island turn lands a stone hand's noise that is due before the event, so the event sees no bargain then.
  const pending = state.pending && state.pending.due === state.world.round ? null : state.pending;
  // An event that can no longer happen gets no vote. The report says "nothing happened".
  if (card.options && canApply(state.world, state.event!.id, pending)) {
    state.beatSteps = steps;
    state.ballot = openBallot<string>(inGame(state).map((e) => e.id));
    setPhase(state, "choice", ctx, out);
    return;
  }
  runIsland(state, steps, null, null, ctx, out);
}

function closeChoice(state: State, ctx: GameContext, out: Out): void {
  const b = state.ballot!;
  const card = EVENTS[state.event!.id];
  const options = card.options ?? [];
  const counts = options.map(() => 0);
  for (const id of b.eligible) {
    const v = b.votes[id];
    if (v !== undefined) counts[Number(v)]! += 1;
  }
  let option: number;
  if (card.kind === "bargain") {
    // Accept needs more Accept than Refuse among the votes cast. A tie, or no votes, is Refuse.
    option = counts[0]! > counts[1]! ? 0 : 1;
    for (const id of b.eligible) if (b.votes[id] === "1") bumpStat((state.stats ??= {}), id, "noGoVotes");
  } else {
    // Most votes. A tie goes to the first option.
    option = counts.indexOf(Math.max(...counts));
  }
  state.ballot = null;
  const steps = state.beatSteps;
  state.beatSteps = [];
  runIsland(state, steps, option, counts, ctx, out);
}

function runIsland(state: State, steps: Step[], option: number | null, votes: number[] | null, ctx: GameContext, out: Out): void {
  const w = state.world;
  const r = islandTurn(w, state.event!, option, state.pending, ctx.randomInt, steps);
  state.pending = r.pending;
  state.end = r.result;
  // Lines only from what the team could see.
  const lines = roundLines(shownSteps(w, steps), (id) => `{{${id}}}`);
  state.lastRound = { round: w.round, steps, lines, votes };
  state.nexts = [];
  setPhase(state, "report", ctx, out);
}

function afterReport(state: State, ctx: GameContext, out: Out): void {
  if (state.end) return finish(state, false, out);
  startPlan(state, ctx, out);
}

function randomRoles(state: State, ctx: GameContext): void {
  for (const e of inGame(state)) if (!e.role) e.role = ROLES[ctx.randomInt(ROLES.length)]!;
}

/** Moves on early once everyone it waits for has done their part. */
function check(state: State, ctx: GameContext, out: Out): void {
  switch (state.phase) {
    case "roles":
      if (inGame(state).every((e) => e.role)) startPlan(state, ctx, out);
      return;
    case "plan":
      if (planners(state).every((e) => state.ready.includes(e.id))) closePlan(state, ctx, out);
      return;
    case "choice":
      if (state.ballot && allVoted(state.ballot)) closeChoice(state, ctx, out);
      return;
    case "report":
      if (inGame(state).every((e) => state.nexts.includes(e.id))) afterReport(state, ctx, out);
      return;
    case "over":
      return;
  }
}

function expire(state: State, ctx: GameContext, out: Out): void {
  switch (state.phase) {
    case "roles":
      randomRoles(state, ctx);
      return startPlan(state, ctx, out);
    case "plan":
      return closePlan(state, ctx, out);
    case "choice":
      return closeChoice(state, ctx, out);
    case "report":
      return afterReport(state, ctx, out);
    case "over":
      return;
  }
}

// ---- setting up ------------------------------------------------------------

function newWorld(ids: string[], settings: WildsSettings, ctx: GameContext): { world: World; board: State["board"] } {
  const island = ctx.randomInt(ISLANDS.length);
  const turns = ctx.randomInt(6);
  const ruinOrder: [RuinId, RuinId] = ctx.randomInt(2) === 0 ? ["shrine", "tower"] : ["tower", "shrine"];
  const { tiles, camp, gate, nest, ruins } = buildBoard(island, turns, ruinOrder);
  for (const t of within(camp, 1)) if (tiles[t]) tiles[t]!.open = true;
  const items = ids.map(() => ITEMS[ctx.randomInt(ITEMS.length)]!);
  if (!items.includes("torch")) items[ctx.randomInt(items.length)] = "torch";
  const world: World = {
    tiles,
    order: [...TILE_ORDER],
    explorers: ids.map((id, i) => ({
      id, role: null, tile: camp, hearts: N.hearts, items: [items[i]!], down: false, shield: false, left: false,
    })),
    spider: { tile: nest, rest: false, still: false },
    stones: [],
    half: [],
    gateOpen: false,
    sun: 0,
    round: 1,
    sunLimit: settings.sunLimit,
    speedBonus: 0,
  };
  return { world, board: { camp, gate, nest, ruins } };
}

// ---- results -----------------------------------------------------------------

function headline(state: State): string {
  const w = state.world;
  const stones = `${w.stones.length} of 3 key stones found.`;
  if (state.end === "win") {
    // At the win check the sun has not moved for this round yet, and Force or Warm spring may have pushed it on.
    const left = Math.max(0, w.sunLimit - w.sun - 1);
    if (left === 0) return "You escaped just in time.";
    return `You escaped with ${left} ${left === 1 ? "round" : "rounds"} left.`;
  }
  if (state.end === "down") return `Everyone was down. ${stones}`;
  return `The sun went down. ${stones}`;
}

// ---------------------------------------------------------------------------
// Definition
// ---------------------------------------------------------------------------

export const wildsGame: GameDefinition<State, WildsAction, WildsPublicState, WildsPrivateState, WildsSettings, WildsEvent> = {
  manifest: wildsManifest,
  defaultSettings: DEFAULT_SETTINGS,
  parseSettings: parseWildsSettings,
  setupProblem,
  parseAction,

  createGame(players, settings, _match, ctx) {
    const n = players.length;
    if (n < MIN_PLAYERS || n > MAX_PLAYERS) throw new Error(`wilds: needs ${MIN_PLAYERS}–${MAX_PLAYERS} players, got ${n}`);
    const { world, board } = newWorld(players.map((p) => p.id), settings, ctx);
    const deck = newDeck(ctx.randomInt);
    const first = draw(deck, world, 1, null, null, ctx.randomInt);
    const second = draw(deck, world, 2, null, first, ctx.randomInt);
    const state: State = {
      phase: "roles",
      deadline: 0,
      settings,
      world,
      board,
      deck,
      event: { id: first, tiles: [] }, // its tiles are picked as round 1 opens
      next: second,
      pending: null,
      plans: {},
      ready: [],
      ballot: null,
      nexts: [],
      arrow: null,
      beatSteps: [],
      lastRound: null,
      end: null,
      interrupted: false,
      stats: {},
    };
    const out = newOut();
    setPhase(state, "roles", ctx, out);
    return done(state, out);
  },

  handleAction(prev, playerId, action, ctx) {
    if (prev.phase === "over") return reject("game-finished", "The game is over.");
    const me = find(prev, playerId);
    if (!me || me.left) return reject("not-in-game", "You are not in this game.");
    if (ctx.now >= prev.deadline) return reject("time-up", "Time is up.");
    const wrong = () => reject("wrong-phase", "You cannot do that now.");
    const isDown = () => reject("down", "You are down. A friend can Help you up.");

    const state = clone(prev);
    const out = newOut();
    switch (action.type) {
      case "pick-role":
        if (prev.phase !== "roles") return wrong();
        find(state, playerId)!.role = action.role;
        break;
      case "set-plan": {
        if (prev.phase !== "plan") return wrong();
        if (me.down) return isDown();
        if (prev.ready.includes(playerId)) return reject("ready-locked", "Tap Edit to change your plan.");
        for (const card of action.plan) {
          const problem = planProblem(prev.world, playerId, card);
          if (problem) return reject("bad-plan", problem);
        }
        state.plans[playerId] = action.plan;
        break;
      }
      case "ready":
        if (prev.phase !== "plan") return wrong();
        if (me.down) return isDown();
        if (!state.ready.includes(playerId)) state.ready.push(playerId);
        break;
      case "unready":
        if (prev.phase !== "plan") return wrong();
        state.ready = state.ready.filter((id) => id !== playerId);
        break;
      case "vote": {
        if (prev.phase !== "choice") return wrong();
        const options = EVENTS[prev.event!.id].options ?? [];
        const error = castVote(state.ballot!, playerId, String(action.option), options.map((_, i) => String(i)));
        if (error) return { ok: false, error };
        break;
      }
      case "next":
        if (prev.phase !== "report") return wrong();
        if (!state.nexts.includes(playerId)) state.nexts.push(playerId);
        break;
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

  onPlayerRemoved(prev, playerId, ctx) {
    const p = find(prev, playerId);
    if (prev.phase === "over" || !p || p.left) return { state: prev, events: [] };
    const state = clone(prev);
    const out = newOut();
    const e = find(state, playerId)!;
    e.left = true;
    e.items = [];
    e.shield = false;
    delete state.plans[playerId];
    state.ready = state.ready.filter((id) => id !== playerId);
    state.nexts = state.nexts.filter((id) => id !== playerId);
    if (state.ballot) dropVoter(state.ballot, playerId);
    if (inGame(state).length === 0) {
      finish(state, true, out);
      return done(state, out);
    }
    check(state, ctx, out);
    return done(state, out);
  },

  skipTurn(prev, playerId, ctx) {
    const p = find(prev, playerId);
    if (prev.phase === "over" || !p || p.left) return { state: prev, events: [] };
    const state = clone(prev);
    const out = newOut();
    const me = find(state, playerId)!;
    switch (prev.phase) {
      case "roles":
        if (me.role) return { state: prev, events: [] };
        me.role = ROLES[ctx.randomInt(ROLES.length)]!;
        break;
      case "plan":
        if (me.down || prev.ready.includes(playerId)) return { state: prev, events: [] };
        state.plans[playerId] = GUARDS;
        state.ready.push(playerId);
        break;
      case "choice":
        if (!state.ballot?.eligible.includes(playerId)) return { state: prev, events: [] };
        dropVoter(state.ballot, playerId);
        break;
      case "report":
        if (state.nexts.includes(playerId)) return { state: prev, events: [] };
        state.nexts.push(playerId);
        break;
    }
    // The room reads a skip with no events as "can't skip", and would not keep it.
    out.events.push(pub({ type: "skipped", playerId }));
    check(state, ctx, out);
    return done(state, out);
  },

  getPublicState: publicState,
  getPrivateState: privateState,

  getAwaitedPlayerIds(state) {
    switch (state.phase) {
      case "roles": return inGame(state).filter((e) => !e.role).map((e) => e.id);
      case "plan": return planners(state).filter((e) => !state.ready.includes(e.id)).map((e) => e.id);
      case "choice": return state.ballot ? state.ballot.eligible.filter((id) => !(id in state.ballot!.votes)) : [];
      default: return [];
    }
  },

  getResult(state) {
    if (state.phase !== "over") return null;
    if (state.interrupted) return { winnerIds: [], standings: [], headline: "The game ended early." };
    const all = state.world.explorers;
    return {
      winnerIds: state.end === "win" ? all.map((e) => e.id) : [],
      standings: all.map((e) => ({
        playerId: e.id,
        value: e.down ? 0 : e.hearts,
        label: e.down ? "Down" : e.hearts === 1 ? "1 Heart" : `${e.hearts} Hearts`,
      })),
      headline: headline(state),
    };
  },

  partyStats(state) {
    return state.stats ?? {};
  },
};
