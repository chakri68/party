import { type GameContext, type GameDefinition, type GameEventEnvelope, type GameResult, shuffle, type TimerRequest } from "@games/game-core";
import { dontSayItManifest } from "../shared/manifest.ts";
import {
  ACTION_TYPES,
  type Card,
  DEFAULT_SETTINGS,
  DISPUTE_MS,
  type DontSayItAction,
  type DontSayItCarry,
  type DontSayItEvent,
  type DontSayItPlayerState,
  type DontSayItPrivateState,
  type DontSayItPublicState,
  type DontSayItServerState,
  type DontSayItSettings,
  type EndReason,
  MIN_PLAYERS,
  MIN_TEAM,
  other,
  type Outcome,
  OUTCOME_POINTS,
  type Phase,
  type PublicTeam,
  RESULT_MS,
  type Role,
  TEAM_NAMES,
  type TeamId,
  TURN_SECONDS_OPTIONS,
  TURNS_OPTIONS,
} from "../shared/types.ts";
import { CARDS, parseCard } from "./cards.ts";
import { balancedSplit, canSwitch, captainOf, members, parseCarry, pickDescriber, restoreTeams, sizes } from "./teams.ts";

type State = DontSayItServerState;
type Player = DontSayItPlayerState;
type Events = GameEventEnvelope<DontSayItEvent>[];

const pub = (event: DontSayItEvent): GameEventEnvelope<DontSayItEvent> => ({ visibility: { kind: "public" }, event });

const reject = (code: string, message: string): GameResult<State, DontSayItEvent> => ({
  ok: false,
  error: { code, message },
});

/** One timer: the phase's deadline. Setting it again replaces it. */
const PHASE = "phase";
/** An alarm this early is a stray, not the deadline (Dominion's guard). */
const SLACK_MS = 500;
/** Phases whose deadline closes the door on actions. */
const TIMED: readonly Phase[] = ["turn", "buzzed", "appeal"];
/** A card's in play: the describer and the other team can see it. */
const CARD_UP: readonly Phase[] = ["turn", "buzzed", "appeal"];

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
const turnMs = (state: State) => state.settings.turnSeconds * 1000;
const totalTurns = (state: State) => state.settings.turnsPerTeam * 2 + (state.suddenDeath ? 2 : 0);

function deckOf(state: State): readonly Card[] {
  return state.deck ? state.deck.map(parseCard) : CARDS;
}

function currentCard(state: State): Card | null {
  const t = state.turn;
  if (!t || t.card < 0) return null;
  return deckOf(state)[state.order[t.card]!] ?? null;
}

/** Fresh cards first, then the ones the last match used, each part shuffled. */
function buildOrder(deck: readonly Card[], usedBefore: readonly string[], rand: GameContext["randomInt"]): number[] {
  const idx = deck.map((_, i) => i);
  const fresh = idx.filter((i) => !usedBefore.includes(deck[i]!.id));
  const stale = idx.filter((i) => usedBefore.includes(deck[i]!.id));
  return [...shuffle(fresh, rand), ...shuffle(stale, rand)];
}

function setPhase(state: State, phase: Phase, ms: number, ctx: GameContext, out: Out): void {
  state.phase = phase;
  state.deadline = ctx.now + ms;
  state.phaseMs = ms;
  out.timers.push({ kind: "set", timerId: PHASE, delayMs: ms });
}

/** A phase that waits on a person, not a clock. */
function setUntimed(state: State, phase: Phase, out: Out): void {
  state.phase = phase;
  state.deadline = 0;
  state.phaseMs = 0;
  out.timers.push({ kind: "cancel", timerId: PHASE });
}

function finish(state: State, reason: EndReason, out: Out): void {
  setUntimed(state, "finished", out);
  state.endReason = reason;
  out.events.push(pub({ type: "game-over", reason }));
}

/** The floor applies on every change, so the total on screen is the total. */
function score(state: State, team: TeamId, delta: number): void {
  const before = state.scores[team];
  state.scores[team] = Math.max(0, before + delta);
  if (state.turn) state.turn.net += state.scores[team] - before;
}

/** The next card in the match's order. Ran out: start over, and say so. */
function deal(state: State, ctx: GameContext, out: Out): void {
  if (state.pos >= state.order.length) {
    state.order = shuffle(deckOf(state).map((_, i) => i), ctx.randomInt);
    state.pos = 0;
    state.reshuffled = true;
    out.events.push(pub({ type: "reshuffled" }));
  }
  state.turn!.card = state.pos++;
}

/** The card in hand is done with: scored, public, and the next one dealt. */
function resolve(state: State, outcome: Outcome, ctx: GameContext, out: Out): void {
  const t = state.turn!;
  const card = currentCard(state)!;
  t.cards.push({ target: card.target, outcome });
  score(state, t.team, OUTCOME_POINTS[outcome]);
  out.events.push(pub({ type: "card", target: card.target, outcome, team: t.team }));
  deal(state, ctx, out);
}

/** Sets up the next turn: the team whose go it is, and who describes. The describer starts the clock. */
function prepareTurn(state: State, out: Out): void {
  const team = ((state.firstTeam + state.turnIndex) % 2) as TeamId;
  state.turnIndex++;
  const describerId = pickDescriber(state.players, team)!;
  state.turn = { team, describerId, card: -1, cards: [], net: 0, buzzerId: null, captainId: null, turnLeft: 0 };
  setUntimed(state, "ready", out);
  out.events.push(pub({ type: "turn-ready", team, describerId, suddenDeath: state.suddenDeath }));
}

/** Someone else from the same team takes the turn before it's started. */
function handOver(state: State, skip: string, out: Out): void {
  const t = state.turn!;
  const next = pickDescriber(state.players, t.team, [skip]);
  if (!next) return;
  t.describerId = next;
  out.events.push(pub({ type: "turn-ready", team: t.team, describerId: next, suddenDeath: state.suddenDeath }));
}

function startClock(state: State, ctx: GameContext, out: Out): void {
  const t = state.turn!;
  find(state, t.describerId)!.described++;
  setPhase(state, "turn", turnMs(state), ctx, out);
  deal(state, ctx, out);
  out.events.push(pub({ type: "turn-started", team: t.team }));
}

/** The turn's over. A card still in hand is retired unscored. */
function endTurn(state: State, reason: "time" | "left" | "skipped", ctx: GameContext, out: Out): void {
  const t = state.turn!;
  const card = currentCard(state);
  if (card) t.cards.push({ target: card.target, outcome: reason === "time" ? "time" : "ended" });
  t.card = -1;
  t.buzzerId = null;
  t.captainId = null;
  t.turnLeft = 0;
  setPhase(state, "turn-result", RESULT_MS, ctx, out);
  out.events.push(pub({ type: "turn-over", team: t.team, net: t.net, reason }));
}

/** After the summary: the next turn, sudden death, or the end. */
function afterResult(state: State, out: Out): void {
  if (state.turnIndex < totalTurns(state)) return prepareTurn(state, out);
  if (!state.suddenDeath && state.scores[0] === state.scores[1]) {
    state.suddenDeath = true;
    out.events.push(pub({ type: "sudden-death" }));
    return prepareTurn(state, out);
  }
  finish(state, "done", out);
}

// ---- disputes: the turn clock is frozen in turnLeft throughout ------------

function buzz(state: State, by: string, ctx: GameContext, out: Out): void {
  const t = state.turn!;
  t.turnLeft = Math.max(1, state.deadline - ctx.now);
  t.buzzerId = by;
  setPhase(state, "buzzed", DISPUTE_MS, ctx, out);
  out.events.push(pub({ type: "buzzed", by }));
  // A describer who isn't there can't answer: straight to the captain.
  if (find(state, t.describerId)!.away) toAppeal(state, [], ctx, out);
}

/** The turn clock picks up where it stopped. */
function resume(state: State, ctx: GameContext, out: Out): void {
  const t = state.turn!;
  const left = t.turnLeft;
  t.buzzerId = null;
  t.captainId = null;
  t.turnLeft = 0;
  state.phase = "turn";
  state.deadline = ctx.now + left;
  state.phaseMs = turnMs(state);
  out.timers.push({ kind: "set", timerId: PHASE, delayMs: left });
}

function dropBuzz(state: State, ctx: GameContext, out: Out): void {
  out.events.push(pub({ type: "dropped" }));
  resume(state, ctx, out);
}

/** The other team's captain rules. Nobody there to rule: it's dropped. */
function toAppeal(state: State, skip: string[], ctx: GameContext, out: Out): void {
  const t = state.turn!;
  const captain = captainOf(state.players, other(t.team), skip);
  if (!captain || find(state, captain)!.away) return dropBuzz(state, ctx, out);
  t.captainId = captain;
  setPhase(state, "appeal", DISPUTE_MS, ctx, out);
  out.events.push(pub({ type: "appealed", captainId: captain }));
}

/** The clock ran out on the current phase. */
function expire(state: State, ctx: GameContext, out: Out): void {
  switch (state.phase) {
    case "turn":
      return endTurn(state, "time", ctx, out);
    case "buzzed":
      // Silence isn't a confession.
      return toAppeal(state, [], ctx, out);
    case "appeal":
      // A buzz needs a yes.
      return dropBuzz(state, ctx, out);
    case "turn-result":
      return afterResult(state, out);
    default:
      return;
  }
}

/** Below two on a side there's no game: one describer, nobody to guess. */
function shortHanded(state: State): boolean {
  if (state.phase === "teams") return activeIds(state).length < MIN_PLAYERS;
  const [a, b] = sizes(state.players);
  return a < MIN_TEAM || b < MIN_TEAM;
}

function awaited(state: State): string[] {
  const t = state.turn;
  switch (state.phase) {
    case "ready":
    case "turn":
    case "buzzed":
      return [t!.describerId];
    case "appeal":
      return t!.captainId ? [t!.captainId] : [];
    default:
      return [];
  }
}

/** Last match's ids plus this one's. Once that's the whole deck, just this one's. */
function usedIds(state: State): string[] {
  const deck = deckOf(state);
  const now = (state.reshuffled ? state.order : state.order.slice(0, state.pos)).map((i) => deck[i]!.id);
  const all = [...new Set([...state.usedBefore, ...now])];
  return all.length >= deck.length ? now : all;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function parseSettings(input: unknown): DontSayItSettings | null {
  if (input === undefined || input === null) return { ...DEFAULT_SETTINGS };
  if (typeof input !== "object" || Array.isArray(input)) return null;
  const s = { ...DEFAULT_SETTINGS, ...(input as Partial<DontSayItSettings>) };
  if (!TURN_SECONDS_OPTIONS.includes(s.turnSeconds) || !TURNS_OPTIONS.includes(s.turnsPerTeam)) return null;
  return { turnSeconds: s.turnSeconds, turnsPerTeam: s.turnsPerTeam };
}

function parseAction(input: unknown): DontSayItAction | null {
  if (typeof input !== "object" || input === null) return null;
  const type = (input as { type?: unknown }).type;
  return ACTION_TYPES.includes(type as DontSayItAction["type"]) ? ({ type } as DontSayItAction) : null;
}

// ---------------------------------------------------------------------------
// Definition
// ---------------------------------------------------------------------------

export const dontSayItGame: GameDefinition<
  DontSayItServerState,
  DontSayItAction,
  DontSayItPublicState,
  DontSayItPrivateState,
  DontSayItSettings,
  DontSayItEvent
> = {
  manifest: dontSayItManifest,
  defaultSettings: DEFAULT_SETTINGS,
  parseSettings,
  parseAction,

  createGame(players, settings, match, ctx, options) {
    const n = players.length;
    const { minPlayers, maxPlayers } = dontSayItManifest;
    if (n < minPlayers || n > maxPlayers) {
      throw new Error(`dont-say-it: needs ${minPlayers}–${maxPlayers} players, got ${n}`);
    }
    const deck = options?.deck ? (options.deck as string[]) : null;
    // Checked now, so a bad test deck fails at the start rather than mid-game.
    if (deck && (!deck.length || deck.some((l) => typeof l !== "string"))) throw new Error("A deck must be card lines.");
    deck?.forEach(parseCard);
    const carry = parseCarry(match.carry);
    const teams = restoreTeams(
      players.map((p) => p.id),
      carry,
      ctx.randomInt,
    );
    const state: State = {
      phase: "teams",
      settings,
      players: players.map((p, seat) => ({ id: p.id, seat, team: teams.get(p.id)!, removed: false, away: false, described: 0 })),
      scores: [0, 0],
      firstTeam: ctx.randomInt(2) === 0 ? 0 : 1,
      turnIndex: 0,
      suddenDeath: false,
      deadline: 0,
      phaseMs: 0,
      turn: null,
      order: [],
      pos: 0,
      usedBefore: carry?.used ?? [],
      reshuffled: false,
      deck,
      endReason: null,
    };
    state.order = buildOrder(deckOf(state), state.usedBefore, ctx.randomInt);
    return { state, events: [] };
  },

  handleAction(prev, playerId, action, ctx) {
    if (prev.phase === "finished") return reject("game-finished", "The game is over.");
    const me = find(prev, playerId);
    if (!me || !active(me)) return reject("not-in-game", "You're not in this game.");
    if (TIMED.includes(prev.phase) && ctx.now >= prev.deadline) return reject("time-up", "Time's up.");
    const host = ctx.hostId === playerId;
    const t = prev.turn;
    const describer = !!t && t.describerId === playerId;

    const state = clone(prev);
    const out = newOut();

    switch (action.type) {
      case "switch": {
        if (prev.phase !== "teams") return reject("wrong-phase", "Teams are set.");
        if (!canSwitch(sizes(prev.players), me.team)) return reject("uneven", "That would make the teams uneven.");
        const p = find(state, playerId)!;
        p.team = other(p.team);
        out.events.push(pub({ type: "teams-changed" }));
        break;
      }
      case "shuffle": {
        if (!host) return reject("host-only", "Only the host can do that.");
        if (prev.phase !== "teams") return reject("wrong-phase", "Teams are set.");
        const split = balancedSplit(activeIds(state), ctx.randomInt);
        for (const p of state.players) if (active(p)) p.team = split.get(p.id)!;
        out.events.push(pub({ type: "teams-changed" }));
        break;
      }
      case "start": {
        if (!host) return reject("host-only", "Only the host can do that.");
        if (prev.phase !== "teams") return reject("wrong-phase", "Already started.");
        const [a, b] = sizes(prev.players);
        if (a < MIN_TEAM || b < MIN_TEAM) return reject("short-team", `Each team needs at least ${MIN_TEAM}.`);
        prepareTurn(state, out);
        break;
      }
      case "go": {
        if (prev.phase !== "ready") return reject("wrong-phase", "Not now.");
        if (!describer) return reject("not-yours", "It's not your turn to describe.");
        startClock(state, ctx, out);
        break;
      }
      case "got":
      case "skip":
      case "oops": {
        if (prev.phase !== "turn") return reject("wrong-phase", "Not now.");
        if (!describer) return reject("not-yours", "Only the describer can do that.");
        resolve(state, action.type, ctx, out);
        break;
      }
      case "buzz": {
        if (prev.phase !== "turn") return reject("wrong-phase", "Not now.");
        if (me.team === t!.team) return reject("own-team", "Only the other team can buzz.");
        buzz(state, playerId, ctx, out);
        break;
      }
      case "fair":
      case "nope": {
        if (prev.phase !== "buzzed") return reject("wrong-phase", "Not now.");
        if (!describer) return reject("not-yours", "The describer answers this.");
        if (action.type === "fair") {
          resume(state, ctx, out);
          resolve(state, "fair", ctx, out);
        } else {
          toAppeal(state, [], ctx, out);
        }
        break;
      }
      case "uphold":
      case "drop": {
        if (prev.phase !== "appeal") return reject("wrong-phase", "Not now.");
        if (t!.captainId !== playerId) return reject("not-yours", "The captain decides this.");
        if (action.type === "uphold") {
          resume(state, ctx, out);
          resolve(state, "upheld", ctx, out);
        } else {
          dropBuzz(state, ctx, out);
        }
        break;
      }
      case "next": {
        if (!host) return reject("host-only", "Only the host can do that.");
        if (prev.phase !== "turn-result") return reject("wrong-phase", "Not now.");
        afterResult(state, out);
        break;
      }
    }
    return { ok: true, transition: done(state, out) };
  },

  onTimer(prev, timerId, ctx) {
    if (timerId !== PHASE || prev.phase === "finished" || prev.deadline === 0) return { state: prev, events: [] };
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
    const t = state.turn;
    if (t && state.phase === "ready" && t.describerId === playerId) {
      // Hand it to someone who's here, if anyone is.
      const next = pickDescriber(state.players, t.team, [playerId]);
      if (next && !find(state, next)!.away) handOver(state, playerId, out);
    } else if (t && state.phase === "buzzed" && t.describerId === playerId) {
      toAppeal(state, [], ctx, out);
    } else if (t && state.phase === "appeal" && t.captainId === playerId) {
      toAppeal(state, [playerId], ctx, out);
    }
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
    if (shortHanded(state)) {
      finish(state, "abandoned", out);
      return done(state, out);
    }
    const t = state.turn;
    if (!t) return done(state, out);
    if (t.describerId === playerId) {
      if (state.phase === "ready") handOver(state, playerId, out);
      else if (CARD_UP.includes(state.phase)) endTurn(state, "left", ctx, out);
    } else if (state.phase === "appeal" && t.captainId === playerId) {
      toAppeal(state, [playerId], ctx, out);
    }
    return done(state, out);
  },

  skipTurn(prev, playerId, ctx) {
    if (prev.phase === "finished" || !awaited(prev).includes(playerId)) return { state: prev, events: [] };
    const state = clone(prev);
    const out = newOut();
    out.events.push(pub({ type: "skipped", playerId }));
    switch (state.phase) {
      case "ready":
        handOver(state, playerId, out);
        break;
      case "turn":
        endTurn(state, "skipped", ctx, out);
        break;
      case "buzzed":
        toAppeal(state, [], ctx, out);
        break;
      case "appeal":
        dropBuzz(state, ctx, out);
        break;
      default:
        break;
    }
    return done(state, out);
  },

  getPublicState(state) {
    const t = state.turn;
    const team = (id: TeamId): PublicTeam => ({
      id,
      name: TEAM_NAMES[id],
      members: members(state.players, id).map((p) => p.id),
      score: state.scores[id],
      captainId: captainOf(state.players, id),
    });
    const frozen = state.phase === "buzzed" || state.phase === "appeal";
    const playing = state.phase !== "teams";
    return {
      phase: state.phase,
      teams: [team(0), team(1)],
      players: state.players.map((p) => ({ id: p.id, team: p.team, removed: p.removed })),
      turnNumber: state.turnIndex,
      totalTurns: totalTurns(state),
      suddenDeath: state.suddenDeath,
      activeTeam: playing && t ? t.team : null,
      describerId: playing && t ? t.describerId : null,
      deadline: state.deadline,
      phaseMs: state.phaseMs,
      turnMs: turnMs(state),
      turnLeft: frozen && t ? t.turnLeft : null,
      buzzerId: t?.buzzerId ?? null,
      captainId: t?.captainId ?? null,
      cards: t ? t.cards.map((c) => ({ ...c })) : [],
      net: t?.net ?? 0,
      reshuffled: state.reshuffled,
      endReason: state.endReason,
    };
  },

  getPrivateState(state, playerId) {
    const p = find(state, playerId);
    if (!p || p.removed) return { team: null, role: null, card: null, canBuzz: false, deciding: false };
    const t = state.turn;
    const live = t && state.phase !== "teams" && state.phase !== "finished";
    const role: Role | null = !live ? null : t.describerId === playerId ? "describer" : p.team === t.team ? "guesser" : "watcher";
    const card = live && role !== "guesser" && CARD_UP.includes(state.phase) ? currentCard(state) : null;
    return {
      team: p.team,
      role,
      card: card ? { target: card.target, forbidden: [...card.forbidden] } : null,
      canBuzz: state.phase === "turn" && role === "watcher",
      deciding: (state.phase === "buzzed" && role === "describer") || (state.phase === "appeal" && t?.captainId === playerId),
    };
  },

  getAwaitedPlayerIds: awaited,

  getResult(state) {
    if (state.phase !== "finished") return null;
    const [a, b] = state.scores;
    const lead: TeamId[] = a === b ? (state.endReason === "abandoned" ? [] : [0, 1]) : [a > b ? 0 : 1];
    const pts = (n: number) => `${n} ${n === 1 ? "point" : "points"}`;
    return {
      winnerIds: state.players.filter((p) => active(p) && lead.includes(p.team)).map((p) => p.id),
      standings: [...state.players]
        .sort((x, y) => Number(x.removed) - Number(y.removed) || state.scores[y.team] - state.scores[x.team] || x.team - y.team || x.seat - y.seat)
        .map((p) => ({
          playerId: p.id,
          value: state.scores[p.team],
          label: `${TEAM_NAMES[p.team]}, ${pts(state.scores[p.team])}${p.removed ? ", left" : ""}`,
        })),
    };
  },

  carryOver(state): DontSayItCarry {
    return {
      teams: [members(state.players, 0).map((p) => p.id), members(state.players, 1).map((p) => p.id)],
      used: usedIds(state),
    };
  },
};
