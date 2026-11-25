import { shuffle, type GameContext, type GameDefinition, type GameError, type GameResult } from "@games/game-core";
import { buildDeck } from "../shared/cards.ts";
import { notMyProblemManifest } from "../shared/manifest.ts";
import {
  DEFAULT_SETTINGS,
  HAND_SIZE,
  PROBLEM_KINDS,
  REACTION_SECONDS_OPTIONS,
  type ActionCard,
  type ActionKind,
  type NmpAction,
  type NmpEvent,
  type NmpPrivateState,
  type NmpPublicState,
  type NmpSettings,
  type PileCard,
  type ProblemCard,
  type ProblemKind,
  type Step,
} from "../shared/types.ts";
import { acceptProblem, fixProblem, problemTimeout } from "./problem.ts";
import { getAwaitedPlayerIds, getPrivateState, getPublicState, getResult } from "./projection.ts";
import { challenge, closeReport, fakeReport, reportPass } from "./report.ts";
import { alive, clone, done, newOut, playerById, spend, timerId, type Out, type ServerPlayer, type State } from "./state.ts";
import { blame, hrComplaint, hrPass, resolveTransfer, respondToTransfer } from "./transfer.ts";
import { beginDraw, playProactive, startTurn } from "./turn.ts";

type Result = GameResult<State, NmpEvent>;

const reject = (code: string, message: string): Result => ({ ok: false, error: { code, message } });
const fail = (error: GameError): Result => ({ ok: false, error });

/** Test-only deck: hands by seat, then the pile top first. Never reachable from client input. */
interface TestDeck {
  hands: ActionKind[][];
  pile: (ActionKind | ProblemKind)[];
}

const isProblemKind = (k: string): k is ProblemKind => (PROBLEM_KINDS as readonly string[]).includes(k);

/** Ids `${kind}-${k}`, counted per kind in the order given. */
function testDeal(deck: TestDeck, n: number): { hands: ActionCard[][]; pile: PileCard[] } {
  if (deck.hands.length !== n) throw new Error(`not-my-problem: test deck has ${deck.hands.length} hands for ${n} players`);
  const seen: Record<string, number> = {};
  const make = (kind: ActionKind | ProblemKind): PileCard => {
    const k = (seen[kind] = (seen[kind] ?? 0) + 1);
    return isProblemKind(kind) ? ({ id: `${kind}-${k}`, kind } as ProblemCard) : ({ id: `${kind}-${k}`, kind } as ActionCard);
  };
  const hands = deck.hands.map((h) => h.map((kind) => make(kind) as ActionCard));
  return { hands, pile: deck.pile.map(make) };
}

/** Each player gets one Quick Fix and four more. The rest, with the Problems, makes the pile. */
function deal(n: number, ctx: GameContext): { hands: ActionCard[][]; pile: PileCard[] } {
  const { actions, problems } = buildDeck(n);
  const rest = shuffle(actions, ctx.randomInt);
  const hands = Array.from({ length: n }, () => {
    // Quick Fix has n + 2 copies, so every hand finds one.
    const at = rest.findIndex((c) => c.kind === "quick-fix");
    if (at < 0) throw new Error("not-my-problem: no Quick Fix left to deal");
    const fix = rest.splice(at, 1);
    return [...fix, ...rest.splice(0, HAND_SIZE - 1)];
  });
  return { hands, pile: shuffle([...rest, ...problems], ctx.randomInt) };
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function parseSettings(input: unknown): NmpSettings | null {
  if (input === undefined || input === null) return { ...DEFAULT_SETTINGS };
  if (typeof input !== "object" || Array.isArray(input)) return null;
  const s = { ...DEFAULT_SETTINGS, ...(input as Partial<NmpSettings>) };
  return (REACTION_SECONDS_OPTIONS as readonly unknown[]).includes(s.reactionSeconds)
    ? { reactionSeconds: s.reactionSeconds }
    : null;
}

const isId = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 64;

function parseAction(input: unknown): NmpAction | null {
  if (typeof input !== "object" || input === null) return null;
  const a = input as Record<string, unknown>;
  if (!Number.isInteger(a.token)) return null;
  const token = a.token as number;
  switch (a.type) {
    case "draw":
    case "accept":
    case "challenge":
    case "pass":
      return { type: a.type, token };
    case "fix":
    case "not-me":
    case "hr":
      return isId(a.cardId) ? { type: a.type, token, cardId: a.cardId } : null;
    case "blame":
    case "revenge":
      return isId(a.cardId) && isId(a.targetId) ? { type: a.type, token, cardId: a.cardId, targetId: a.targetId } : null;
    case "fake-report":
      return isId(a.cardId) && isId(a.faceDownId) ? { type: a.type, token, cardId: a.cardId, faceDownId: a.faceDownId } : null;
    case "play":
      if (!isId(a.cardId)) return null;
      if (a.targetId === undefined) return { type: "play", token, cardId: a.cardId };
      return isId(a.targetId) ? { type: "play", token, cardId: a.cardId, targetId: a.targetId } : null;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/** Runs `apply` on a clone. An error from it throws the clone away. */
function run(prev: State, apply: (s: State, out: Out) => GameError | null | void): Result {
  const state = clone(prev);
  const out = newOut();
  const error = apply(state, out);
  return error ? fail(error) : { ok: true, transition: done(state, out) };
}

function cardIn(p: ServerPlayer, cardId: string): ActionCard | undefined {
  return p.hand.find((c) => c.id === cardId);
}

function handleAction(prev: State, playerId: string, action: NmpAction, ctx: GameContext): Result {
  if (prev.step === "finished") return reject("game-finished", "The game is over.");
  const me = playerById(prev, playerId);
  if (!me || !alive(me)) return reject("not-in-game", "You are not in this game.");
  if (action.token !== prev.token) return reject("too-late", "Too late.");

  switch (action.type) {
    case "play": {
      if (!cardIn(me, action.cardId)) return reject("card-not-owned", "You don't have that card.");
      return run(prev, (s, out) => {
        const p = playerById(s, playerId)!;
        return playProactive(s, out, p, cardIn(p, action.cardId)!, action.targetId, ctx);
      });
    }
    case "draw": {
      if (prev.step !== "action") return reject("wrong-time", "You can't draw now.");
      if (prev.players[prev.turnIndex]!.id !== playerId) return reject("not-your-turn", "It's not your turn.");
      return run(prev, (s, out) => beginDraw(s, out, ctx));
    }
    case "fix": {
      if (prev.step !== "problem") return reject("wrong-time", "You can't play that card now.");
      if (prev.problem?.ownerId !== playerId) return reject("not-your-problem", "This is not your Problem.");
      const card = cardIn(me, action.cardId);
      if (!card) return reject("card-not-owned", "You don't have that card.");
      if (card.kind !== "quick-fix") return reject("wrong-card", "Only a Quick Fix can fix it.");
      return run(prev, (s, out) => {
        spend(s, playerById(s, playerId)!, card);
        fixProblem(s, out, "quick-fix", ctx);
      });
    }
    case "accept": {
      if (prev.step === "target") return run(prev, (s, out) => respondToTransfer(s, out, playerById(s, playerId)!, { kind: "accept" }, ctx));
      if (prev.step !== "problem") return reject("wrong-time", "You can't do that now.");
      if (prev.problem?.ownerId !== playerId) return reject("not-your-problem", "This is not your Problem.");
      return run(prev, (s, out) => acceptProblem(s, out, ctx));
    }
    case "blame":
    case "not-me":
    case "revenge":
    case "hr": {
      if (!cardIn(me, action.cardId)) return reject("card-not-owned", "You don't have that card.");
      return run(prev, (s, out) => {
        const p = playerById(s, playerId)!;
        const card = cardIn(p, action.cardId)!;
        switch (action.type) {
          case "blame":
            return blame(s, out, p, card, action.targetId, ctx);
          case "not-me":
            return respondToTransfer(s, out, p, { kind: "not-me", card }, ctx);
          case "revenge":
            return respondToTransfer(s, out, p, { kind: "revenge", card, targetId: action.targetId }, ctx);
          case "hr":
            return hrComplaint(s, out, p, card, ctx);
        }
      });
    }
    case "pass": {
      if (prev.step === "hr") return run(prev, (s, out) => hrPass(s, out, playerId, ctx));
      if (prev.step === "challenge") return run(prev, (s, out) => reportPass(s, out, playerId, ctx));
      return reject("wrong-time", "You can't pass now.");
    }
    case "fake-report": {
      if (!cardIn(me, action.cardId) || !cardIn(me, action.faceDownId)) return reject("card-not-owned", "You don't have that card.");
      return run(prev, (s, out) => {
        const p = playerById(s, playerId)!;
        return fakeReport(s, out, p, cardIn(p, action.cardId)!, cardIn(p, action.faceDownId)!, ctx);
      });
    }
    case "challenge":
      return run(prev, (s, out) => challenge(s, out, playerById(s, playerId)!, ctx));
  }
}

// ---------------------------------------------------------------------------
// Definition
// ---------------------------------------------------------------------------

/** Steps whose timer moves play on. */
const TIMED_STEPS: readonly Step[] = ["action", "problem", "target", "hr", "challenge"];

export const notMyProblemGame: GameDefinition<State, NmpAction, NmpPublicState, NmpPrivateState, NmpSettings, NmpEvent> = {
  manifest: notMyProblemManifest,
  defaultSettings: DEFAULT_SETTINGS,
  parseSettings,
  parseAction,

  createGame(players, settings, match, ctx, options) {
    const n = players.length;
    const { minPlayers, maxPlayers } = notMyProblemManifest;
    if (n < minPlayers || n > maxPlayers) throw new Error(`not-my-problem: needs ${minPlayers}-${maxPlayers} players, got ${n}`);
    const { hands, pile } = options?.deck ? testDeal(options.deck as unknown as TestDeck, n) : deal(n, ctx);
    const first = (((match.dealerSeat + 1) % n) + n) % n;
    const state: State = {
      settings,
      players: players.map((p, i) => ({
        id: p.id, hand: hands[i]!, warnings: 0, shield: null, overtime: false,
        fired: false, firedOrder: null, removed: false, away: false,
      })),
      drawPile: pile,
      discard: [],
      hiddenDiscard: [],
      resolvedProblems: [],
      step: "action",
      token: 0,
      round: 1,
      firstSeat: first,
      turnIndex: first,
      actionsLeft: 0,
      drawsLeft: 0,
      turnOver: false,
      problem: null,
      moves: [],
      report: null,
      passed: [],
      deadline: null,
      windowMs: null,
      pausedLeftMs: null,
      firedCount: 0,
      lastEvent: null,
      winnerIds: [],
      stats: {},
    };
    const out = newOut();
    startTurn(state, out, ctx.now);
    return done(state, out);
  },

  handleAction,

  onTimer(prev, id, ctx) {
    if (id !== timerId(prev.token) || !TIMED_STEPS.includes(prev.step)) return { state: prev, events: [] };
    const state = clone(prev);
    const out = newOut();
    if (state.step === "action") beginDraw(state, out, ctx);
    else if (state.step === "problem") problemTimeout(state, out, ctx);
    else if (state.step === "target") {
      // No answer in time means Accept.
      const blameMove = state.moves[0];
      if (blameMove?.kind !== "blame") throw new Error(`not-my-problem: bad transfer stack ${state.moves.map((m) => m.kind).join(",")}`);
      const error = respondToTransfer(state, out, playerById(state, blameMove.targetId)!, { kind: "accept" }, ctx);
      if (error) throw new Error(`not-my-problem: target timeout refused: ${error.code}`);
    } else if (state.step === "hr") resolveTransfer(state, out, false, ctx);
    else closeReport(state, out, ctx);
    return done(state, out);
  },

  getPublicState,
  getPrivateState,
  getAwaitedPlayerIds,
  getResult,

  partyStats(state) {
    return state.stats ?? {};
  },
};
