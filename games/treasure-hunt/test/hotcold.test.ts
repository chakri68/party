import { seededRandomInt, type GameContext } from "@games/game-core";
import { describe, expect, it } from "vitest";
import { treasureHuntGame as th, type THState } from "../server/game.ts";
import { macroHeight } from "../shared/generate.ts";
import { DEFAULT_SETTINGS, type THAction, type THSettings } from "../shared/types.ts";
import { HOTCOLD_MS, HOTCOLD_RACE_UNLOCK_MS, JUMP_GRACE_MS, hotColdLevel } from "../shared/world.ts";

const ctx = (now = 1000): GameContext => ({ now, randomInt: seededRandomInt(7), hostId: "p0" });
const players = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}` }));
const TIMED: THSettings = { ...DEFAULT_SETTINGS, mode: "timed", minutes: 30 };
const RACE: THSettings = { ...DEFAULT_SETTINGS, mode: "race", target: 3 };
const T0 = 10_000;

function act(s: THState, id: string, action: THAction, now = 1000): THState {
  const r = th.handleAction(s, id, action, ctx(now));
  if (!r.ok) throw new Error(r.error.code);
  return r.transition.state;
}
const code = (s: THState, id: string, action: THAction, now: number) => {
  const r = th.handleAction(s, id, action, ctx(now));
  return r.ok ? "ok" : r.error.code;
};

/** p0 + p1 on team 1, p2 on its own team. Hunting at T0. */
function hunting(settings: THSettings = TIMED): THState {
  let s = th.createGame(players(3), settings, { roundNumber: 1, dealerSeat: 0 }, ctx()).state;
  s = act(s, "p1", { type: "team.join", teamId: 1 });
  for (const p of s.players) s = act(s, p.id, { type: "ready" });
  s = act(s, "p0", { type: "start" }, 2000);
  return th.onTimer!(s, "countdown", ctx(T0)).state;
}

const teamOf = (s: THState, pid: string) => s.teams.find((t) => t.id === s.players.find((p) => p.id === pid)!.teamId)!;
const boardOf = (s: THState, pid: string) => th.getPrivateState(s, pid).clues.map((c) => c.id);
const cache = (s: THState, id: string) => s.caches.find((c) => c.id === id)!;
const HALF = 15 * 60_000;

/** Stand on a cache, then claim it. */
function claim(s: THState, pid: string, cid: string, now: number) {
  const c = cache(s, cid);
  const st = th.onStream!(s, pid, { t: "pos", x: c.x, y: macroHeight(s.layout, c.x, c.z) + c.dy, z: c.z, foot: true }, ctx(now))!.state;
  const r = th.handleAction(st, pid, { type: "claim", cacheId: cid }, ctx(now));
  if (!r.ok) throw new Error(r.error.code);
  return r.transition;
}

/** Stream a player `d` metres east of a cache. */
function at(s: THState, pid: string, cid: string, d: number, now: number) {
  const c = cache(s, cid);
  return th.onStream!(s, pid, { t: "pos", x: c.x + d, y: 0, z: c.z, foot: true }, ctx(now))!;
}
const hot = (r: ReturnType<typeof at>) => (r.relays ?? []).filter((x) => (x.data as { t: string }).t === "hotcold");

describe("hotColdLevel", () => {
  it("bands", () => {
    const got = [0, 49.9, 50, 149, 150, 299, 300, 5000].map(hotColdLevel);
    expect(got).toEqual([3, 3, 2, 2, 1, 1, 0, 0]);
  });
});

describe("hot or cold: unlock", () => {
  it("timed: opens at the halfway point", () => {
    const s = hunting();
    const id = boardOf(s, "p0")[0]!;
    expect(code(s, "p0", { type: "hotcold", cacheId: id }, T0 + HALF - 1000)).toBe("hotcold-locked");
    expect(code(s, "p0", { type: "hotcold", cacheId: id }, T0 + HALF)).toBe("ok");
    expect(th.getPrivateState(s, "p0").hotcold.unlockAt).toBe(T0 + HALF);
  });

  it("race: opens at 10 minutes", () => {
    const s = hunting(RACE);
    const id = boardOf(s, "p0")[0]!;
    expect(code(s, "p0", { type: "hotcold", cacheId: id }, T0 + HOTCOLD_RACE_UNLOCK_MS - 1)).toBe("hotcold-locked");
    expect(code(s, "p0", { type: "hotcold", cacheId: id }, T0 + HOTCOLD_RACE_UNLOCK_MS)).toBe("ok");
    expect(th.getPrivateState(s, "p0").hotcold.unlockAt).toBe(T0 + HOTCOLD_RACE_UNLOCK_MS);
  });

  it("unlockAt is null before hunting", () => {
    const s = th.createGame(players(2), TIMED, { roundNumber: 1, dealerSeat: 0 }, ctx()).state;
    expect(th.getPrivateState(s, "p0").hotcold).toEqual({ used: false, unlockAt: null, active: null });
  });
});

describe("hot or cold: rejects", () => {
  const NOW = T0 + HALF;
  it("used: a second use by any member", () => {
    const s0 = hunting();
    const [a, b] = boardOf(s0, "p0");
    const s = act(s0, "p0", { type: "hotcold", cacheId: a! }, NOW);
    expect(code(s, "p1", { type: "hotcold", cacheId: b! }, NOW + 1000)).toBe("hotcold-used");
    expect(code(s, "p0", { type: "hotcold", cacheId: a! }, NOW + 1000)).toBe("hotcold-used");
    expect(th.getPrivateState(s, "p1").hotcold.used).toBe(true);
  });

  it("not-yours: off the board", () => {
    const s = hunting();
    const mine = new Set(boardOf(s, "p0"));
    const other = s.caches.find((c) => !mine.has(c.id))!.id;
    expect(code(s, "p0", { type: "hotcold", cacheId: other }, NOW)).toBe("not-yours");
    expect(code(s, "p0", { type: "hotcold", cacheId: "nope" }, NOW)).toBe("not-yours");
  });

  it("already-found", () => {
    const s = hunting();
    const id = boardOf(s, "p0")[0]!;
    teamOf(s, "p0").found.push(id);
    expect(code(s, "p0", { type: "hotcold", cacheId: id }, NOW)).toBe("already-found");
  });

  it("taken: another team claimed it (race)", () => {
    const s = hunting(RACE);
    const id = boardOf(s, "p0")[0]!;
    teamOf(s, "p2").found.push(id);
    expect(code(s, "p0", { type: "hotcold", cacheId: id }, T0 + HOTCOLD_RACE_UNLOCK_MS)).toBe("taken");
  });

  it("not-hunting outside the hunt", () => {
    const s = th.createGame(players(2), TIMED, { roundNumber: 1, dealerSeat: 0 }, ctx()).state;
    expect(code(s, "p0", { type: "hotcold", cacheId: "x" }, NOW)).toBe("not-hunting");
  });

  it("not-yours for a spectator", () => {
    const s = hunting();
    const id = boardOf(s, "p0")[0]!;
    s.players.find((p) => p.id === "p1")!.spectator = true;
    expect(code(s, "p1", { type: "hotcold", cacheId: id }, NOW)).toBe("not-yours");
  });

  it("parseAction", () => {
    expect(th.parseAction({ type: "hotcold", cacheId: "c1" })).toEqual({ type: "hotcold", cacheId: "c1" });
    expect(th.parseAction({ type: "hotcold" })).toBeNull();
    expect(th.parseAction({ type: "hotcold", cacheId: 5 })).toBeNull();
  });
});

describe("hot or cold: stream", () => {
  const NOW = T0 + HALF;
  function live() {
    const s0 = hunting();
    const id = boardOf(s0, "p0")[0]!;
    return { s: act(s0, "p0", { type: "hotcold", cacheId: id }, NOW), id };
  }

  it("relays to that member only, and only when the level changes", () => {
    const { s, id } = live();
    const a = at(s, "p0", id, 160, NOW + 1000);
    expect(hot(a)).toEqual([{ to: ["p0"], data: { t: "hotcold", id, level: 1 } }]);
    expect(a.persist).toBe(true);
    const b = at(a.state, "p0", id, 155, NOW + 2000);
    expect(hot(b)).toEqual([]);
    const c = at(b.state, "p0", id, 145, NOW + 3000);
    expect(c.persist).toBe(true);
    expect(hot(c)).toEqual([{ to: ["p0"], data: { t: "hotcold", id, level: 2 } }]);
  });

  it("teammates each get their own level; the other team gets none", () => {
    const { s, id } = live();
    const a = at(s, "p0", id, 10, NOW + 1000);
    const b = at(a.state, "p1", id, 400, NOW + 1050);
    const o = at(b.state, "p2", id, 10, NOW + 1100);
    expect(hot(a)).toEqual([{ to: ["p0"], data: { t: "hotcold", id, level: 3 } }]);
    expect(hot(b)).toEqual([{ to: ["p1"], data: { t: "hotcold", id, level: 0 } }]);
    expect(hot(o)).toEqual([]);
    for (const r of [a, b, o]) for (const x of hot(r)) expect(x.to).not.toContain("p2");
  });

  it("nothing inside the jump grace", () => {
    const { s, id } = live();
    const a = at(s, "p0", id, 100, NOW + 1000);
    // 800 m in 100 ms is a jump.
    const j = at(a.state, "p0", id, 900, NOW + 1100);
    expect(hot(j)).toEqual([]);
    expect(hot(at(j.state, "p0", id, 10, NOW + 1100 + JUMP_GRACE_MS - 200))).toEqual([]);
    const after = at(j.state, "p0", id, 10, NOW + 1100 + JUMP_GRACE_MS);
    expect(hot(after).map((x) => (x.data as { level: number }).level)).toEqual([3]);
  });

  it("the action sets a timer for the team", () => {
    const s0 = hunting();
    const id = boardOf(s0, "p0")[0]!;
    const r = th.handleAction(s0, "p0", { type: "hotcold", cacheId: id }, ctx(NOW));
    expect(r.ok && r.transition.timers).toEqual([{ kind: "set", timerId: `hotcold:${teamOf(s0, "p0").id}`, delayMs: HOTCOLD_MS }]);
  });

  it("the signal ends at until, even if nobody streams after", () => {
    const { s, id } = live();
    const a = at(s, "p0", id, 100, NOW + 1000);
    expect(th.getPrivateState(a.state, "p0").hotcold.active).not.toBeNull();
    const fired = th.onTimer!(a.state, `hotcold:${teamOf(s, "p0").id}`, ctx(NOW + HOTCOLD_MS)).state;
    expect(th.getPrivateState(fired, "p0").hotcold).toMatchObject({ used: true, active: null });
    // A stream at or after until also relays nothing.
    expect(hot(at(a.state, "p0", id, 10, NOW + HOTCOLD_MS))).toEqual([]);
  });

  it("the round ending cancels every team's timer", () => {
    const { s } = live();
    const r = th.handleAction(s, "p0", { type: "end" }, ctx(NOW + 1000));
    const timers = r.ok ? r.transition.timers : [];
    for (const t of s.teams) expect(timers).toContainEqual({ kind: "cancel", timerId: `hotcold:${t.id}` });
  });

  it("a team claim ends it", () => {
    const { s, id } = live();
    const a = at(s, "p0", id, 100, NOW + 1000);
    const t = claim(a.state, "p0", id, NOW + 20_000);
    expect(t.timers).toContainEqual({ kind: "cancel", timerId: `hotcold:${teamOf(s, "p0").id}` });
    expect(hot(at(t.state, "p1", id, 10, NOW + 21_000))).toEqual([]);
    expect(th.getPrivateState(t.state, "p1").hotcold).toMatchObject({ used: true, active: null });
  });

  it("another team's claim ends it (race)", () => {
    const s0 = hunting(RACE);
    const id = boardOf(s0, "p0")[0]!;
    const s = act(s0, "p0", { type: "hotcold", cacheId: id }, T0 + HOTCOLD_RACE_UNLOCK_MS);
    const now = T0 + HOTCOLD_RACE_UNLOCK_MS;
    const a = at(s, "p0", id, 100, now + 1000);
    const t = claim(a.state, "p2", id, now + 20_000);
    expect(t.timers).toContainEqual({ kind: "cancel", timerId: `hotcold:${teamOf(s, "p0").id}` });
    expect(hot(at(t.state, "p0", id, 10, now + 21_000))).toEqual([]);
    expect(th.getPrivateState(t.state, "p0").hotcold).toMatchObject({ used: true, active: null });
  });

  it("private active carries the last relayed level", () => {
    const { s, id } = live();
    expect(th.getPrivateState(s, "p0").hotcold.active).toEqual({ id, until: NOW + HOTCOLD_MS, level: null });
    const a = at(s, "p0", id, 100, NOW + 1000);
    expect(th.getPrivateState(a.state, "p0").hotcold.active).toEqual({ id, until: NOW + HOTCOLD_MS, level: 2 });
    const b = at(a.state, "p0", id, 40, NOW + 4000);
    expect(th.getPrivateState(b.state, "p0").hotcold.active!.level).toBe(3);
    // A teammate who has not streamed yet has no level.
    expect(th.getPrivateState(b.state, "p1").hotcold.active!.level).toBeNull();
  });
});
