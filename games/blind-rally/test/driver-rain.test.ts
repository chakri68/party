import { describe, expect, it } from "vitest";
import { driverRainLevel } from "../client/driver/rain.ts";
import { trackData } from "../server/geometry.ts";
import { skyPlan } from "../shared/sky.ts";
import type { BlindRallyPublicState, PublicTeam, RainSetting } from "../shared/index.ts";
import { game, racing } from "./helpers.ts";

// The Driver can't see the rain, so their phone plays it (spec §4.5). The
// level comes from the public ramp on the team's run clock: silent on a dry
// run, before GO, once home, and while a drop-out has the clock stopped.

const START = 100_000;

function base(rain: RainSetting = "rain"): { g: BlindRallyPublicState; t: PublicTeam } {
  const g = { ...game.getPublicState(racing([["p0", "p1"]], 2, { rain })), startsAt: START, endsAt: START + 600_000, endedAt: null };
  const t = { ...g.teams[0]!, status: "running" as const, timeMs: null, penaltyMs: 0, pausedMs: 0, pausedSince: null };
  return { g, t };
}

describe("the public rain ramp", () => {
  it("is the session's own ramp", () => {
    const s = racing([["p0", "p1"]], 2, { rain: "storm" });
    expect(game.getPublicState(s).skyRain).toEqual(skyPlan(s.settings.time, "storm", s.seed, trackData(s.trackId)).rain);
  });
});

describe("driverRainLevel", () => {
  it("is 0 all run on a dry plan", () => {
    const { g, t } = base("dry");
    for (const ms of [0, 30_000, 120_000]) expect(driverRainLevel(g, t, START + ms)).toBe(0);
  });

  it("is 1 for static rain while running", () => {
    const { g, t } = base("rain");
    expect(driverRainLevel(g, t, START + 30_000)).toBe(1);
  });

  it("is 0.5 at the storm's midpoint", () => {
    const { g, t } = base("storm");
    const { atMs, overMs } = g.skyRain;
    expect(overMs).toBeGreaterThan(0);
    expect(driverRainLevel(g, t, START + atMs - 1)).toBe(0);
    expect(driverRainLevel(g, t, START + atMs + overMs / 2)).toBeCloseTo(0.5, 6);
    expect(driverRainLevel(g, t, START + atMs + overMs + 1)).toBe(1);
  });

  it("is 0 before GO, once the team is home, and while paused", () => {
    const { g, t } = base("rain");
    expect(driverRainLevel(g, t, START - 1000)).toBe(0);
    expect(driverRainLevel(g, { ...t, status: "finished", timeMs: 28_000 }, START + 30_000)).toBe(0);
    expect(driverRainLevel(g, { ...t, status: "dnf" }, START + 30_000)).toBe(0);
    expect(driverRainLevel(g, { ...t, pausedSince: START + 20_000 }, START + 30_000)).toBe(0);
    expect(driverRainLevel({ ...g, endedAt: START + 25_000 }, t, START + 30_000)).toBe(0);
    expect(driverRainLevel(g, undefined, START + 30_000)).toBe(0);
  });

  it("follows the clock the sky runs on: a drop-out's pause delays the storm", () => {
    const { g, t } = base("storm");
    const { atMs, overMs } = g.skyRain;
    const mid = START + atMs + overMs / 2;
    expect(driverRainLevel(g, { ...t, pausedMs: overMs / 2 }, mid)).toBeCloseTo(0, 6);
  });

  it("is 0 on Snowblind: snow falls quietly", () => {
    const { g, t } = base("rain");
    expect(driverRainLevel({ ...g, trackId: "snowblind" }, t, START + 30_000)).toBe(0);
  });
});
