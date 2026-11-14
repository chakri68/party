import { describe, expect, it } from "vitest";
import type { SettingPack } from "../shared/pack.ts";
import { POINTS, dealGoals, goalMet, gradeOf, outcome, points, wealth, type EndView } from "../shared/scoring.ts";
import type { Goal } from "../shared/types.ts";
import { pack as basePack, route, seeded, van } from "./fixtures.ts";

const gradePack = {
  ...basePack,
  grades: { broke: 0, fair: 100, rich: 200, legendary: 350 },
  goals: [
    { id: "g1", text: "", goal: { kind: "coins", atLeast: 10 } },
    { id: "g2", text: "", goal: "protect-someone" },
    { id: "g3", text: "", goal: { kind: "visit", stop: "zzz" } },
    { id: "g4", text: "", goal: { kind: "nobody-dies" } },
    { id: "g5", text: "", goal: { kind: "never-starve" } },
    { id: "g6", text: "", goal: { kind: "arrive-by", share: 0.8 } },
    { id: "g7", text: "", goal: { kind: "grade", atLeast: "fair" } },
    { id: "g8", text: "", goal: { kind: "cargo", good: "silk", atLeast: 2 } },
    { id: "g9", text: "", goal: { kind: "cargo", good: "salt", atLeast: 1 } },
  ],
} as unknown as SettingPack;

const ids8 = ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8"];

function end(o: Partial<EndView> = {}): EndView {
  return {
    arrived: true, day: 8, deadline: 10, coins: 50, cargo: {}, endPrices: {}, grade: "rich",
    alive: { p1: true, p2: true, p3: true }, removed: [], visited: ["a", "b", "e"], starved: false, deaths: 0,
    ...o,
  };
}

describe("dealGoals", () => {
  it("gives 8 players distinct cards, protect never names the holder", () => {
    for (let seed = 1; seed <= 100; seed++) {
      const goals = dealGoals(gradePack, route, ids8, seeded(seed));
      expect(Object.keys(goals)).toHaveLength(8);
      const kinds = Object.values(goals).map((g) => (g.kind === "cargo" ? `cargo-${g.good}` : g.kind));
      expect(new Set(kinds).size).toBe(8);
      for (const [id, g] of Object.entries(goals)) if (g.kind === "protect") expect(g.target).not.toBe(id);
    }
  });
  it("returns copies, not the pack's goal objects", () => {
    const goals = dealGoals(gradePack, route, ids8, seeded(1));
    for (const g of Object.values(goals)) for (const card of gradePack.goals) expect(g).not.toBe(card.goal);
  });
  it("visit goals name a stop on one branch only", () => {
    for (let seed = 1; seed <= 50; seed++) {
      for (const g of Object.values(dealGoals(gradePack, route, ids8, seeded(seed)))) {
        if (g.kind === "visit") expect(["c", "d"]).toContain(g.stop);
      }
    }
  });
  it("skips a visit card when the route has no fork", () => {
    const line = { ...route, stops: [{ id: "a", name: "A", next: [{ to: "e", km: 10, kind: "plain" as const }] }, { id: "e", name: "E", next: [] }] };
    for (let seed = 1; seed <= 30; seed++) {
      const goals = dealGoals(gradePack, line, ["p1", "p2", "p3"], seeded(seed));
      expect(Object.values(goals).some((g) => g.kind === "visit")).toBe(false);
    }
  });
  it("reuses cards when players outnumber them, never twice in a row", () => {
    const small = { ...gradePack, goals: gradePack.goals.slice(0, 3) } as SettingPack; // coins, protect, visit
    const ids = Array.from({ length: 9 }, (_, i) => `p${i + 1}`);
    for (let seed = 1; seed <= 50; seed++) {
      const kinds = ids.map((id) => dealGoals(small, route, ids, seeded(seed))[id]!.kind);
      for (let i = 1; i < kinds.length; i++) expect(kinds[i]).not.toBe(kinds[i - 1]);
    }
  });
});

describe("wealth and grades", () => {
  it("counts coins plus cargo at the end price", () => {
    const c = van({ stock: { food: 0, water: 0, medicine: 0, coins: 50, animals: 0, cargo: { silk: 3 } }, prices: { e: { silk: 20 } } });
    expect(wealth(c, route)).toBe(110);
  });
  it("grades by threshold", () => {
    expect(gradeOf(gradePack, 110)).toBe("fair");
    expect(gradeOf(gradePack, 99)).toBe("broke");
    expect(gradeOf(gradePack, 200)).toBe("rich");
    expect(gradeOf(gradePack, 350)).toBe("legendary");
  });
});

describe("goalMet", () => {
  it("needs arrival for coins, cargo, arrive-by and grade goals", () => {
    const failed = end({ arrived: false, grade: null, cargo: { silk: 5 } });
    expect(goalMet({ kind: "coins", atLeast: 10 }, failed)).toBe(false);
    expect(goalMet({ kind: "cargo", good: "silk", atLeast: 1 }, failed)).toBe(false);
    expect(goalMet({ kind: "arrive-by", share: 1 }, failed)).toBe(false);
    expect(goalMet({ kind: "grade", atLeast: "broke" }, failed)).toBe(false);
  });
  it("arrive-by uses ceil(share * deadline)", () => {
    expect(goalMet({ kind: "arrive-by", share: 0.75 }, end({ day: 8 }))).toBe(true); // ceil(7.5) = 8
    expect(goalMet({ kind: "arrive-by", share: 0.75 }, end({ day: 9 }))).toBe(false);
  });
  it("grade compares in order", () => {
    expect(goalMet({ kind: "grade", atLeast: "rich" }, end({ grade: "legendary" }))).toBe(true);
    expect(goalMet({ kind: "grade", atLeast: "rich" }, end({ grade: "fair" }))).toBe(false);
  });
  it("protect is met when the target lives or was removed", () => {
    const g: Goal = { kind: "protect", target: "p3" };
    expect(goalMet(g, end())).toBe(true);
    expect(goalMet(g, end({ alive: { p3: false }, removed: ["p3"] }))).toBe(true);
    expect(goalMet(g, end({ alive: { p3: false } }))).toBe(false);
  });
  it("nobody-dies, never-starve and visit", () => {
    expect(goalMet({ kind: "nobody-dies" }, end({ deaths: 1 }))).toBe(false);
    expect(goalMet({ kind: "never-starve" }, end({ starved: true }))).toBe(false);
    expect(goalMet({ kind: "visit", stop: "c" }, end())).toBe(false);
    expect(goalMet({ kind: "visit", stop: "b" }, end())).toBe(true);
  });
});

describe("points", () => {
  const coins: Goal = { kind: "coins", atLeast: 10 };
  it("adds arrival, grade, goal and survival", () => {
    expect(points("p1", coins, end())).toBe(POINTS.arrived + POINTS.grade.rich + POINTS.goal + POINTS.alive);
    expect(points("p1", coins, end())).toBe(14);
  });
  it("a failed caravan still scores a met goal and survival", () => {
    expect(points("p1", { kind: "nobody-dies" }, end({ arrived: false, grade: null }))).toBe(5);
    expect(points("p1", coins, end({ arrived: false, grade: null }))).toBe(2);
  });
  it("a dead traveller with a met goal on a failed caravan scores 3", () => {
    expect(points("p1", { kind: "never-starve" }, end({ arrived: false, grade: null, alive: { p1: false } }))).toBe(3);
  });
  it("a removed player scores nothing", () => {
    expect(points("p1", coins, end({ removed: ["p1"] }))).toBe(0);
  });
});

describe("outcome", () => {
  const goals: Record<string, Goal> = { p1: { kind: "coins", atLeast: 10 }, p2: { kind: "coins", atLeast: 999 }, p3: { kind: "coins", atLeast: 999 } };
  it("a failed caravan has no winners", () => {
    const o = outcome(["p1", "p2", "p3"], goals, end({ arrived: false, grade: null, day: 10, alive: { p1: true, p2: false, p3: false } }), gradePack, 10);
    expect(o.winnerIds).toEqual([]);
    expect(o.headline).toBe("The season ended on day 10");
    expect(o.standings).toHaveLength(3);
  });
  it("everyone dead says so", () => {
    const o = outcome(["p1", "p2", "p3"], goals, end({ arrived: false, grade: null, alive: { p1: false, p2: false, p3: false } }), gradePack, 4);
    expect(o.headline).toBe("Everyone died on the trail");
  });
  it("top points win, ties share", () => {
    const o = outcome(["p1", "p2", "p3"], goals, end(), gradePack, 8);
    expect(o.winnerIds).toEqual(["p1"]);
    expect(o.headline).toBe("Arrived rich, day 8");
    expect(o.standings.find((s) => s.playerId === "p1")).toEqual({ playerId: "p1", value: 14, label: "14 pts · goal met" });
    expect(o.standings.find((s) => s.playerId === "p2")?.label).toBe("11 pts · goal missed");
    const tie = outcome(["p1", "p2"], { p1: goals.p1!, p2: goals.p1! }, end(), gradePack, 8);
    expect(tie.winnerIds.sort()).toEqual(["p1", "p2"]);
  });
  it("removed players get no standing and can't win", () => {
    const o = outcome(["p1", "p2", "p3"], goals, end({ removed: ["p1"] }), gradePack, 8);
    expect(o.standings.map((s) => s.playerId)).toEqual(["p2", "p3"]);
    expect(o.winnerIds).not.toContain("p1");
  });
});
