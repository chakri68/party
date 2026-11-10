import { seededRandomInt, type GameContext } from "@games/game-core";
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../shared/types.ts";
import type { THPublic } from "../shared/types.ts";
import { treasureHuntGame as th, type THState } from "../server/game.ts";
import { macroHeight } from "../shared/generate.ts";
import { POS_HZ, REVEAL_RADIUS, TRACK_CAP, TRACK_MIN_M, TRACK_MIN_MS } from "../shared/world.ts";

const ctx = (now = 1000): GameContext => ({ now, randomInt: seededRandomInt(7), hostId: "p0" });
const players = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}` }));

/** n players, everyone ready, past the countdown: hunting at t = 10 000. */
function hunting(n = 2): THState {
  let s = th.createGame(players(n), DEFAULT_SETTINGS, { roundNumber: 1, dealerSeat: 0 }, ctx()).state;
  for (const p of s.players) s = (th.handleAction(s, p.id, { type: "ready" }, ctx(2000)) as { ok: true; transition: { state: THState } }).transition.state;
  s = (th.handleAction(s, "p0", { type: "start" }, ctx(2000)) as { ok: true; transition: { state: THState } }).transition.state;
  return th.onTimer!(s, "countdown", ctx(10_000)).state;
}

const route = (s: THState, id: string) => s.players.find((p) => p.id === id)!.route;
const send = (s: THState, id: string, data: object, now: number) => th.onStream!(s, id, { t: "pos", x: 0, y: 0, z: 0, foot: true, ...data }, ctx(now));

describe("stream v2", () => {
  it("POS_HZ is 10", () => expect(POS_HZ).toBe(10));

  it("snapshot relays to everyone else, persist false", () => {
    const s = send(hunting(2), "p0", {}, 10_050)!.state;
    const r = send(s, "p0", { x: 1.234, y: 5.678, z: -9.999, yaw: 1.5678, foot: false, v: "b1" }, 10_100)!;
    expect(r.relay).toEqual({ t: "pos", x: 1.23, y: 5.68, z: -10, yaw: 1.57, foot: false, v: "b1" });
    expect(r.persist).toBe(false);
  });

  it("a route point at most once a second and only after 5 m; that step persists", () => {
    let s = hunting(1);
    const a = send(s, "p0", { x: 100, z: 200 }, 11_000)!;
    expect(a.persist).toBe(true);
    s = a.state;
    expect(route(s, "p0")).toEqual([[1, 100, 200]]);
    // Far enough, too soon.
    const soon = send(s, "p0", { x: 110, z: 200 }, 11_000 + TRACK_MIN_MS - 100)!;
    expect(soon.persist).toBe(false);
    expect(route(soon.state, "p0")).toHaveLength(1);
    // Late enough, too close.
    const near = send(s, "p0", { x: 100 + TRACK_MIN_M - 0.5, z: 200 }, 11_000 + TRACK_MIN_MS)!;
    expect(near.persist).toBe(false);
    // Both.
    const both = send(s, "p0", { x: 100 + TRACK_MIN_M, z: 200 }, 11_000 + TRACK_MIN_MS)!;
    expect(both.persist).toBe(true);
    expect(route(both.state, "p0")).toEqual([[1, 100, 200], [2, 105, 200]]);
    // Not in the countdown.
    let cd = th.createGame(players(1), DEFAULT_SETTINGS, { roundNumber: 1, dealerSeat: 0 }, ctx()).state;
    cd = (th.handleAction(cd, "p0", { type: "ready" }, ctx(2000)) as { ok: true; transition: { state: THState } }).transition.state;
    cd = (th.handleAction(cd, "p0", { type: "start" }, ctx(2000)) as { ok: true; transition: { state: THState } }).transition.state;
    const c = send(cd, "p0", { x: 50 }, 3000)!;
    expect(c.persist).toBe(false);
    expect(c.relay).toBeDefined();
    expect(route(c.state, "p0")).toEqual([]);
  });

  it("route capped at 2000", () => {
    let s = hunting(1);
    for (let i = 0; i < TRACK_CAP + 50; i++) s = send(s, "p0", { x: (i % 2) * 40 - 20 }, 11_000 + i * 1000)!.state;
    expect(route(s, "p0")).toHaveLength(TRACK_CAP);
    const r = send(s, "p0", { x: 0 }, 11_000 + (TRACK_CAP + 60) * 1000)!;
    expect(r.persist).toBe(false);
  });

  it("replay is null until finished, then holds routes and finds", () => {
    let s = hunting(3);
    s = send(s, "p0", { x: 10.4, z: 20.6 }, 12_000)!.state;
    s = send(s, "p1", { x: -30, z: 5 }, 13_000)!.state;
    const pubOf = (x: THState) => th.getPublicState(x) as THPublic;
    expect(pubOf(s).replay).toBeNull();
    // p0 claims a cache.
    const t0 = s.teams.find((t) => t.id === s.players[0]!.teamId)!;
    const cid = t0.pool[0]!;
    const c = s.caches.find((x) => x.id === cid)!;
    s = send(s, "p0", { x: c.x, y: macroHeight(s.layout, c.x, c.z) + c.dy, z: c.z }, 20_000)!.state;
    const claimed = th.handleAction(s, "p0", { type: "claim", cacheId: cid }, ctx(20_000));
    if (!claimed.ok) throw new Error(claimed.error.code);
    s = claimed.transition.state;
    expect(pubOf(s).replay).toBeNull();
    // p1 leaves; the host ends the round.
    const ended = th.handleAction(s, "p0", { type: "end" }, ctx(70_000));
    if (!ended.ok) throw new Error(ended.error.code);
    s = ended.transition.state;
    const rep = pubOf(s).replay!;
    expect(rep.durationS).toBe(60);
    expect(rep.finds).toEqual([{ cacheId: cid, teamId: s.players[0]!.teamId, playerId: "p0", t: 10, x: Math.round(c.x), z: Math.round(c.z) }]);
    const t = (id: string) => rep.tracks.find((x) => x.playerId === id)!;
    expect(t("p0").points[0]).toEqual([2, 10, 21]);
    expect(t("p1").points).toEqual([[3, -30, 5]]);
    expect(t("p1").teamId).toBe(s.players[1]!.teamId);
    expect(rep.tracks.map((x) => x.playerId).sort()).toEqual(["p0", "p1", "p2"]);
  });

  it("replay includes removed players and leaves out spectators", () => {
    let s = th.createGame(players(3), DEFAULT_SETTINGS, { roundNumber: 1, dealerSeat: 0 }, ctx()).state;
    for (const id of ["p0", "p1"]) s = (th.handleAction(s, id, { type: "ready" }, ctx(2000)) as { ok: true; transition: { state: THState } }).transition.state;
    s = (th.handleAction(s, "p0", { type: "start" }, ctx(2000)) as { ok: true; transition: { state: THState } }).transition.state;
    s = th.onTimer!(s, "countdown", ctx(10_000)).state;
    s = send(s, "p1", { x: 40, z: 40 }, 12_000)!.state;
    expect(send(s, "p2", { x: 40, z: 40 }, 12_000)).toBeNull();
    s = th.onPlayerRemoved!(s, "p1", ctx(13_000)).state;
    s = (th.handleAction(s, "p0", { type: "end" }, ctx(20_000)) as { ok: true; transition: { state: THState } }).transition.state;
    const rep = (th.getPublicState(s) as THPublic).replay!;
    expect(rep.tracks.map((x) => x.playerId).sort()).toEqual(["p0", "p1"]);
    expect(rep.tracks.find((x) => x.playerId === "p1")!.points).toEqual([[2, 40, 40]]);
    expect(rep.durationS).toBe(10);
  });

  it("a hunt that never started has duration 0", () => {
    let s = th.createGame(players(1), DEFAULT_SETTINGS, { roundNumber: 1, dealerSeat: 0 }, ctx()).state;
    s = th.onPlayerRemoved!(s, "p0", ctx(3000)).state;
    expect(s.phase).toBe("finished");
    expect((th.getPublicState(s) as THPublic).replay).toEqual({ durationS: 0, tracks: [], finds: [] });
  });

  it("missing yaw/v default to 0/null; wrong types are dropped", () => {
    const s = hunting(2);
    const old = th.onStream!(s, "p0", { t: "pos", x: 1, y: 2, z: 3, foot: true }, ctx(10_100))!;
    expect(old.relay).toEqual({ t: "pos", x: 1, y: 2, z: 3, yaw: 0, foot: true, v: null });
    expect(send(s, "p0", { yaw: "1" }, 10_100)).toBeNull();
    expect(send(s, "p0", { yaw: NaN }, 10_100)).toBeNull();
    expect(send(s, "p0", { v: 3 }, 10_100)).toBeNull();
    expect(send(s, "p0", { v: "" }, 10_100)).toBeNull();
    expect(send(s, "p0", { v: "123456789" }, 10_100)).toBeNull();
    expect(send(s, "p0", { v: "12345678", foot: false }, 10_100)!.relay).toMatchObject({ v: "12345678" });
    expect(send(s, "p0", { v: null }, 10_100)!.relay).toMatchObject({ v: null });
  });

  it("a team reveal rides alongside the relay", () => {
    const s = hunting(2);
    const cid = s.teams.find((t) => t.id === s.players[0]!.teamId)!.pool[0]!;
    const c = s.caches.find((x) => x.id === cid)!;
    const r = send(s, "p0", { x: c.x, z: c.z }, 10_100)!;
    expect(r.relay).toBeDefined();
    expect(r.relays!.length).toBeGreaterThan(0);
  });

  it("a reveal step with no route point still persists", () => {
    let s = hunting(1);
    const c = s.caches.find((x) => x.id === s.teams[0]!.pool[0]!)!;
    s = send(s, "p0", { x: c.x + REVEAL_RADIUS + 1, z: c.z }, 11_000)!.state;
    const r = send(s, "p0", { x: c.x + REVEAL_RADIUS - 0.5, z: c.z }, 11_100)!;
    expect(r.relays!.length).toBeGreaterThan(0);
    expect(route(r.state, "p0")).toHaveLength(1);
    expect(r.persist).toBe(true);
  });

  it("spectator snapshots are dropped with no relay", () => {
    let s = th.createGame(players(2), DEFAULT_SETTINGS, { roundNumber: 1, dealerSeat: 0 }, ctx()).state;
    s = (th.handleAction(s, "p0", { type: "ready" }, ctx(2000)) as { ok: true; transition: { state: THState } }).transition.state;
    s = (th.handleAction(s, "p0", { type: "start" }, ctx(2000)) as { ok: true; transition: { state: THState } }).transition.state;
    expect(send(s, "p1", {}, 3000)).toBeNull();
  });
});
