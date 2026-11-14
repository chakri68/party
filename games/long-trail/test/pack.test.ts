import { describe, expect, it } from "vitest";
import { N, packFor, pathsOf, stopById, type Goal, type Length, type LegKind } from "../shared/index.ts";
import type { Effect } from "../shared/index.ts";
import { tradeRoute } from "../shared/packs/trade-route.ts";

const LENGTHS: Length[] = ["short", "normal", "epic"];
const KINDS: LegKind[] = ["desert", "mountain", "river", "plain"];

describe("trade route pack", () => {
  it("is found by id", () => {
    expect(packFor("trade-route")).toBe(tradeRoute);
  });

  for (const len of LENGTHS) {
    describe(`${len} route`, () => {
      const r = tradeRoute.routes[len];
      const paths = pathsOf(r);

      it("has the right shape", () => {
        expect(paths.length).toBe({ short: 2, normal: 4, epic: 8 }[len]);
        for (const p of paths) expect(p.length).toBe({ short: 5, normal: 8, epic: 12 }[len]);
        expect(r.deadline).toBe({ short: 12, normal: 20, epic: 32 }[len]);
      });

      it("has valid forks and legs", () => {
        for (const s of r.stops) {
          expect([0, 1, 2]).toContain(s.next.length);
          if (s.next.length === 2) expect(s.next.filter((l) => l.safe).length).toBe(1);
          for (const l of s.next) {
            expect(l.km).toBeGreaterThanOrEqual(40);
            expect(l.km).toBeLessThanOrEqual(100);
            stopById(r, l.to);
          }
        }
        expect(stopById(r, r.end).next).toEqual([]);
      });

      it("fits the deadline at steady pace", () => {
        const days = (p: string[]) =>
          p.slice(0, -1).reduce((sum, id, i) => {
            const leg = stopById(r, id).next.find((l) => l.to === p[i + 1])!;
            return sum + Math.ceil(leg.km / N.kmPerDay.steady);
          }, 0);
        expect(Math.min(...paths.map(days))).toBeLessThanOrEqual(r.deadline - 3);
      });

      it("has about half the stops as markets, and one at the end", () => {
        for (const p of paths) {
          const mid = p.slice(1, -1);
          const n = mid.filter((id) => stopById(r, id).market).length;
          expect(n).toBeGreaterThanOrEqual(Math.floor(mid.length * 0.4));
          expect(n).toBeLessThanOrEqual(Math.ceil(mid.length * 0.6));
        }
        expect(stopById(r, r.end).market).toBeDefined();
      });

      it("reaches every stop from the start", () => {
        const seen = new Set(paths.flat());
        expect([...seen].sort()).toEqual(r.stops.map((s) => s.id).sort());
      });

      it("keeps goal stops on the map", () => {
        for (const g of tradeRoute.goals) if (typeof g.goal !== "string" && g.goal.kind === "visit") stopById(r, g.goal.stop);
      });
    });
  }

  it("has 8 jobs", () => {
    expect(Object.keys(tradeRoute.jobs).length).toBe(8);
  });

  it("has enough events", () => {
    const ev = tradeRoute.events;
    expect(ev.length).toBeGreaterThanOrEqual(30);
    expect(ev.filter((e) => "options" in e).length).toBeGreaterThanOrEqual(ev.length / 3);
    expect(new Set(ev.map((e) => e.id)).size).toBe(ev.length);
    for (const k of KINDS)
      for (const s of [0, 1, 2])
        expect(ev.filter((e) => (e.kind === k || e.kind === "any") && e.severity === s).length).toBeGreaterThanOrEqual(3);
  });

  it("keeps choices and effects honest", () => {
    const walk = (e: Effect, f: (e: Effect) => void) => {
      f(e);
      if (e.chance) {
        walk(e.chance.then, f);
        if (e.chance.else) walk(e.chance.else, f);
      }
    };
    for (const ev of tradeRoute.events) {
      const effects = "options" in ev ? ev.options.map((o) => o.effect) : [ev.effect];
      if ("options" in ev) expect(ev.options[0].effect.chance, ev.id).toBeUndefined();
      for (const e of effects)
        walk(e, (x) => {
          if (x.km !== undefined && x.km < 0) expect(x.lostTime, ev.id).toBe(true);
        });
    }
  });

  it("has goals of every kind", () => {
    const g = tradeRoute.goals;
    expect(g.length).toBeGreaterThanOrEqual(12);
    const kinds = new Set(g.map((c) => (c.goal === "protect-someone" ? "protect" : (c.goal as Goal).kind)));
    expect([...kinds].sort()).toEqual(
      ["arrive-by", "cargo", "coins", "grade", "never-starve", "nobody-dies", "protect", "visit"].sort(),
    );
    expect(new Set(g.map((c) => c.id)).size).toBe(g.length);
  });

  it("has sane grades and start stock", () => {
    const { grades } = tradeRoute;
    expect(grades.broke).toBe(0);
    expect(grades.fair).toBeGreaterThan(grades.broke);
    expect(grades.rich).toBeGreaterThan(grades.fair);
    expect(grades.legendary).toBeGreaterThan(grades.rich);
    for (const n of [3, 8]) {
      const s = tradeRoute.start(n);
      expect(Object.keys(s.cargo).length).toBe(3);
      for (const v of [s.food, s.water, s.medicine, s.coins, s.animals]) expect(v).toBeGreaterThan(0);
    }
    expect(tradeRoute.start(4).animals).toBe(4);
    expect(tradeRoute.endLines.failed.length).toBe(3);
  });
});
