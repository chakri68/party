import { seededRandomInt, type GameContext } from "@games/game-core";
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../shared/types.ts";
import { dealPools, treasureHuntGame as th, type THState } from "../server/game.ts";
import { macroHeight } from "../shared/generate.ts";
import { CLAIM_CHECK, COUNTDOWN_MS, HEIGHT_TOL, JUMP_GRACE_MS, MAX_SPEED, POS_STALE_MS, REVEAL_RADIUS } from "../shared/world.ts";

const ctx = (now = 1000): GameContext => ({ now, randomInt: seededRandomInt(7), hostId: "p0" });
const players = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}` }));

/** `ids` say ready, then the host (p0) starts: the countdown at `now`. */
function start(s: THState, now: number, ids: string[] = s.players.map((p) => p.id)) {
  for (const id of ids) {
    const r = th.handleAction(s, id, { type: "ready" }, ctx(now));
    if (!r.ok) throw new Error(r.error.code);
    s = r.transition.state;
  }
  const r = th.handleAction(s, "p0", { type: "start" }, ctx(now));
  if (!r.ok) throw new Error(r.error.code);
  return r.transition;
}

/** n players, everyone ready, past the countdown: hunting at t = 10 000. */
function hunting(n = 2, minutes: 15 | 30 | 60 = 30): THState {
  const s = th.createGame(players(n), { ...DEFAULT_SETTINGS, minutes }, { roundNumber: 1, dealerSeat: 0 }, ctx()).state;
  return th.onTimer!(start(s, 2000).state, "countdown", ctx(10_000)).state;
}

const me = (s: THState, id: string) => s.players.find((p) => p.id === id)!;
/** The player's team: pools, finds and reveals live there. */
const team = (s: THState, id: string) => s.teams.find((t) => t.id === me(s, id).teamId)!;
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
  it("8 teams and 20 caches: pools of 2, no overlap, difficulty totals within 1", () => {
    const { caches } = hunting(1);
    const twenty = caches.slice(0, 20);
    const ids = [1, 2, 3, 4, 5, 6, 7, 8];
    const pools = dealPools(twenty, ids);
    expect(Object.keys(pools).map(Number)).toEqual(ids);
    const all = ids.flatMap((id) => pools[id]!);
    expect(ids.every((id) => pools[id]!.length === 2)).toBe(true);
    expect(new Set(all).size).toBe(16);
    const diff = (cid: string) => twenty.find((c) => c.id === cid)!.difficulty;
    const totals = ids.map((id) => pools[id]!.reduce((t, c) => t + diff(c), 0));
    expect(Math.max(...totals) - Math.min(...totals)).toBeLessThanOrEqual(1);
  });

  it("caps pools at 8, and a solo pool keeps the map's mix", () => {
    const s = hunting(1);
    const pool = team(s, "p0").pool;
    expect(pool.length).toBe(8);
    const ds = new Set(pool.map((id) => cacheOf(s, id).difficulty));
    expect(ds.size).toBeGreaterThan(1);
  });

  it("deals at the countdown: spectators' teams get nothing", () => {
    let s = th.createGame(players(3), { ...DEFAULT_SETTINGS, minutes: 30 }, { roundNumber: 1, dealerSeat: 0 }, ctx()).state;
    expect(s.teams.every((t) => t.pool.length === 0)).toBe(true);
    s = start(s, 5000, ["p0"]).state;
    expect(s.phase).toBe("countdown");
    expect(me(s, "p1").spectator).toBe(true);
    expect(team(s, "p1").pool).toEqual([]);
    expect(team(s, "p2").pool).toEqual([]);
    expect(team(s, "p0").pool.length).toBe(Math.min(8, s.caches.length));
  });
});

describe("reveal", () => {
  it("relays a near cache to its owner's team only, once, and keeps it in private state", () => {
    let s = hunting(2);
    const cid = team(s, "p0").pool[0]!;
    const c = cacheOf(s, cid);
    // Far away first: nothing.
    const far = pos(s, "p0", c.x + REVEAL_RADIUS + 5, 10, c.z, 11_000)!;
    expect(far.relays ?? []).toEqual([]);
    expect(far.relay).toBeDefined();
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
    const cid = team(s, "p0").pool[0]!;
    const c = cacheOf(s, cid);
    const r = pos(s, "p1", c.x, 10, c.z, 11_000)!;
    for (const x of r.relays ?? []) {
      expect(x.to).toEqual(["p1"]);
      expect(team(s, "p1").pool).toContain((x.data as { id: string }).id);
    }
  });

  it("drops pos outside countdown and hunting, from removed players, and junk", () => {
    const gen = th.createGame(players(1), { ...DEFAULT_SETTINGS, minutes: 30 }, { roundNumber: 1, dealerSeat: 0 }, ctx()).state;
    expect(pos(gen, "p0", 0, 0, 0, 2000)).toBeNull();
    const s = hunting(2);
    expect(th.onStream!(s, "p0", { t: "pos", x: "1", y: 0, z: 0, foot: true }, ctx(11_000))).toBeNull();
    expect(th.onStream!(s, "p0", { t: "pos", x: NaN, y: 0, z: 0, foot: true }, ctx(11_000))).toBeNull();
    expect(th.onStream!(s, "p0", { t: "nope" }, ctx(11_000))).toBeNull();
    expect(th.onStream!(s, "zz", { t: "pos", x: 0, y: 0, z: 0, foot: true }, ctx(11_000))).toBeNull();
    const gone = th.onPlayerRemoved!(s, "p1", ctx(11_000)).state;
    expect(pos(gone, "p1", 0, 0, 0, 11_500)).toBeNull();
  });

  it("drops pos with any |x|, |y| or |z| over 2000", () => {
    const s = hunting(1);
    for (const [x, y, z] of [[2000.1, 0, 0], [0, -2001, 0], [0, 0, 1e9], [-2500, 0, 0]] as const) {
      expect(th.onStream!(s, "p0", { t: "pos", x, y, z, foot: true }, ctx(11_000))).toBeNull();
    }
    expect(pos(s, "p0", 2000, -2000, 2000, 11_000)).not.toBeNull();
  });

  it("drops pos from a spectator", () => {
    let s = th.createGame(players(2), { ...DEFAULT_SETTINGS, minutes: 30 }, { roundNumber: 1, dealerSeat: 0 }, ctx()).state;
    s = start(s, 5000, ["p0"]).state;
    s = th.onTimer!(s, "countdown", ctx(8000)).state;
    expect(me(s, "p1").spectator).toBe(true);
    expect(pos(s, "p1", 1, 2, 3, 9000)).toBeNull();
  });

  it("a jump reveals nothing, and the reveal comes once the grace is over", () => {
    let s = hunting(1);
    const cid = team(s, "p0").pool[0]!;
    const c = cacheOf(s, cid);
    const ids = (r: { relays?: { data: unknown }[] }) => (r.relays ?? []).map((x) => (x.data as { id: string }).id);
    // Start far from every cache in the pool.
    let far = { x: c.x + 600, z: c.z };
    if (Math.abs(far.x) > 750) far = { x: c.x - 600, z: c.z };
    s = pos(s, "p0", far.x, 10, far.z, 20_000)!.state;
    expect(team(s, "p0").revealed).not.toContain(cid);
    // Teleport onto the cache: flagged as a jump, no reveal.
    const jump = pos(s, "p0", c.x, groundAt(s, cid), c.z, 20_250)!;
    expect(me(jump.state, "p0").jumpAt).toBe(20_250);
    expect(ids(jump)).not.toContain(cid);
    expect(team(jump.state, "p0").revealed).not.toContain(cid);
    s = jump.state;
    // Still inside the grace, standing still: nothing yet.
    const wait = standOn(s, "p0", cid, 20_250 + JUMP_GRACE_MS - 250);
    expect(team(wait, "p0").revealed).not.toContain(cid);
    // Grace over, still nearby: the reveal comes.
    const after = pos(wait, "p0", c.x + 1, groundAt(s, cid), c.z, 20_250 + JUMP_GRACE_MS)!;
    expect(ids(after)).toContain(cid);
    expect(team(after.state, "p0").revealed).toContain(cid);
  });

  it("accepts pos in the countdown", () => {
    const s = th.createGame(players(1), { ...DEFAULT_SETTINGS, minutes: 30 }, { roundNumber: 1, dealerSeat: 0 }, ctx()).state;
    const t = start(s, 2000);
    expect(t.state.phase).toBe("countdown");
    const p = pos(t.state, "p0", 1, 2, 3, 2500)!;
    expect(me(p.state, "p0").pos).toEqual({ x: 1, y: 2, z: 3, foot: true, at: 2500 });
  });
});

describe("claim", () => {
  it("each check has its own code, in order", () => {
    // not-hunting: still in the countdown.
    let pre = th.createGame(players(1), { ...DEFAULT_SETTINGS, minutes: 30 }, { roundNumber: 1, dealerSeat: 0 }, ctx()).state;
    pre = start(pre, 2000).state;
    expect(code(claim(pre, "p0", team(pre, "p0").pool[0]!, 2500))).toBe("not-hunting");

    let s = hunting(2);
    const mine = team(s, "p0").pool[0]!;
    const theirs = team(s, "p1").pool[0]!;
    const c = cacheOf(s, mine);
    // not-yours: someone else's cache, and an id that doesn't exist.
    expect(code(claim(standOn(s, "p0", theirs, 11_000), "p0", theirs, 11_000))).toBe("not-yours");
    expect(code(claim(s, "p0", "c999", 11_000))).toBe("not-yours");
    // no-position: never sent one.
    expect(code(claim(s, "p0", mine, 11_000))).toBe("no-position");
    // no-position: too old.
    s = standOn(s, "p0", mine, 11_000);
    expect(code(claim(s, "p0", mine, 11_000 + POS_STALE_MS + 1))).toBe("no-position");
    // in-vehicle: the server's seat counts, not what the stream says. Seated, streaming foot:true, v:null.
    const seated = { ...s, vehicles: s.vehicles.map((v, i) => (i === 0 ? { ...v, driver: "p0" } : v)) };
    expect(code(claim(standOn(seated, "p0", mine, 12_000), "p0", mine, 12_000))).toBe("in-vehicle");
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
    const cid = team(s, "p0").pool[0]!;
    s = standOn(s, "p0", cid, 11_000);
    const r = claim(s, "p0", cid, 11_200);
    if (!r.ok) throw new Error(r.error.code);
    const t = r.transition;
    expect(team(t.state, "p0").found).toEqual([cid]);
    expect(team(t.state, "p0").lastClaimAt).toBe(11_200);
    expect(t.events.map((e) => e.event)).toEqual([{ type: "claimed", playerId: "p0", foundCount: 1 }]);
    expect(t.state.phase).toBe("hunting");
    expect(th.getPrivateState(t.state, "p0").clues.find((c) => c.id === cid)!.found).toBe(true);
    expect(th.getPublicState(t.state).teams.find((x) => x.id === me(s, "p0").teamId)).toMatchObject({ foundCount: 1, poolSize: team(s, "p0").pool.length });
  });

  it("a 300 m jump in 0.25 s blocks claims for 5 s", () => {
    let s = hunting(1);
    const cid = team(s, "p0").pool[0]!;
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
    const pool = team(s, "p0").pool;
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
    expect(th.getResult(s)).toEqual({
      winnerIds: ["p0"],
      standings: [{ playerId: "p0", value: pool.length, label: `${pool.length} found · Orange` }],
      headline: "Team Orange wins",
    });
  });

  it("a team whose hunters left drops out of the all-done check", () => {
    let s = hunting(2);
    const pool = team(s, "p0").pool;
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
  it("runs teams → countdown → hunting → finished with the right timers", () => {
    let t = th.createGame(players(1), { ...DEFAULT_SETTINGS, minutes: 15 }, { roundNumber: 1, dealerSeat: 0 }, ctx());
    expect(t.state.phase).toBe("teams");
    expect(t.timers).toEqual([]);
    t = start(t.state, 2000);
    expect(t.state.phase).toBe("countdown");
    expect(t.timers).toEqual([{ kind: "set", timerId: "countdown", delayMs: COUNTDOWN_MS }]);
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
    expect(th.getResult(t.state)).toEqual({ winnerIds: [], standings: [{ playerId: "p0", value: 0, label: "0 found · Orange" }], headline: "Nobody found a cache." });
  });

  it("uses the minutes setting for the round timer", () => {
    for (const m of [30, 60] as const) {
      let s = th.createGame(players(1), { ...DEFAULT_SETTINGS, minutes: m }, { roundNumber: 1, dealerSeat: 0 }, ctx()).state;
      s = start(s, 1000).state;
      expect(th.onTimer!(s, "countdown", ctx()).timers).toEqual([{ kind: "set", timerId: "round", delayMs: m * 60_000 }]);
    }
  });

  it("result order uses found count, then difficulty, then the earlier last claim", () => {
    const s = hunting(5);
    // Craft the finds directly: the order is what's under test here.
    const of = (d: number) => s.caches.filter((c) => c.difficulty === d).map((c) => c.id);
    const [d1, d2, d3] = [of(1), of(2), of(3)];
    expect(d1.length >= 3 && d2.length >= 3 && d3.length >= 1).toBe(true);
    const set = (id: string, found: string[], lastClaimAt: number | null) => Object.assign(team(s, id), { found, lastClaimAt });
    set("p0", [d1[0]!], 100); // 1 found
    set("p1", [d1[1]!, d3[0]!], 300); // 2 found, difficulty 4, later
    set("p2", [d1[2]!, d2[0]!], 50); // 2 found, difficulty 3
    set("p3", [d2[1]!, d2[2]!], 200); // 2 found, difficulty 4, earlier
    set("p4", [], null);
    s.phase = "finished";
    const r = th.getResult(s)!;
    expect(r.standings.map((x) => x.playerId)).toEqual(["p3", "p1", "p2", "p0", "p4"]);
    // p0..p4 are Orange, Sky, Green, Purple, Yellow.
    expect(r.standings.map((x) => x.label)).toEqual(["2 found · Purple", "2 found · Sky", "2 found · Green", "1 found · Orange", "0 found · Yellow"]);
    expect(r.standings.map((x) => x.value)).toEqual([2, 2, 2, 1, 0]);
    expect(r.winnerIds).toEqual(["p3"]);
    expect(r.headline).toBe("Team Purple wins");
  });

  it("winners are everyone level on all three keys", () => {
    const s = hunting(3);
    const [a, b] = s.caches.filter((c) => c.difficulty === 1).map((c) => c.id);
    Object.assign(team(s, "p0"), { found: [a!], lastClaimAt: 500 });
    Object.assign(team(s, "p1"), { found: [b!], lastClaimAt: 500 });
    s.phase = "finished";
    const r = th.getResult(s)!;
    expect(r.winnerIds.sort()).toEqual(["p0", "p1"]);
    expect(r.standings.map((x) => x.playerId)).toEqual(["p0", "p1", "p2"]);
    expect(r.headline).toBe("It's a tie.");
  });
});

describe("secrecy", () => {
  it("public state never holds a cache's x, in any phase", () => {
    let s = hunting(3);
    // A route point is whole metres, and the claimer's own track ends on the
    // cache by design. So claim one off the metre grid: a cache at a piece's
    // centre (seed 3's camp since M4b) would show in that track.
    const cid = team(s, "p0").pool.find((id) => !Number.isInteger(cacheOf(s, id).x))!;
    expect(cid).toBeDefined();
    s = standOn(s, "p0", cid, 11_000);
    const r = claim(s, "p0", cid, 11_000);
    if (!r.ok) throw new Error(r.error.code);
    s = r.transition.state;
    for (const st of [s, { ...s, phase: "finished" as const }]) {
      // The seed is public by design (clients rebuild the layout from it), and
      // a cache at a piece's centre shares that piece's x. So: the seed is the
      // layout's, and nothing else in the public state holds a cache x.
      const { seed, ...rest } = th.getPublicState(st);
      expect(seed).toBe(st.layout.seed);
      const json = JSON.stringify(rest);
      const numbers = new Set((json.match(/-?\d+(?:\.\d+)?(?:e[-+]?\d+)?/gi) ?? []).map(Number));
      for (const c of st.caches) expect(numbers.has(c.x)).toBe(false);
      expect(json).not.toContain('"pool"');
      expect(json).not.toContain('"pos"');
      expect(json).not.toContain("clues");
    }
  });

  it("private state covers only that player's team's pool", () => {
    const s = hunting(2);
    const priv = th.getPrivateState(s, "p0");
    expect(priv.clues.map((c) => c.id)).toEqual(team(s, "p0").pool);
    for (const c of priv.clues) {
      const cache = cacheOf(s, c.id);
      expect(c).toEqual({ id: c.id, clues: cache.clues, difficulty: cache.difficulty, found: false, taken: false, photo: cache.photo });
    }
    expect(priv.revealed).toEqual([]);
    expect(priv.teamId).toBe(me(s, "p0").teamId);
    expect(priv.pins).toEqual([]);
    expect(th.getPrivateState(s, "nobody")).toEqual({ teamId: null, clues: [], revealed: [], pins: [] });
  });

  it("a removed player gets no private state", () => {
    let s = hunting(2);
    const cid = team(s, "p0").pool[0]!;
    s = standOn(s, "p0", cid, 11_000);
    expect(th.getPrivateState(s, "p0").revealed.length).toBeGreaterThan(0);
    s = th.onPlayerRemoved!(s, "p0", ctx(12_000)).state;
    expect(th.getPrivateState(s, "p0")).toEqual({ teamId: null, clues: [], revealed: [], pins: [] });
  });
});
