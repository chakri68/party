import { seededRandomInt, type GameContext } from "@games/game-core";
import { describe, expect, it } from "vitest";
import { dealPools, treasureHuntGame as th, type THState } from "../server/game.ts";
import { macroHeight } from "../shared/generate.ts";
import { CLAIM_CHECK, COUNTDOWN_MS, HEIGHT_TOL, JUMP_GRACE_MS, MAX_SPEED, POS_STALE_MS, REVEAL_RADIUS } from "../shared/world.ts";

const ctx = (now = 1000): GameContext => ({ now, randomInt: seededRandomInt(7), hostId: "p0" });
const players = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}` }));

/** n players, everyone ready, past the countdown: hunting at t = 10 000. */
function hunting(n = 2, minutes: 15 | 30 | 60 = 30): THState {
  let s = th.createGame(players(n), { minutes }, { roundNumber: 1, dealerSeat: 0 }, ctx()).state;
  for (let i = 0; i < n; i++) {
    const r = th.handleAction(s, `p${i}`, { type: "ready" }, ctx(2000));
    if (!r.ok) throw new Error(r.error.code);
    s = r.transition.state;
  }
  return th.onTimer!(s, "countdown", ctx(10_000)).state;
}

const me = (s: THState, id: string) => s.players.find((p) => p.id === id)!;
const cacheOf = (s: THState, id: string) => s.caches.find((c) => c.id === id)!;
const groundAt = (s: THState, id: string) => {
  const c = cacheOf(s, id);
  return macroHeight(s.layout, c.x, c.z) + c.dy;
};

/** Stream a position; returns the new state (or the old one if dropped). */
function pos(s: THState, id: string, x: number, y: number, z: number, now: number, foot = true) {
  return th.onStream!(s, id, { t: "pos", x, y, z, foot }, ctx(now));
}

/** Stand on cache `cid` at `now`. */
function standOn(s: THState, pid: string, cid: string, now: number, foot = true): THState {
  const c = cacheOf(s, cid);
  return pos(s, pid, c.x, groundAt(s, cid), c.z, now, foot)!.state;
}

function claim(s: THState, pid: string, cacheId: string, now: number) {
  return th.handleAction(s, pid, { type: "claim", cacheId }, ctx(now));
}
const code = (r: ReturnType<typeof claim>) => (r.ok ? "ok" : r.error.code);

describe("pools", () => {
  it("8 players and 20 caches: pools of 2, no overlap, difficulty totals within 1", () => {
    const { caches } = hunting(1);
    const twenty = caches.slice(0, 20);
    const ids = players(8).map((p) => p.id);
    const pools = dealPools(twenty, ids);
    expect(Object.keys(pools)).toEqual(ids);
    const all = ids.flatMap((id) => pools[id]!);
    expect(ids.every((id) => pools[id]!.length === 2)).toBe(true);
    expect(new Set(all).size).toBe(16);
    const diff = (cid: string) => twenty.find((c) => c.id === cid)!.difficulty;
    const totals = ids.map((id) => pools[id]!.reduce((t, c) => t + diff(c), 0));
    expect(Math.max(...totals) - Math.min(...totals)).toBeLessThanOrEqual(1);
  });

  it("caps pools at 8, and a solo pool keeps the map's mix", () => {
    const s = hunting(1);
    const pool = me(s, "p0").pool;
    expect(pool.length).toBe(8);
    const ds = new Set(pool.map((id) => cacheOf(s, id).difficulty));
    expect(ds.size).toBeGreaterThan(1);
  });

  it("deals again at the countdown: spectators get nothing", () => {
    let s = th.createGame(players(3), { minutes: 30 }, { roundNumber: 1, dealerSeat: 0 }, ctx()).state;
    expect(s.players.every((p) => p.pool.length > 0)).toBe(true);
    s = (th.handleAction(s, "p0", { type: "ready" }, ctx()) as { ok: true; transition: { state: THState } }).transition.state;
    s = th.onTimer!(s, "ready-timeout", ctx(5000)).state;
    expect(s.phase).toBe("countdown");
    expect(me(s, "p1").spectator).toBe(true);
    expect(me(s, "p1").pool).toEqual([]);
    expect(me(s, "p2").pool).toEqual([]);
    expect(me(s, "p0").pool.length).toBe(Math.min(8, s.caches.length));
  });
});

describe("reveal", () => {
  it("relays a near cache to its owner only, once, and keeps it in private state", () => {
    let s = hunting(2);
    const cid = me(s, "p0").pool[0]!;
    const c = cacheOf(s, cid);
    // Far away first: nothing.
    const far = pos(s, "p0", c.x + REVEAL_RADIUS + 5, 10, c.z, 11_000)!;
    expect(far.relays ?? []).toEqual([]);
    expect(far.persist).toBe(false);
    s = far.state;
    const near = pos(s, "p0", c.x + REVEAL_RADIUS - 1, 10, c.z, 12_000)!;
    const mine = (near.relays ?? []).filter((r) => (r.data as { id: string }).id === cid);
    expect(mine).toEqual([{ to: ["p0"], data: { t: "reveal", id: cid, x: Math.round(c.x * 10) / 10, z: Math.round(c.z * 10) / 10, dy: c.dy } }]);
    expect(near.persist).not.toBe(false);
    s = near.state;
    // Once only.
    const again = pos(s, "p0", c.x + REVEAL_RADIUS - 2, 10, c.z, 12_500)!;
    expect((again.relays ?? []).some((r) => (r.data as { id: string }).id === cid)).toBe(false);
    s = again.state;
    expect(th.getPrivateState(s, "p0").revealed).toContainEqual({ id: cid, x: Math.round(c.x * 10) / 10, z: Math.round(c.z * 10) / 10, dy: c.dy });
    expect(th.getPrivateState(s, "p1").revealed.some((r) => r.id === cid)).toBe(false);
  });

  it("p1 standing on p0's cache reveals nothing to anyone", () => {
    const s = hunting(2);
    const cid = me(s, "p0").pool[0]!;
    const c = cacheOf(s, cid);
    const r = pos(s, "p1", c.x, 10, c.z, 11_000)!;
    for (const x of r.relays ?? []) {
      expect(x.to).toEqual(["p1"]);
      expect(me(s, "p1").pool).toContain((x.data as { id: string }).id);
    }
  });

  it("drops pos outside countdown and hunting, from removed players, and junk", () => {
    const gen = th.createGame(players(1), { minutes: 30 }, { roundNumber: 1, dealerSeat: 0 }, ctx()).state;
    expect(pos(gen, "p0", 0, 0, 0, 2000)).toBeNull();
    const s = hunting(2);
    expect(th.onStream!(s, "p0", { t: "pos", x: "1", y: 0, z: 0, foot: true }, ctx(11_000))).toBeNull();
    expect(th.onStream!(s, "p0", { t: "pos", x: NaN, y: 0, z: 0, foot: true }, ctx(11_000))).toBeNull();
    expect(th.onStream!(s, "p0", { t: "nope" }, ctx(11_000))).toBeNull();
    expect(th.onStream!(s, "zz", { t: "pos", x: 0, y: 0, z: 0, foot: true }, ctx(11_000))).toBeNull();
    const gone = th.onPlayerRemoved!(s, "p1", ctx(11_000)).state;
    expect(pos(gone, "p1", 0, 0, 0, 11_500)).toBeNull();
  });

  it("accepts pos in the countdown", () => {
    const s = th.createGame(players(1), { minutes: 30 }, { roundNumber: 1, dealerSeat: 0 }, ctx()).state;
    const r = th.handleAction(s, "p0", { type: "ready" }, ctx(2000));
    if (!r.ok) throw new Error();
    expect(r.transition.state.phase).toBe("countdown");
    const p = pos(r.transition.state, "p0", 1, 2, 3, 2500)!;
    expect(me(p.state, "p0").pos).toEqual({ x: 1, y: 2, z: 3, foot: true, at: 2500 });
  });
});

describe("claim", () => {
  it("each check has its own code, in order", () => {
    // not-hunting: still in the countdown.
    let pre = th.createGame(players(1), { minutes: 30 }, { roundNumber: 1, dealerSeat: 0 }, ctx()).state;
    const r0 = th.handleAction(pre, "p0", { type: "ready" }, ctx(2000));
    if (!r0.ok) throw new Error();
    pre = r0.transition.state;
    expect(code(claim(pre, "p0", me(pre, "p0").pool[0]!, 2500))).toBe("not-hunting");

    let s = hunting(2);
    const mine = me(s, "p0").pool[0]!;
    const theirs = me(s, "p1").pool[0]!;
    const c = cacheOf(s, mine);
    // not-yours: someone else's cache, and an id that doesn't exist.
    expect(code(claim(standOn(s, "p0", theirs, 11_000), "p0", theirs, 11_000))).toBe("not-yours");
    expect(code(claim(s, "p0", "c999", 11_000))).toBe("not-yours");
    // no-position: never sent one.
    expect(code(claim(s, "p0", mine, 11_000))).toBe("no-position");
    // no-position: too old.
    s = standOn(s, "p0", mine, 11_000);
    expect(code(claim(s, "p0", mine, 11_000 + POS_STALE_MS + 1))).toBe("no-position");
    // in-vehicle.
    expect(code(claim(standOn(s, "p0", mine, 12_000, false), "p0", mine, 12_000))).toBe("in-vehicle");
    // too-far: XZ.
    const xz = pos(s, "p0", c.x + CLAIM_CHECK + 0.5, groundAt(s, mine), c.z, 12_000)!.state;
    expect(code(claim(xz, "p0", mine, 12_000))).toBe("too-far");
    // too-far: height.
    const high = pos(s, "p0", c.x, groundAt(s, mine) + HEIGHT_TOL + 5, c.z, 12_000)!.state;
    expect(code(claim(high, "p0", mine, 12_000))).toBe("too-far");
    // moved-too-fast.
    const jumped = { ...s, players: s.players.map((p) => (p.id === "p0" ? { ...p, jumpAt: 11_500 } : p)) };
    expect(code(claim(jumped, "p0", mine, 12_000))).toBe("moved-too-fast");
    // ok, then already-found.
    const won = claim(s, "p0", mine, 12_000);
    expect(code(won)).toBe("ok");
    if (!won.ok) throw new Error();
    expect(code(claim(won.transition.state, "p0", mine, 12_100))).toBe("already-found");
  });

  it("a legal claim records the find and emits claimed", () => {
    let s = hunting(2);
    const cid = me(s, "p0").pool[0]!;
    s = standOn(s, "p0", cid, 11_000);
    const r = claim(s, "p0", cid, 11_200);
    if (!r.ok) throw new Error(r.error.code);
    const t = r.transition;
    expect(me(t.state, "p0").found).toEqual([cid]);
    expect(me(t.state, "p0").lastClaimAt).toBe(11_200);
    expect(t.events.map((e) => e.event)).toEqual([{ type: "claimed", playerId: "p0", foundCount: 1 }]);
    expect(t.state.phase).toBe("hunting");
    expect(th.getPrivateState(t.state, "p0").clues.find((c) => c.id === cid)!.found).toBe(true);
    expect(th.getPublicState(t.state).players.find((p) => p.id === "p0")).toMatchObject({ foundCount: 1, poolSize: me(s, "p0").pool.length });
  });

  it("a 300 m jump in 0.25 s blocks claims for 5 s", () => {
    let s = hunting(1);
    const cid = me(s, "p0").pool[0]!;
    const c = cacheOf(s, cid);
    s = pos(s, "p0", c.x + 300, groundAt(s, cid), c.z, 20_000)!.state;
    expect(me(s, "p0").jumpAt).toBeLessThan(20_000);
    s = standOn(s, "p0", cid, 20_250);
    expect(me(s, "p0").jumpAt).toBe(20_250);
    expect(code(claim(s, "p0", cid, 20_300))).toBe("moved-too-fast");
    s = standOn(s, "p0", cid, 20_250 + JUMP_GRACE_MS - 500);
    expect(code(claim(s, "p0", cid, 20_250 + JUMP_GRACE_MS - 1))).toBe("moved-too-fast");
    s = standOn(s, "p0", cid, 20_250 + JUMP_GRACE_MS);
    expect(code(claim(s, "p0", cid, 20_250 + JUMP_GRACE_MS))).toBe("ok");
  });

  it("buggy speed does not count as a jump; a gap over 2 s never does", () => {
    let s = hunting(1);
    s = pos(s, "p0", 0, 10, 0, 20_000)!.state;
    s = pos(s, "p0", (MAX_SPEED - 1) / 4, 10, 0, 20_250)!.state;
    expect(me(s, "p0").jumpAt).toBeLessThan(20_000);
    s = pos(s, "p0", 500, 10, 0, 22_500)!.state;
    expect(me(s, "p0").jumpAt).toBeLessThan(20_000);
  });

  it("clearing your pool ends the round when everyone is done", () => {
    let s = hunting(1);
    const pool = me(s, "p0").pool;
    let now = 20_000;
    for (const [i, cid] of pool.entries()) {
      s = standOn(s, "p0", cid, now);
      const r = claim(s, "p0", cid, now);
      if (!r.ok) throw new Error(r.error.code);
      s = r.transition.state;
      const types = r.transition.events.map((e) => e.event.type);
      if (i < pool.length - 1) {
        expect(s.phase).toBe("hunting");
        expect(types).toEqual(["claimed"]);
      } else {
        expect(s.phase).toBe("finished");
        expect(types).toEqual(["claimed", "ended"]);
        expect(r.transition.timers).toContainEqual({ kind: "cancel", timerId: "round" });
      }
      now += 10_000;
    }
    expect(th.getResult(s)).toMatchObject({ winnerIds: ["p0"], standings: [{ playerId: "p0", value: pool.length, label: `${pool.length} found` }] });
  });

  it("a player removed mid-hunt drops out of the all-done check", () => {
    let s = hunting(2);
    const pool = me(s, "p0").pool;
    let now = 20_000;
    for (const cid of pool) {
      s = standOn(s, "p0", cid, now);
      const r = claim(s, "p0", cid, now);
      if (!r.ok) throw new Error(r.error.code);
      s = r.transition.state;
      now += 10_000;
    }
    expect(s.phase).toBe("hunting");
    const t = th.onPlayerRemoved!(s, "p1", ctx(now));
    expect(t.state.phase).toBe("finished");
    expect(t.events.map((e) => e.event.type)).toEqual(["player-removed", "ended"]);
  });
});

describe("timed round", () => {
  it("runs generating → countdown → hunting → finished with the right timers", () => {
    let t = th.createGame(players(1), { minutes: 15 }, { roundNumber: 1, dealerSeat: 0 }, ctx());
    expect(t.state.phase).toBe("generating");
    const r = th.handleAction(t.state, "p0", { type: "ready" }, ctx(2000));
    if (!r.ok) throw new Error();
    t = r.transition;
    expect(t.state.phase).toBe("countdown");
    expect(t.timers).toEqual([
      { kind: "cancel", timerId: "ready-timeout" },
      { kind: "set", timerId: "countdown", delayMs: COUNTDOWN_MS },
    ]);
    expect(t.events.map((e) => e.event)).toEqual([{ type: "countdown", spectators: [] }]);
    expect(th.getPublicState(t.state).countdownEndsAt).toBe(2000 + COUNTDOWN_MS);
    expect(th.getPublicState(t.state).endsAt).toBeNull();
    // A stray round timer does nothing yet.
    expect(th.onTimer!(t.state, "round", ctx(2100)).state.phase).toBe("countdown");

    t = th.onTimer!(t.state, "countdown", ctx(5000));
    expect(t.state.phase).toBe("hunting");
    expect(t.state.startedAt).toBe(5000);
    expect(t.timers).toEqual([{ kind: "set", timerId: "round", delayMs: 15 * 60_000 }]);
    expect(t.events.map((e) => e.event.type)).toEqual(["hunt-start"]);
    expect(th.getPublicState(t.state).endsAt).toBe(5000 + 15 * 60_000);

    t = th.onTimer!(t.state, "round", ctx(5000 + 15 * 60_000));
    expect(t.state.phase).toBe("finished");
    expect(t.events.map((e) => e.event.type)).toEqual(["ended"]);
    expect(th.getResult(t.state)).toEqual({ winnerIds: [], standings: [{ playerId: "p0", value: 0, label: "0 found" }], headline: "Nobody found a cache." });
  });

  it("uses the minutes setting for the round timer", () => {
    for (const m of [30, 60] as const) {
      let s = th.createGame(players(1), { minutes: m }, { roundNumber: 1, dealerSeat: 0 }, ctx()).state;
      const r = th.handleAction(s, "p0", { type: "ready" }, ctx());
      if (!r.ok) throw new Error();
      s = r.transition.state;
      expect(th.onTimer!(s, "countdown", ctx()).timers).toEqual([{ kind: "set", timerId: "round", delayMs: m * 60_000 }]);
    }
  });

  it("result order uses found count, then difficulty, then the earlier last claim", () => {
    const s = hunting(5);
    // Craft the finds directly: the order is what's under test here.
    const of = (d: number) => s.caches.filter((c) => c.difficulty === d).map((c) => c.id);
    const [d1, d2, d3] = [of(1), of(2), of(3)];
    expect(d1.length >= 3 && d2.length >= 3 && d3.length >= 1).toBe(true);
    const set = (id: string, found: string[], lastClaimAt: number | null) => Object.assign(me(s, id), { found, lastClaimAt });
    set("p0", [d1[0]!], 100); // 1 found
    set("p1", [d1[1]!, d3[0]!], 300); // 2 found, difficulty 4, later
    set("p2", [d1[2]!, d2[0]!], 50); // 2 found, difficulty 3
    set("p3", [d2[1]!, d2[2]!], 200); // 2 found, difficulty 4, earlier
    set("p4", [], null);
    s.phase = "finished";
    const r = th.getResult(s)!;
    expect(r.standings.map((x) => x.playerId)).toEqual(["p3", "p1", "p2", "p0", "p4"]);
    expect(r.standings.map((x) => x.label)).toEqual(["2 found", "2 found", "2 found", "1 found", "0 found"]);
    expect(r.standings.map((x) => x.value)).toEqual([2, 2, 2, 1, 0]);
    expect(r.winnerIds).toEqual(["p3"]);
    expect(r.headline).toBeUndefined();
  });

  it("winners are everyone level on all three keys", () => {
    const s = hunting(3);
    const [a, b] = s.caches.filter((c) => c.difficulty === 1).map((c) => c.id);
    me(s, "p0").found = [a!];
    me(s, "p0").lastClaimAt = 500;
    me(s, "p1").found = [b!];
    me(s, "p1").lastClaimAt = 500;
    s.phase = "finished";
    const r = th.getResult(s)!;
    expect(r.winnerIds.sort()).toEqual(["p0", "p1"]);
    expect(r.standings.map((x) => x.playerId)).toEqual(["p0", "p1", "p2"]);
  });
});

describe("secrecy", () => {
  it("public state never holds a cache's x, in any phase", () => {
    let s = hunting(3);
    const cid = me(s, "p0").pool[0]!;
    s = standOn(s, "p0", cid, 11_000);
    const r = claim(s, "p0", cid, 11_000);
    if (!r.ok) throw new Error(r.error.code);
    s = r.transition.state;
    for (const st of [s, { ...s, phase: "finished" as const }]) {
      // The layout is public by design, and a cache at a piece's centre shares
      // that piece's x. So: the layout is the generated one, untouched, and
      // nothing else in the public state holds a cache x.
      const { layout, ...rest } = th.getPublicState(st);
      expect(layout).toBe(st.layout);
      const json = JSON.stringify(rest);
      const numbers = new Set((json.match(/-?\d+(?:\.\d+)?(?:e[-+]?\d+)?/gi) ?? []).map(Number));
      for (const c of st.caches) expect(numbers.has(c.x)).toBe(false);
      expect(json).not.toContain('"pool"');
      expect(json).not.toContain('"pos"');
      expect(json).not.toContain("clues");
    }
  });

  it("private state covers only that player's pool", () => {
    const s = hunting(2);
    const priv = th.getPrivateState(s, "p0");
    expect(priv.clues.map((c) => c.id)).toEqual(me(s, "p0").pool);
    for (const c of priv.clues) {
      const cache = cacheOf(s, c.id);
      expect(c).toEqual({ id: c.id, clues: cache.clues, difficulty: cache.difficulty, found: false });
    }
    expect(priv.revealed).toEqual([]);
    expect(th.getPrivateState(s, "nobody")).toEqual({ clues: [], revealed: [] });
  });
});
