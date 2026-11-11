import { seededRandomInt, type GameContext } from "@games/game-core";
import { describe, expect, it } from "vitest";
import { releaseOrder, treasureHuntGame as th, type THState } from "../server/game.ts";
import { macroHeight } from "../shared/generate.ts";
import type { THAction, THSettings } from "../shared/types.ts";
import { RACE_OPEN_START, REVEAL_RADIUS } from "../shared/world.ts";

const ctx = (now = 1000, seed = 7): GameContext => ({ now, randomInt: seededRandomInt(seed), hostId: "p0" });
const players = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}` }));
const RACE: THSettings = { mode: "race", minutes: 30, time: "day", target: 3, map: "new" };

function act(s: THState, id: string, action: THAction, now = 1000): THState {
  const r = th.handleAction(s, id, action, ctx(now));
  if (!r.ok) throw new Error(r.error.code);
  return r.transition.state;
}

function lobby(seed = 7): THState {
  let s = th.createGame(players(3), RACE, { roundNumber: 1, dealerSeat: 0 }, ctx(1000, seed)).state;
  return act(s, "p1", { type: "team.join", teamId: 1 });
}

/** Orange (team 1) is p0 + p1, Green (team 3) is p2. Hunting at t = 10 000. */
function hunting(seed = 7): THState {
  let s = lobby(seed);
  for (const id of ["p0", "p1", "p2"]) s = act(s, id, { type: "ready" });
  s = act(s, "p0", { type: "start" }, 2000);
  return th.onTimer!(s, "countdown", ctx(10_000)).state;
}

const cacheOf = (s: THState, id: string) => s.caches.find((c) => c.id === id)!;
const openIds = (s: THState, pid: string) => th.getPrivateState(s, pid).clues.map((c) => c.id);

function standOn(s: THState, pid: string, cid: string, now: number) {
  const c = cacheOf(s, cid);
  return th.onStream!(s, pid, { t: "pos", x: c.x, y: macroHeight(s.layout, c.x, c.z) + c.dy, z: c.z, foot: true }, ctx(now))!;
}

function claim(s: THState, pid: string, cid: string, now: number) {
  return th.handleAction(standOn(s, pid, cid, now).state, pid, { type: "claim", cacheId: cid }, ctx(now));
}

function claimOk(s: THState, pid: string, cid: string, now: number) {
  const r = claim(s, pid, cid, now);
  if (!r.ok) throw new Error(r.error.code);
  return r.transition;
}

describe("race to N", () => {
  it("3 open at start, 4 after the first claim, same list for every team", () => {
    // Nothing shows in the teams phase.
    expect(th.getPrivateState(lobby(), "p0").clues).toEqual([]);
    let s = hunting();
    const order = releaseOrder(s.caches, s.layout.seed);
    expect(openIds(s, "p0")).toEqual(order.slice(0, RACE_OPEN_START));
    expect(openIds(s, "p2")).toEqual(openIds(s, "p0"));
    // The HUD reads found of target.
    expect(th.getPublicState(s).teams.map((t) => t.poolSize)).toEqual([3, 3]);

    s = claimOk(s, "p2", order[1]!, 11_000).state;
    expect(openIds(s, "p0")).toEqual(order.slice(0, RACE_OPEN_START + 1));
    expect(openIds(s, "p2")).toEqual(openIds(s, "p0"));
    // The claimed cache stays on the list: found for Green, taken for Orange.
    const mine = th.getPrivateState(s, "p2").clues.find((c) => c.id === order[1]);
    const theirs = th.getPrivateState(s, "p0").clues.find((c) => c.id === order[1]);
    expect(mine).toMatchObject({ found: true, taken: false });
    expect(theirs).toMatchObject({ found: false, taken: true });
    expect(th.getPrivateState(s, "p0").clues.filter((c) => c.found || c.taken)).toHaveLength(1);
  });

  it("second team's claim on a taken cache is refused", () => {
    let s = hunting();
    const order = releaseOrder(s.caches, s.layout.seed);
    const [a, b] = order as [string, string];
    // Not open yet.
    const early = claim(s, "p0", order[RACE_OPEN_START + 1]!, 11_000);
    expect(early.ok ? "ok" : early.error.code).toBe("not-yours");

    s = claimOk(s, "p0", a, 14_000).state;
    const taken = claim(s, "p2", a, 15_000);
    expect(taken.ok ? null : taken.error).toEqual({ code: "taken", message: "Another team found this cache first." });
    const mine = claim(s, "p1", a, 15_000);
    expect(mine.ok ? "ok" : mine.error.code).toBe("already-found");

    // A claimed cache is never revealed again, to anyone.
    const c = cacheOf(s, a);
    const near = th.onStream!(s, "p2", { t: "pos", x: c.x + 1, y: 10, z: c.z, foot: true }, ctx(20_000))!;
    expect((near.relays ?? []).some((r) => (r.data as { id: string }).id === a)).toBe(false);

    // Each team gets its own reveal of the same open cache.
    const cb = cacheOf(s, b);
    const pos = { t: "pos", x: cb.x + REVEAL_RADIUS - 1, y: 10, z: cb.z, foot: true };
    const g = th.onStream!(s, "p2", pos, ctx(30_000))!;
    expect((g.relays ?? []).filter((r) => (r.data as { id: string }).id === b).map((r) => r.to)).toEqual([["p2"]]);
    const o = th.onStream!(g.state, "p1", pos, ctx(30_000))!;
    expect((o.relays ?? []).filter((r) => (r.data as { id: string }).id === b).map((r) => r.to)).toEqual([["p0", "p1"]]);
    s = o.state;
    expect(th.getPrivateState(s, "p0").revealed.map((r) => r.id)).toContain(b);
    expect(th.getPrivateState(s, "p2").revealed.map((r) => r.id)).toContain(b);
  });

  it("first team to target wins at once", () => {
    let s = hunting();
    const order = releaseOrder(s.caches, s.layout.seed);
    s = claimOk(s, "p0", order[0]!, 11_000).state;
    s = claimOk(s, "p2", order[1]!, 11_000).state;
    s = claimOk(s, "p1", order[2]!, 12_000).state;
    expect(s.phase).toBe("hunting");
    const t = claimOk(s, "p0", order[3]!, 15_000);
    expect(t.state.phase).toBe("finished");
    expect(t.events.map((e) => e.event)).toEqual([{ type: "claimed", playerId: "p0", foundCount: 3 }, { type: "ended" }]);
    expect(t.timers).toContainEqual({ kind: "cancel", timerId: "round" });
    const result = th.getResult!(t.state)!;
    expect(result.headline).toBe("Team Orange wins");
    expect(result.winnerIds).toEqual(["p0", "p1"]);
    expect(result.standings.map((r) => r.label)).toEqual(["3 found · Orange", "3 found · Orange", "1 found · Green"]);
  });

  it("release order is the same for the same seed", () => {
    const a = hunting(7);
    const b = hunting(7);
    expect(a.layout.seed).toBe(b.layout.seed);
    const order = releaseOrder(a.caches, a.layout.seed);
    expect(order).toEqual(releaseOrder(b.caches, b.layout.seed));
    expect(openIds(a, "p0")).toEqual(openIds(b, "p0"));
    // A shuffle of every cache, not the caches in id order.
    expect([...order].sort()).toEqual(a.caches.map((c) => c.id).sort());
    expect(order).not.toEqual(a.caches.map((c) => c.id));
  });
});
