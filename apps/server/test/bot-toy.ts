// Test-only games for the room's computer players.
//
// `toyGame`, "count to 10": seats take turns adding 1 or 2. Whoever reaches 10
// wins, and a short "call" window opens with nobody awaited; anyone may `call`
// (an optional move) until the window timer ends the game. `plainGame` is the
// same game without a bot, for the "this game can't have computers" paths.

import { bumpStat, type AnyGameDefinition, type BotContext, type BotView, type PartyStats } from "@games/game-core";

export const TOY_TARGET = 10;
export const TOY_WINDOW_MS = 5_000;

export interface ToyState {
  players: string[];
  total: number;
  turn: number;
  phase: "count" | "window" | "done";
  winner: string | null;
  callers: string[];
  stats: PartyStats;
}

export interface ToyPublic {
  total: number;
  turnId: string | null;
  phase: ToyState["phase"];
  winner: string | null;
  callers: string[];
}

export interface ToyPrivate {
  me: string;
}

/** `hold`: keep the turn without counting. Only the "hog" bot uses it. */
export type ToyAction = { type: "add"; n: number } | { type: "call" } | { type: "hold" };

/**
 * How the toy's bot behaves, set per test (reset it in `beforeEach`). Anything
 * but "normal" only changes the bot's own turn; outside it, it plays normally.
 * - "null": nothing to do. "throw": `decide` throws. "illegal": adds 3.
 * - "hog": keeps the turn forever with `hold`.
 * - "bad-call": plays its turns normally, but in the call window sends an `add`, which is refused.
 * - "shy": plays its turns normally, but never calls in the window.
 * - "throw-off-turn": plays its turns normally; asked off its turn, it throws.
 */
export const toyKnobs: {
  decide: "normal" | "null" | "throw" | "illegal" | "hog" | "bad-call" | "shy" | "throw-off-turn";
} = { decide: "normal" };

const err = (code: string, message: string) => ({ ok: false as const, error: { code, message } });
const ok = (state: ToyState, timers?: { kind: "set"; timerId: string; delayMs: number }[]) => ({
  ok: true as const,
  transition: { state, events: [{ visibility: { kind: "public" as const }, event: { type: "moved", total: state.total } }], ...(timers && { timers }) },
});

function decide(view: BotView<ToyPublic, ToyPrivate>, ctx: BotContext): ToyAction | null {
  const pub = view.public;
  const myTurn = pub.phase === "count" && pub.turnId === view.playerId;
  if (myTurn) {
    switch (toyKnobs.decide) {
      case "null":
        return null;
      case "throw":
        throw new Error("toy bot broke");
      case "illegal":
        return { type: "add", n: 3 };
      case "hog":
        return { type: "hold" };
      case "normal":
      case "bad-call":
      case "shy":
      case "throw-off-turn":
        return { type: "add", n: 1 + ctx.randomInt(2) };
    }
  }
  if (toyKnobs.decide === "throw-off-turn") throw new Error("toy bot broke off its turn");
  if (pub.phase === "window" && !pub.callers.includes(view.playerId)) {
    if (toyKnobs.decide === "shy") return null;
    return toyKnobs.decide === "bad-call" ? { type: "add", n: 1 } : { type: "call" };
  }
  return null;
}

function makeToy(id: string, name: string, withBot: boolean): AnyGameDefinition {
  return {
    manifest: { id, name, description: "", minPlayers: 2, maxPlayers: 4, icon: "cards" },
    defaultSettings: {},
    parseSettings: (s: unknown) => (s && typeof s === "object" ? {} : null),
    parseAction: (a: unknown): ToyAction | null => {
      if (!a || typeof a !== "object") return null;
      const t = (a as { type?: unknown }).type;
      if (t === "call" || t === "hold") return { type: t };
      const n = (a as { n?: unknown }).n;
      return t === "add" && typeof n === "number" ? { type: "add", n } : null;
    },
    createGame: (players, _settings, match) => ({
      state: {
        players: players.map((p) => p.id),
        total: 0,
        turn: match.dealerSeat % players.length,
        phase: "count",
        winner: null,
        callers: [],
        stats: {},
      } satisfies ToyState,
      events: [],
    }),
    handleAction: (st: ToyState, pid: string, a: ToyAction) => {
      if (a.type === "call") {
        if (st.phase !== "window") return err("wrong-phase", "Nothing to call now.");
        if (st.callers.includes(pid)) return err("already-called", "You already called.");
        const next = structuredClone(st);
        if (!next.callers.length) bumpStat((next.stats ??= {}), pid, "firstGuesses");
        next.callers.push(pid);
        return ok(next);
      }
      if (st.phase !== "count" || st.players[st.turn] !== pid) return err("not-your-turn", "It is not your turn.");
      if (a.type === "hold") return ok(structuredClone(st));
      if (a.n !== 1 && a.n !== 2) return err("bad-add", "Add 1 or 2.");
      const next = structuredClone(st);
      next.total += a.n;
      if (next.total >= TOY_TARGET) {
        next.phase = "window";
        next.winner = pid;
        return ok(next, [{ kind: "set", timerId: "window", delayMs: TOY_WINDOW_MS }]);
      }
      next.turn = (next.turn + 1) % next.players.length;
      return ok(next);
    },
    onTimer: (st: ToyState, timerId: string) =>
      timerId === "window" && st.phase === "window" ? { state: { ...st, phase: "done" as const }, events: [] } : { state: st, events: [] },
    skipTurn: (st: ToyState, pid: string) => {
      if (st.phase !== "count" || st.players[st.turn] !== pid) return { state: st, events: [] };
      return {
        state: { ...st, turn: (st.turn + 1) % st.players.length },
        events: [{ visibility: { kind: "public" as const }, event: { type: "skipped", playerId: pid } }],
      };
    },
    onPlayerRemoved: (st: ToyState, pid: string) =>
      st.phase === "count" && st.players[st.turn] === pid
        ? { state: { ...st, turn: (st.turn + 1) % st.players.length }, events: [] }
        : { state: st, events: [] },
    getPublicState: (st: ToyState): ToyPublic => ({
      total: st.total,
      turnId: st.phase === "count" ? st.players[st.turn]! : null,
      phase: st.phase,
      winner: st.winner,
      callers: st.callers,
    }),
    getPrivateState: (_st: ToyState, pid: string): ToyPrivate => ({ me: pid }),
    getAwaitedPlayerIds: (st: ToyState) => (st.phase === "count" ? [st.players[st.turn]!] : []),
    getResult: (st: ToyState) =>
      st.phase === "done" && st.winner
        ? {
            winnerIds: [st.winner],
            standings: st.players.map((p) => ({ playerId: p, value: p === st.winner ? 0 : 1 })),
          }
        : null,
    partyStats: (st: ToyState) => st.stats ?? {},
    ...(withBot && { bot: { decide } }),
  } as AnyGameDefinition;
}

export const toyGame = makeToy("toy", "Toy", true);
export const plainGame = makeToy("plain", "Plain", false);
