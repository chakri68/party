import { seededRandomInt, type GameContext, type GameTransition } from "@games/game-core";
import { expect } from "vitest";
import { heistGame as g } from "../server/game.ts";
import { type Alignment, type Card, DEFAULT_SETTINGS, type HeistEvent, type HeistServerState, type HeistSettings, type Vote } from "../shared/types.ts";

export { g };
export type S = HeistServerState;
export type T = GameTransition<S, HeistEvent>;

export const HOST = "p0";
export const ctx = (now = 0, seed = 1): GameContext => ({ now, randomInt: seededRandomInt(seed), hostId: HOST });
export const players = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}` }));

/** "m" for mole, anything else crew, in seat order. */
export const deal = (pattern: string): Alignment[] => [...pattern].map((c) => (c === "m" ? "mole" : "crew"));

/** A game with these alignments in seat order and p0 leading first. */
export function start(pattern: string, settings: Partial<HeistSettings> = {}, seed = 1): T {
  const t = g.createGame(players(pattern.length), { ...DEFAULT_SETTINGS, ...settings }, { roundNumber: 1, dealerSeat: 0 }, ctx(0, seed), {
    deck: deal(pattern),
  });
  t.state.leader = 0;
  return t;
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
export const types = (t: { events: { event: { type: string } }[] }) => t.events.map((e) => e.event.type);
export const ids = (s: S) => s.players.filter((p) => !p.left).map((p) => p.id);
export const leaderId = (s: S) => s.players[s.leader]!.id;
export const size = (s: S) => g.getPublicState(s).sizes[s.job]!;

export function toPropose(s: S): S {
  for (const id of ids(s)) s = ok(act(s, id, { type: "ack" })).state;
  expect(s.phase).toBe("propose");
  return s;
}

export const propose = (s: S, crew: string[]): S => ok(act(s, leaderId(s), { type: "propose", crew })).state;

/** Everyone votes `vote` unless named in `except`. */
export function voteAll(s: S, vote: Vote, except: Record<string, Vote> = {}): T {
  let t: T = { state: s, events: [] };
  for (const id of ids(s)) t = ok(act(t.state, id, { type: "vote", vote: except[id] ?? vote }));
  return t;
}

/** Crew plays the cards given (Clean otherwise), then the clock ends the job. */
export function playJob(s: S, cards: Record<string, Card> = {}): T {
  expect(s.phase).toBe("job");
  for (const id of s.crew) s = ok(act(s, id, { type: "card", card: cards[id] ?? "clean" })).state;
  return ring(s);
}

/** Propose the first `size` seats from `from`, pass it, play it. */
export function runJob(s: S, crew: string[], cards: Record<string, Card> = {}): T {
  s = propose(s, crew);
  s = voteAll(s, "go").state;
  return playJob(s, cards);
}
