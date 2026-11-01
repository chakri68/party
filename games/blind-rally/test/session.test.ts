import { describe, expect, it } from "vitest";
import { runClock } from "../client/role.ts";
import { sessionInit, sessionKey } from "../client/navigator/session.ts";
import type { BlindRallyPublicState, NavigatorRun, NavigatorSession } from "../shared/types.ts";
import { skyPlan } from "../shared/sky.ts";
import { VEHICLE_IDS } from "../shared/vehicles.ts";
import { game, racing } from "./helpers.ts";

const DEVICE = { selfDrive: false, muted: false, reducedMotion: false };

function navigator(): { g: BlindRallyPublicState; session: NavigatorSession; run: NavigatorRun } {
  const s = racing([["p0", "p1"]]);
  const p = game.getPrivateState(s, "p1");
  if (p.role !== "navigator") throw new Error("p1 should navigate");
  return { g: game.getPublicState(s), session: p.session, run: p.run };
}

describe("sessionInit", () => {
  it("carries the run clock, so a Godot that boots mid-race lands on the right sky", () => {
    const { g, session, run } = navigator();
    const now = g.startsAt! + 56_000;
    const cfg = sessionInit(session, g, g.teams[0], run, now, DEVICE);
    expect(cfg.clock).toEqual(runClock(g, g.teams[0], now));
    expect(cfg.clock).toEqual({ ms: 56_000, running: true });
  });

  it("is a stopped zero on the grid", () => {
    const { g, session, run } = navigator();
    expect(sessionInit(session, g, g.teams[0], run, g.startsAt! - 1000, DEVICE).clock).toEqual({ ms: 0, running: false });
  });

  it("keeps the rest of the payload: the run's anchor, a hold's remainder and the device", () => {
    const { g, session, run } = navigator();
    const now = g.startsAt! + 10_000;
    const cfg = sessionInit(session, g, g.teams[0], { ...run, checkpoints: 2, holdUntil: now + 1500 }, now, { selfDrive: true, muted: true, reducedMotion: false });
    expect(cfg).toMatchObject({ ...session, room: true, checkpoints: 2, holdMs: 1500, keyboard: true, selfDrive: true, autopilot: false, muted: true, reducedMotion: false });
  });
});

describe("sessionKey", () => {
  it("changes with the car, the rivals and the sky (a lobby Time change re-sends the session)", () => {
    const { session } = navigator();
    const key = sessionKey(session);
    expect(sessionKey({ ...session })).toBe(key);
    expect(sessionKey({ ...session, vehicle: VEHICLE_IDS.find((v) => v !== session.vehicle)! })).not.toBe(key);
    expect(sessionKey({ ...session, rivals: [{ teamId: 9, color: "#fff", vehicle: session.vehicle }] })).not.toBe(key);
    expect(sessionKey({ ...session, sky: skyPlan("night", "dry", session.seed, { length: 2000, par_seconds: null }) })).not.toBe(sessionKey({ ...session, sky: skyPlan("day", "dry", session.seed, { length: 2000, par_seconds: null }) }));
  });
});
