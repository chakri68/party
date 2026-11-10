import { seededRandomInt, type GameContext } from "@games/game-core";
import { describe, expect, it } from "vitest";
import { dealPools, treasureHuntGame as th, type THState } from "../server/game.ts";
import { macroHeight } from "../shared/generate.ts";
import { DEFAULT_SETTINGS, type THAction } from "../shared/types.ts";
import { REVEAL_RADIUS } from "../shared/world.ts";

const ctx = (now = 1000): GameContext => ({ now, randomInt: seededRandomInt(7), hostId: "p0" });
const players = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}` }));

function act(s: THState, id: string, action: THAction, now = 1000): THState {
  const r = th.handleAction(s, id, action, ctx(now));
  if (!r.ok) throw new Error(r.error.code);
  return r.transition.state;
}

/**
 * Orange (team 1) is p0 + p1, Green (team 3) is p2. With `spectator`, p3 joins
 * Orange but never says ready, so it watches. Hunting at t = 10 000.
 */
function hunting(spectator = false): THState {
  let s = th.createGame(players(spectator ? 4 : 3), DEFAULT_SETTINGS, { roundNumber: 1, dealerSeat: 0 }, ctx()).state;
  s = act(s, "p1", { type: "team.join", teamId: 1 });
  if (spectator) s = act(s, "p3", { type: "team.join", teamId: 1 });
  for (const id of ["p0", "p1", "p2"]) s = act(s, id, { type: "ready" });
  s = act(s, "p0", { type: "start" }, 2000);
  return th.onTimer!(s, "countdown", ctx(10_000)).state;
}

const team = (s: THState, id: number) => s.teams.find((t) => t.id === id)!;
const cacheOf = (s: THState, id: string) => s.caches.find((c) => c.id === id)!;
const r1 = (v: number) => Math.round(v * 10) / 10;

function standOn(s: THState, pid: string, cid: string, now: number): THState {
  const c = cacheOf(s, cid);
  return th.onStream!(s, pid, { t: "pos", x: c.x, y: macroHeight(s.layout, c.x, c.z) + c.dy, z: c.z, foot: true }, ctx(now))!.state;
}

describe("timed mode by team", () => {
  it("a teammate's reveal reaches the whole team", () => {
    let s = hunting(true);
    const cid = team(s, 1).pool[0]!;
    const c = cacheOf(s, cid);
    const near = th.onStream!(s, "p1", { t: "pos", x: c.x + REVEAL_RADIUS - 1, y: 10, z: c.z, foot: true }, ctx(11_000))!;
    const mine = (near.relays ?? []).filter((r) => (r.data as { id: string }).id === cid);
    // The spectator (p3) watches, so it gets the reveal too.
    expect(mine).toEqual([{ to: ["p0", "p1", "p3"], data: { t: "reveal", id: cid, x: r1(c.x), z: r1(c.z), dy: c.dy } }]);
    s = near.state;
    expect(team(s, 1).revealed).toContain(cid);
    // Recorded on the team: p0 walking up later reveals nothing new.
    const again = th.onStream!(s, "p0", { t: "pos", x: c.x, y: 10, z: c.z, foot: true }, ctx(11_100))!;
    expect((again.relays ?? []).some((r) => (r.data as { id: string }).id === cid)).toBe(false);
    for (const id of ["p0", "p1", "p3"]) {
      expect(th.getPrivateState(s, id).revealed).toContainEqual({ id: cid, x: r1(c.x), z: r1(c.z), dy: c.dy });
    }
    expect(th.getPrivateState(s, "p2").revealed.some((r) => r.id === cid)).toBe(false);
    // The spectator sees the team's board, read-only.
    expect(th.getPrivateState(s, "p3")).toEqual(th.getPrivateState(s, "p0"));
    expect(th.getPrivateState(s, "p0")).toMatchObject({ teamId: 1, pins: [] });
  });

  it("no clues before the hunt starts: a lobby team switch shows nothing", () => {
    let s = th.createGame(players(4), DEFAULT_SETTINGS, { roundNumber: 1, dealerSeat: 0 }, ctx()).state;
    s = act(s, "p1", { type: "team.join", teamId: 1 });
    s = act(s, "p3", { type: "team.join", teamId: 3 });
    // p1 peeks at Green in the lobby, then goes back to Orange.
    s = act(s, "p1", { type: "team.join", teamId: 3 });
    expect(s.teams.every((t) => t.pool.length === 0)).toBe(true);
    expect(th.getPrivateState(s, "p1")).toEqual({ teamId: 3, clues: [], revealed: [], pins: [] });
    expect(th.getPublicState(s).teams.every((t) => t.poolSize === 0)).toBe(true);
    s = act(s, "p1", { type: "team.join", teamId: 1 });
    for (const id of ["p0", "p1", "p2", "p3"]) s = act(s, id, { type: "ready" });
    s = act(s, "p0", { type: "start" }, 2000);
    const board = th.getPrivateState(s, "p1").clues.map((c) => c.id);
    expect(board).toEqual(team(s, 1).pool);
    expect(board.length).toBeGreaterThan(0);
    expect(board.some((id) => team(s, 3).pool.includes(id))).toBe(false);
  });

  it("a spectator's claim gets not-yours", () => {
    const s = hunting(true);
    const cid = team(s, 1).pool[0]!;
    const r = th.handleAction(s, "p3", { type: "claim", cacheId: cid }, ctx(11_000));
    expect(r.ok ? "ok" : r.error.code).toBe("not-yours");
  });

  it("either teammate can claim; foundCount is the team's", () => {
    let s = hunting();
    const [a, b] = team(s, 1).pool as [string, string];
    s = standOn(s, "p0", a, 11_000);
    let r = th.handleAction(s, "p0", { type: "claim", cacheId: a }, ctx(11_000));
    if (!r.ok) throw new Error(r.error.code);
    expect(r.transition.events.map((e) => e.event)).toEqual([{ type: "claimed", playerId: "p0", foundCount: 1 }]);
    s = r.transition.state;
    s = standOn(s, "p1", b, 12_000);
    r = th.handleAction(s, "p1", { type: "claim", cacheId: b }, ctx(12_000));
    if (!r.ok) throw new Error(r.error.code);
    expect(r.transition.events.map((e) => e.event)).toEqual([{ type: "claimed", playerId: "p1", foundCount: 2 }]);
    s = r.transition.state;
    expect(team(s, 1).found).toEqual([a, b]);
    expect(team(s, 1).lastClaimAt).toBe(12_000);
    expect(th.getPublicState(s).teams.find((t) => t.id === 1)).toMatchObject({ foundCount: 2, poolSize: team(s, 1).pool.length });
    expect(th.getPublicState(s).teams.find((t) => t.id === 3)).toMatchObject({ foundCount: 0 });
    // p1 can't claim what p0 already found; Green can't claim Orange's cache.
    s = standOn(s, "p1", a, 13_000);
    const again = th.handleAction(s, "p1", { type: "claim", cacheId: a }, ctx(13_000));
    expect(again.ok ? "ok" : again.error.code).toBe("already-found");
    s = standOn(s, "p2", a, 13_000);
    const theirs = th.handleAction(s, "p2", { type: "claim", cacheId: a }, ctx(13_000));
    expect(theirs.ok ? "ok" : theirs.error.code).toBe("not-yours");
    const board = th.getPrivateState(s, "p1").clues;
    expect(board.filter((c) => c.found).map((c) => c.id)).toEqual([a, b]);
    expect(board.every((c) => c.taken === false)).toBe(true);
  });

  it("two teams get pools of the same size and difficulty total within 1", () => {
    const s = hunting(true);
    const [p1, p3] = [team(s, 1).pool, team(s, 3).pool];
    expect(p1.length).toBeGreaterThan(0);
    expect(p1.length).toBe(p3.length);
    expect(new Set([...p1, ...p3]).size).toBe(p1.length * 2);
    const total = (pool: string[]) => pool.reduce((t, id) => t + cacheOf(s, id).difficulty, 0);
    expect(Math.abs(total(p1) - total(p3))).toBeLessThanOrEqual(1);
    expect(dealPools(s.caches, [1, 3])).toEqual({ 1: p1, 3: p3 });

    // A team of spectators only gets no pool, and doesn't shrink the others.
    let t = th.createGame(players(3), DEFAULT_SETTINGS, { roundNumber: 1, dealerSeat: 0 }, ctx()).state;
    for (const id of ["p0", "p1"]) t = act(t, id, { type: "ready" });
    t = act(t, "p0", { type: "start" }, 2000);
    expect(team(t, 3).pool).toEqual([]);
    expect(team(t, 1).pool.length).toBe(team(t, 2).pool.length);
    expect(th.getPublicState(t).teams.find((x) => x.id === 3)).toMatchObject({ foundCount: 0, poolSize: 0 });
  });

  it("team win headline and winnerIds", () => {
    const s = hunting(true);
    // Four caches of one difficulty, so only the counts and times differ.
    const d = [1, 2, 3].find((x) => s.caches.filter((c) => c.difficulty === x).length >= 4)!;
    const ones = s.caches.filter((c) => c.difficulty === d).map((c) => c.id);
    Object.assign(team(s, 1), { found: [ones[0]!, ones[1]!], lastClaimAt: 500 });
    Object.assign(team(s, 3), { found: [ones[2]!], lastClaimAt: 100 });
    s.phase = "finished";
    let r = th.getResult(s)!;
    expect(r.headline).toBe("Team Orange wins");
    // Hunters only: the spectator (p3) watched.
    expect(r.winnerIds).toEqual(["p0", "p1"]);
    expect(r.standings).toEqual([
      { playerId: "p0", value: 2, label: "2 found · Orange" },
      { playerId: "p1", value: 2, label: "2 found · Orange" },
      { playerId: "p2", value: 1, label: "1 found · Green" },
    ]);

    // Level on all three keys: a tie, every tied member wins.
    Object.assign(team(s, 3), { found: [ones[2]!, ones[3]!], lastClaimAt: 500 });
    r = th.getResult(s)!;
    expect(r.headline).toBe("It's a tie.");
    expect(r.winnerIds).toEqual(["p0", "p1", "p2"]);

    // Green's only hunter left mid-round: Green stays in, with what it found.
    const gone = th.onPlayerRemoved!({ ...s, phase: "hunting" }, "p2", ctx(20_000)).state;
    gone.phase = "finished";
    expect(th.getResult(gone)!.standings.map((x) => x.playerId)).toEqual(["p0", "p1", "p2"]);

    for (const t of s.teams) Object.assign(t, { found: [], lastClaimAt: null });
    r = th.getResult(s)!;
    expect(r.headline).toBe("Nobody found a cache.");
    expect(r.winnerIds).toEqual([]);
  });
});
