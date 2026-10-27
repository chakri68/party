import { seededRandomInt, type GameContext, type GameTransition } from "@games/game-core";
import { expect } from "vitest";
import { nightfallGame as g } from "../server/game.ts";
import type { RoleId } from "../shared/roles.ts";
import { DEFAULT_SETTINGS, type NightfallEvent, type NightfallServerState, type NightfallSettings } from "../shared/types.ts";

export { g };
export type S = NightfallServerState;
export type T = GameTransition<S, NightfallEvent>;

export const HOST = "p0";
export const ctx = (now = 0, seed = 1): GameContext => ({ now, randomInt: seededRandomInt(seed), hostId: HOST });
export const players = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}` }));

/** A game with these cards in seat order: p0 gets cards[0], and so on. */
export function start(cards: RoleId[], settings: Partial<Pick<NightfallSettings, "discussMinutes" | "nightSeconds">> = {}, seed = 1): T {
  return g.createGame(players(cards.length), { ...DEFAULT_SETTINGS, ...settings }, { roundNumber: 1, dealerSeat: 0 }, ctx(0, seed), { deck: cards });
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
export const leave = (s: S, id: string): T => g.onPlayerRemoved!(s, id, ctx(Math.max(0, s.deadline - 1000)));
export const types = (t: { events: { event: { type: string } }[] }) => t.events.map((e) => e.event.type);
export const alive = (s: S) => s.players.filter((p) => !p.dead && !p.left).map((p) => p.id);

export function toNight(s: S): S {
  for (const id of alive(s)) s = ok(act(s, id, { type: "ack" })).state;
  expect(s.phase).toBe("night");
  return s;
}

/** Sends these night picks, then lets the night run out. */
export function night(s: S, picks: Record<string, string> = {}): T {
  expect(s.phase).toBe("night");
  for (const [id, target] of Object.entries(picks)) s = ok(act(s, id, { type: "pick", target })).state;
  return ring(s);
}

/** From the day: host calls the vote. */
export function toVote(s: S): S {
  expect(s.phase).toBe("day");
  s = ok(act(s, HOST, { type: "next" })).state;
  expect(s.phase).toBe("vote");
  return s;
}

/** Everyone in `votes` votes; returns the last transition. */
export function vote(s: S, votes: Record<string, string>): T {
  let t: T = { state: s, events: [] };
  for (const [id, choice] of Object.entries(votes)) t = ok(act(t.state, id, { type: "vote", choice }));
  return t;
}
