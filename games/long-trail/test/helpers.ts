import { seededRandomInt, type GameContext, type GameTransition } from "@games/game-core";
import { expect } from "vitest";
import { longTrailGame as g } from "../server/game.ts";
import { DEFAULT_SETTINGS, type LongTrailEvent, type LongTrailServerState, type LongTrailSettings, type Vote } from "../shared/types.ts";

export { g };
export type S = LongTrailServerState;
export type T = GameTransition<S, LongTrailEvent>;

export const HOST = "p0";
export const ctx = (now = 0, seed = 1): GameContext => ({ now, randomInt: seededRandomInt(seed), hostId: HOST });
export const players = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}` }));

/** A game of n players, still in the reveal. */
export function start(n: number, settings: Partial<LongTrailSettings> = {}, seed = 1): T {
  return g.createGame(players(n), { ...DEFAULT_SETTINGS, ...settings }, { roundNumber: 1, dealerSeat: 0 }, ctx(0, seed));
}

/** By default a second before the deadline. */
export const act = (s: S, playerId: string, action: unknown, now = s.deadline - 1000, seed = 1) =>
  g.handleAction(s, playerId, g.parseAction(action)!, ctx(now, seed));

export function ok(result: ReturnType<typeof act>): T {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}: ${result.error.message}`);
  return result.transition as T;
}

export function err(result: ReturnType<typeof act>): string {
  if (result.ok) throw new Error("expected a rejection");
  return result.error.code;
}

export const ring = (s: S, seed = 1): T => g.onTimer!(s, "phase", ctx(s.deadline, seed));
export const ids = (s: S) => s.players.filter((p) => !p.left).map((p) => p.id);
export const leaderId = (s: S) => s.players[s.leader]!.id;

/** Everyone taps Got it. */
export function toPlan(s: S): S {
  for (const id of ids(s)) s = ok(act(s, id, { type: "ack" })).state;
  expect(s.phase).toBe("plan");
  return s;
}

/** The leader proposes the open plan as it stands. */
export const proposeOpen = (s: S): S => ok(act(s, leaderId(s), { type: "propose", plan: g.getPublicState(s).openPlan })).state;

/** Everyone votes `vote` unless named in `except`. Stops once the vote closes. */
export function voteAll(s: S, vote: Vote, except: Record<string, Vote> = {}): T {
  let t: T = { state: s, events: [] };
  for (const id of ids(s)) {
    if (t.state.phase !== "vote") break;
    t = ok(act(t.state, id, { type: "vote", vote: except[id] ?? vote }));
  }
  return t;
}

export function chooseAll(s: S, option: 0 | 1): T {
  let t: T = { state: s, events: [] };
  for (const id of ids(s)) {
    if (t.state.phase !== "choice") break;
    t = ok(act(t.state, id, { type: "choose", option }));
  }
  return t;
}

/** Everyone taps Next in the summary or the recap. */
export function nextAll(s: S): T {
  const phase = s.phase;
  let t: T = { state: s, events: [] };
  for (const id of ids(s)) {
    if (t.state.phase !== phase) break;
    t = ok(act(t.state, id, { type: "next" }));
  }
  return t;
}

/** Propose the open plan, all Go, settle any choice with 0, tap Next. */
export function playDay(s: S): S {
  expect(s.phase).toBe("plan");
  s = proposeOpen(s);
  s = voteAll(s, "go").state;
  if (s.phase === "choice") s = chooseAll(s, 0).state;
  expect(s.phase).toBe("summary");
  return nextAll(s).state;
}
