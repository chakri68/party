import { seededRandomInt } from "@games/game-core";
import { describe, expect, it } from "vitest";
import { rollForks, withForks } from "../shared/forks.ts";
import { packFor, stopById, type RouteDef } from "../shared/pack.ts";
import type { Length } from "../shared/types.ts";
import { route as fixture } from "./fixtures.ts";
import formatSrc from "../client/format.ts?raw";
import indexSrc from "../client/index.ts?raw";
import planSrc from "../client/plan.ts?raw";
import reportSrc from "../client/report.ts?raw";
import viewSrc from "../client/view.ts?raw";

const CLIENT = { "format.ts": formatSrc, "index.ts": indexSrc, "plan.ts": planSrc, "report.ts": reportSrc, "view.ts": viewSrc };

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
  it.each(LENGTHS)("%s: one safe way per fork, and only fork legs change", (length) => {
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

  it.each(LENGTHS)("%s: across games either way can be safe, and the risky way is sometimes shorter and sometimes longer", (length) => {
    const base = pack.routes[length];
    const forks = base.stops.filter((s) => s.next.length === 2);
    for (const fork of forks) {
      const seen = { riskyShorter: 0, riskyLonger: 0, safe: new Set<string>() };
      const longest = Math.max(...stopById(base, fork.id).next.map((l) => wayKm(base, fork.id, l.to)));
      for (let seed = 1; seed <= 200; seed++) {
        const route = withForks(base, rollForks(base, seededRandomInt(seed)));
        const [a, b] = stopById(route, fork.id).next;
        const safe = a!.safe ? a! : b!;
        const risky = a!.safe ? b! : a!;
        seen.safe.add(safe.to);
        // The safe way is as long as the pack's longer way, whichever way it is.
        expect(wayKm(route, fork.id, safe.to)).toBe(longest);
        const d = wayKm(route, fork.id, risky.to) - wayKm(route, fork.id, safe.to);
        if (d < 0) seen.riskyShorter++;
        if (d > 0) seen.riskyLonger++;
      }
      expect(seen.safe.size, fork.id).toBe(2);
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

describe("safeWayLegs and dangers", () => {
  it("cap every leg of this game's safe way, up to where the ways meet", async () => {
    const { rollDangers } = await import("../shared/events.ts");
    const { safeWayLegs } = await import("../shared/forks.ts");
    const base = pack.routes.epic;
    const safeKinds = new Map<string, Set<string>>();
    for (let seed = 1; seed <= 100; seed++) {
      const route = withForks(base, rollForks(base, seededRandomInt(seed)));
      const safe = safeWayLegs(route);
      for (const s of route.stops.filter((x) => x.next.length === 2)) {
        const way = s.next.find((l) => l.safe)!;
        expect(safe.has(`${s.id}>${way.to}`)).toBe(true);
        const after = stopById(route, way.to).next[0]!;
        expect(safe.has(`${way.to}>${after.to}`)).toBe(true); // the second leg, to where the ways meet
        const meet = stopById(route, after.to);
        if (meet.next.length === 1) expect(safe.has(`${meet.id}>${meet.next[0]!.to}`)).toBe(false); // past the meeting stop
        if (!safeKinds.has(s.id)) safeKinds.set(s.id, new Set());
        safeKinds.get(s.id)!.add(way.kind);
      }
      // Every roll on a safe leg is below dangerous, whatever randomInt says.
      const dangers = rollDangers(route, (n) => n - 1);
      for (const k of safe) expect(dangers[k], k).toBe(1);
      expect(Object.values(dangers)).toContain(2);
    }
    // Each fork's two first legs are different kinds, and either can be the safe one: the kind is no tell.
    for (const [fork, kinds] of safeKinds) expect(kinds.size, fork).toBe(2);
  });

  it("lists the ways at a fork by stop id, in the pack and in this game's route", () => {
    for (const length of LENGTHS) {
      const base = pack.routes[length];
      for (const seed of [1, 2, 3]) {
        const route = withForks(base, rollForks(base, seededRandomInt(seed)));
        for (const s of route.stops.filter((x) => x.next.length === 2)) {
          const ids = s.next.map((l) => l.to);
          expect(ids).toEqual([...ids].sort());
        }
      }
    }
  });
});

describe("the client", () => {
  it("never reads a leg's safe flag: the pack's flag is not this game's answer", () => {
    for (const [f, src] of Object.entries(CLIENT)) {
      expect(src.length, f).toBeGreaterThan(100);
      expect(src, f).not.toMatch(/\.safe\b|\bsafe:/);
    }
  });
});
