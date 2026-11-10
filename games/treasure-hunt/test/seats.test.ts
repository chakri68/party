import { seededRandomInt, type GameContext } from "@games/game-core";
import { describe, expect, it } from "vitest";
import { buggySlots } from "../shared/buggies.ts";
import { DEFAULT_SETTINGS, type THAction, type THPublic } from "../shared/types.ts";
import { treasureHuntGame as th, type THState } from "../server/game.ts";
import { macroHeight } from "../shared/generate.ts";
import { POS_STALE_MS, SEAT_RANGE, SEAT_STALE_MS, UNSEAT_Y_SLACK } from "../shared/world.ts";

const ctx = (now = 1000): GameContext => ({ now, randomInt: seededRandomInt(7), hostId: "p0" });
const players = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}` }));
const okState = (r: ReturnType<typeof th.handleAction>): THState => {
  if (!r.ok) throw new Error(r.error.code);
  return r.transition.state;
};

/** n players, everyone ready, in teams of their own. */
function started(n: number): THState {
  let s = th.createGame(players(n), DEFAULT_SETTINGS, { roundNumber: 1, dealerSeat: 0 }, ctx()).state;
  for (const p of s.players) s = okState(th.handleAction(s, p.id, { type: "ready" }, ctx(2000)));
  return okState(th.handleAction(s, "p0", { type: "start" }, ctx(2000)));
}
const hunting = (n = 2) => th.onTimer!(started(n), "countdown", ctx(10_000)).state;

const send = (s: THState, id: string, data: object, now: number) => th.onStream!(s, id, { t: "pos", x: 0, y: 0, z: 0, foot: true, ...data }, ctx(now));
const act = (s: THState, id: string, a: THAction, now: number) => th.handleAction(s, id, a, ctx(now));
const veh = (s: THState, id: string) => s.vehicles.find((v) => v.id === id)!;
/** Stand right by vehicle `id` at `now`. */
const near = (s: THState, pid: string, id: string, now: number) => {
  const v = veh(s, id);
  return send(s, pid, { x: v.x + 1, z: v.z }, now)!.state;
};
const seat = (s: THState, pid: string, vehicleId: string, seat: "driver" | "passenger", now: number) =>
  act(near(s, pid, vehicleId, now), pid, { type: "seat", vehicleId, seat }, now);

describe("vehicles", () => {
  it("none before start; one per team in play plus the loose ones at start", () => {
    const pre = th.createGame(players(3), DEFAULT_SETTINGS, { roundNumber: 1, dealerSeat: 0 }, ctx()).state;
    expect(pre.vehicles).toEqual([]);
    const s = started(3);
    const slots = buggySlots(s.layout);
    const loose = slots.filter((x) => x.id.startsWith("l"));
    expect(s.vehicles.map((v) => v.id)).toEqual(["t0", "t1", "t2", ...loose.map((x) => x.id)]);
    const t0 = slots.find((x) => x.id === "t0")!;
    expect(veh(s, "t0")).toEqual({ id: "t0", x: t0.x, z: t0.z, yaw: t0.yaw, y: null, driver: null, passenger: null });
    expect((th.getPublicState(s) as THPublic).vehicles).toEqual(s.vehicles);
  });

  it("parses seat and unseat", () => {
    expect(th.parseAction({ type: "seat", vehicleId: "t0", seat: "driver" })).toEqual({ type: "seat", vehicleId: "t0", seat: "driver" });
    expect(th.parseAction({ type: "seat", vehicleId: "t0", seat: "roof" })).toBeNull();
    expect(th.parseAction({ type: "unseat", x: 1, y: 2, z: 3, yaw: 0.5 })).toEqual({ type: "unseat", x: 1, y: 2, z: 3, yaw: 0.5 });
    expect(th.parseAction({ type: "unseat", x: 1, y: 2, z: Infinity, yaw: 0 })).toBeNull();
  });
});

describe("seats", () => {
  it("second driver on the same seat gets seat-taken", () => {
    let s = okState(seat(hunting(2), "p0", "t0", "driver", 11_000));
    expect(veh(s, "t0").driver).toBe("p0");
    const r = seat(s, "p1", "t0", "driver", 11_100);
    expect(r.ok ? null : r.error.code).toBe("seat-taken");
    s = okState(seat(s, "p1", "t0", "passenger", 11_100));
    expect(veh(s, "t0")).toMatchObject({ driver: "p0", passenger: "p1" });
  });

  it("refusals, in order", () => {
    const code = (r: ReturnType<typeof th.handleAction>) => (r.ok ? null : r.error.code);
    // Wrong phase.
    expect(code(act(started(2), "p0", { type: "seat", vehicleId: "t0", seat: "driver" }, 5000))).toBe("not-hunting");
    let s = hunting(2);
    expect(code(act(s, "p0", { type: "seat", vehicleId: "zz", seat: "driver" }, 11_000))).toBe("no-vehicle");
    expect(code(act(s, "p0", { type: "seat", vehicleId: "t0", seat: "driver" }, 11_000))).toBe("no-position");
    s = near(s, "p0", "t0", 11_000);
    expect(code(act(s, "p0", { type: "seat", vehicleId: "t0", seat: "driver" }, 11_000 + POS_STALE_MS + 1))).toBe("no-position");
    s = okState(act(s, "p0", { type: "seat", vehicleId: "t0", seat: "driver" }, 11_000));
    expect(code(act(s, "p0", { type: "seat", vehicleId: "t1", seat: "passenger" }, 11_000))).toBe("in-vehicle");
    expect(code(act(s, "p1", { type: "unseat", x: 0, y: 0, z: 0, yaw: 0 }, 11_000))).toBe("not-seated");
  });

  it("too far is refused", () => {
    let s = hunting(2);
    const v = veh(s, "t0");
    s = send(s, "p0", { x: v.x + SEAT_RANGE + 0.1, z: v.z }, 11_000)!.state;
    const r = act(s, "p0", { type: "seat", vehicleId: "t0", seat: "driver" }, 11_000);
    expect(r.ok ? null : r.error.code).toBe("too-far-seat");
    s = send(s, "p0", { x: v.x + SEAT_RANGE - 0.1, z: v.z }, 11_100)!.state;
    expect(act(s, "p0", { type: "seat", vehicleId: "t0", seat: "driver" }, 11_100).ok).toBe(true);
  });

  it("spectators can't sit", () => {
    let s = th.createGame(players(2), DEFAULT_SETTINGS, { roundNumber: 1, dealerSeat: 0 }, ctx()).state;
    s = okState(th.handleAction(s, "p0", { type: "ready" }, ctx(2000)));
    s = okState(th.handleAction(s, "p0", { type: "start" }, ctx(2000)));
    s = th.onTimer!(s, "countdown", ctx(10_000)).state;
    const r = act(s, "p1", { type: "seat", vehicleId: "t0", seat: "driver" }, 11_000);
    expect(r.ok ? null : r.error.code).toBe("not-in-game");
  });

  it("driver stream moves the buggy; passenger stream doesn't", () => {
    let s = okState(seat(hunting(2), "p0", "t0", "driver", 11_000));
    s = okState(seat(s, "p1", "t0", "passenger", 11_000));
    const v0 = veh(s, "t0");
    s = send(s, "p0", { x: v0.x + 2.345, y: 7.891, z: v0.z, yaw: 1.2345, foot: false, v: "t0" }, 11_100)!.state;
    expect(veh(s, "t0")).toMatchObject({ x: Math.round((v0.x + 2.345) * 100) / 100, y: 7.89, z: v0.z, yaw: 1.23 });
    const before = veh(s, "t0");
    s = send(s, "p1", { x: v0.x + 4, y: 9, z: v0.z, yaw: 2, foot: false, v: "t0" }, 11_200)!.state;
    expect(veh(s, "t0")).toEqual(before);
    // v set but on foot: contradictory, dropped.
    expect(send(s, "p0", { x: v0.x + 3, y: 7, z: v0.z, foot: true, v: "t0" }, 11_300)).toBeNull();
  });

  it("driver leaves: seat frees, pose is the last streamed, passenger stays", () => {
    let s = okState(seat(hunting(2), "p0", "t0", "driver", 11_000));
    s = okState(seat(s, "p1", "t0", "passenger", 11_000));
    const v0 = veh(s, "t0");
    s = send(s, "p0", { x: v0.x + 3, y: 5, z: v0.z + 1, yaw: 0.5, foot: false, v: "t0" }, 11_100)!.state;
    const streamed = { ...veh(s, "t0") };
    s = th.onPlayerRemoved!(s, "p0", ctx(11_200)).state;
    expect(veh(s, "t0")).toEqual({ ...streamed, driver: null, passenger: "p1" });
  });

  it("unseat pose clamped to 5 m", () => {
    let s = okState(seat(hunting(2), "p0", "t0", "driver", 11_000));
    s = okState(seat(s, "p1", "t0", "passenger", 11_000));
    const v0 = veh(s, "t0");
    s = send(s, "p0", { x: v0.x, y: 10, z: v0.z, yaw: 0, foot: false, v: "t0" }, 11_100)!.state;
    // Passenger out: seat frees, pose untouched.
    const p = okState(act(s, "p1", { type: "unseat", x: v0.x + 100, y: 0, z: v0.z, yaw: 1 }, 11_200));
    expect(veh(p, "t0")).toEqual({ ...veh(s, "t0"), passenger: null });
    // Driver out 30 m east, 50 m up: back on the 5 m circle, y within 20.
    const d = okState(act(p, "p0", { type: "unseat", x: v0.x + 30, y: 60, z: v0.z, yaw: 2 }, 11_200));
    expect(veh(d, "t0")).toMatchObject({ x: Math.round((v0.x + 5) * 100) / 100, z: v0.z, y: 30, yaw: 2, driver: null });
    // Inside 5 m: taken as sent.
    let e = okState(seat(d, "p0", "t0", "driver", 11_300));
    const v1 = veh(e, "t0");
    e = okState(act(e, "p0", { type: "unseat", x: v1.x - 2, y: 25, z: v1.z + 1, yaw: 0 }, 11_400));
    expect(veh(e, "t0")).toMatchObject({ x: Math.round((v1.x - 2) * 100) / 100, z: Math.round((v1.z + 1) * 100) / 100, y: 25 });
  });

  it("an unseat from a never-driven buggy keeps y near the ground", () => {
    const s = okState(seat(hunting(1), "p0", "t0", "driver", 11_000));
    const { x, z } = veh(s, "t0");
    const ground = macroHeight(s.layout, x, z);
    const r2 = (v: number) => Math.round(v * 100) / 100;
    // Close to the ground: as sent.
    expect(veh(okState(act(s, "p0", { type: "unseat", x, y: ground + 3, z, yaw: 0 }, 11_100)), "t0").y).toBe(r2(ground + 3));
    // Way up or way down: back within UNSEAT_Y_SLACK.
    expect(veh(okState(act(s, "p0", { type: "unseat", x, y: ground + 500, z, yaw: 0 }, 11_100)), "t0").y).toBe(r2(ground + UNSEAT_Y_SLACK));
    expect(veh(okState(act(s, "p0", { type: "unseat", x, y: ground - 500, z, yaw: 0 }, 11_100)), "t0").y).toBe(r2(ground - UNSEAT_Y_SLACK));
  });

  it("a removed player can't sit", () => {
    let s = near(hunting(2), "p1", "t0", 11_000);
    s = th.onPlayerRemoved!(s, "p1", ctx(11_000)).state;
    const r = act(s, "p1", { type: "seat", vehicleId: "t0", seat: "driver" }, 11_000);
    expect(r.ok ? null : r.error.code).toBe("not-in-game");
  });

  it("a seat whose holder went quiet is free; a fresh one is not", () => {
    let s = okState(seat(hunting(3), "p0", "t0", "driver", 11_000));
    // p0's last pos is from 11 000. Just inside SEAT_STALE_MS: still taken.
    const early = seat(s, "p1", "t0", "driver", 11_000 + SEAT_STALE_MS);
    expect(early.ok ? null : early.error.code).toBe("seat-taken");
    // 15 s on: p1 gets it, and p0 holds nothing.
    s = okState(seat(s, "p1", "t0", "driver", 26_000));
    expect(veh(s, "t0").driver).toBe("p1");
    expect(s.vehicles.some((v) => v.driver === "p0" || v.passenger === "p0")).toBe(false);
    // p1 is fresh: p2 can't take it.
    const r = seat(s, "p2", "t0", "driver", 26_100);
    expect(r.ok ? null : r.error.code).toBe("seat-taken");
  });

  it("seats close with the hunt but stay filled", () => {
    let s = okState(seat(hunting(2), "p0", "t0", "driver", 11_000));
    s = okState(act(s, "p0", { type: "end" }, 12_000));
    expect(veh(s, "t0").driver).toBe("p0");
    const r = act(s, "p0", { type: "unseat", x: 0, y: 0, z: 0, yaw: 0 }, 12_100);
    expect(r.ok ? null : r.error.code).toBe("not-hunting");
  });
});
