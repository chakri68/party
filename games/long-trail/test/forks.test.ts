import { seededRandomInt } from "@games/game-core";
import { describe, expect, it } from "vitest";
import { rollForks, withForks } from "../shared/forks.ts";
import { packFor, stopById, type RouteDef } from "../shared/pack.ts";
import type { Length } from "../shared/types.ts";
import { route as fixture } from "./fixtures.ts";

const pack = packFor("trade-route");
const LENGTHS: Length[] = ["short", "normal", "epic"];

/** km from `from` along `first` to where the ways meet (the next fork or the end). */
function wayKm(route: RouteDef, from: string, to: string): number {
  let km = stopById(route, from).next.find((l) => l.to === to)!.km;
  for (let at = to; stopById(route, at).next.length === 1; ) {
    const leg = stopById(route, at).next[0]!;
    if (stopById(route, leg.to).next.length !== 1 || leg.to === route.end) {
      km += leg.km;
      break;
    }
    km += leg.km;
    at = leg.to;
  }
  return km;
}

/** km of the whole trip on the safe way at every fork. */
function safeKm(route: RouteDef): number {
  let km = 0;
  for (let at = route.start; at !== route.end; ) {
    const next = stopById(route, at).next;
    const leg = next.length === 2 ? next.find((l) => l.safe)! : next[0]!;
    km += leg.km;
    at = leg.to;
  }
  return km;
}

/** The longest trip there is, over the pack's own km. */
function longestKm(route: RouteDef, at = route.start): number {
  if (at === route.end) return 0;
  return Math.max(...stopById(route, at).next.map((l) => l.km + longestKm(route, l.to)));
}

describe("rollForks", () => {
  it.each(LENGTHS)("%s: the pack's safe way, and only fork legs change", (length) => {
    const base = pack.routes[length];
    for (let seed = 1; seed <= 50; seed++) {
      const route = withForks(base, rollForks(base, seededRandomInt(seed)));
      expect(route.stops.map((s) => s.id)).toEqual(base.stops.map((s) => s.id));
      for (const s of route.stops) {
        const b = stopById(base, s.id);
        expect(s.next.map((l) => [l.to, l.kind])).toEqual(b.next.map((l) => [l.to, l.kind]));
        if (s.next.length === 2) expect(s.next.filter((l) => l.safe)).toHaveLength(1);
        for (const l of s.next) expect(l.km).toBeGreaterThanOrEqual(10);
      }
      // The safe path is never longer than the pack's longest way, so the deadline stays reachable.
      expect(safeKm(route)).toBeLessThanOrEqual(longestKm(base));
    }
  });

  it.each(LENGTHS)("%s: across games the risky way is sometimes shorter and sometimes longer", (length) => {
    const base = pack.routes[length];
    const forks = base.stops.filter((s) => s.next.length === 2);
    for (const fork of forks) {
      const seen = { riskyShorter: 0, riskyLonger: 0 };
      const baseSafe = stopById(base, fork.id).next.find((l) => l.safe)!.to;
      for (let seed = 1; seed <= 200; seed++) {
        const route = withForks(base, rollForks(base, seededRandomInt(seed)));
        const [a, b] = stopById(route, fork.id).next;
        const safe = a!.safe ? a! : b!;
        const risky = a!.safe ? b! : a!;
        expect(safe.to).toBe(baseSafe);
        // The safe way keeps the pack's km.
        expect(wayKm(route, fork.id, safe.to)).toBe(wayKm(base, fork.id, safe.to));
        const d = wayKm(route, fork.id, risky.to) - wayKm(route, fork.id, safe.to);
        if (d < 0) seen.riskyShorter++;
        if (d > 0) seen.riskyLonger++;
      }
      expect(seen.riskyShorter, fork.id).toBeGreaterThan(60);
      expect(seen.riskyLonger, fork.id).toBeGreaterThan(40);
    }
  });

  it("uses the fixture's legs too, without touching legs off the fork", () => {
    const rolled = rollForks(fixture, seededRandomInt(7));
    expect(Object.keys(rolled)).toEqual(["b"]);
    expect(Object.keys(rolled.b!.km).sort()).toEqual(["b>c", "b>d", "c>e", "d>e"]);
    const route = withForks(fixture, rolled);
    expect(stopById(route, "a").next[0]!.km).toBe(100);
  });
});

describe("fork stop names", () => {
  it("do not hint at the land or the danger", () => {
    for (const length of LENGTHS)
      for (const s of pack.routes[length].stops) expect(s.name, s.id).not.toMatch(/pass|heights|gap|ferry|wells|cliff|peak|ridge|mountain|hill/i);
  });
});
