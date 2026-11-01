import { describe, expect, it } from "vitest";
import { runClock } from "../client/role.ts";
import type { BlindRallyPublicState, PublicTeam } from "../shared/types.ts";
import { game, racing } from "./helpers.ts";

const START = 100_000;

function base(): { g: BlindRallyPublicState; t: PublicTeam } {
  const g = { ...game.getPublicState(racing([["p0", "p1"]])), startsAt: START, endsAt: START + 300_000, endedAt: null };
  const t = { ...g.teams[0]!, status: "running" as const, timeMs: null, penaltyMs: 0, pausedMs: 0, pausedSince: null };
  return { g, t };
}

describe("runClock", () => {
  it("is zero and stopped before the start, and with no team", () => {
    const { g, t } = base();
    expect(runClock(g, t, START - 1000)).toEqual({ ms: 0, running: false });
    expect(runClock(g, undefined, START + 5000)).toEqual({ ms: 0, running: false });
  });

  it("counts from the start", () => {
    const { g, t } = base();
    expect(runClock(g, t, START + 30_000)).toEqual({ ms: 30_000, running: true });
  });

  it("leaves penalties out: the sky doesn't wait for a reset", () => {
    const { g, t } = base();
    expect(runClock(g, { ...t, penaltyMs: 10_000 }, START + 30_000).ms).toBe(30_000);
  });

  it("takes out time paused for a drop-out", () => {
    const { g, t } = base();
    expect(runClock(g, { ...t, pausedMs: 5000 }, START + 30_000).ms).toBe(25_000);
  });

  it("stops while paused, once finished, and once the race has ended", () => {
    const { g, t } = base();
    expect(runClock(g, { ...t, pausedSince: START + 20_000 }, START + 30_000).running).toBe(false);
    expect(runClock(g, { ...t, status: "finished", timeMs: 28_000 }, START + 30_000).running).toBe(false);
    expect(runClock(g, { ...t, status: "dnf" }, START + 30_000).running).toBe(false);
    expect(runClock({ ...g, endedAt: START + 25_000 }, t, START + 30_000).running).toBe(false);
  });

  it("keeps running through a reset hold (nothing public says one is on)", () => {
    const { g, t } = base();
    expect(runClock(g, { ...t, resets: 1, penaltyMs: 10_000 }, START + 30_000).running).toBe(true);
  });
});
