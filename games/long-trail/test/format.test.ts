import { describe, expect, it } from "vitest";
import { goalLine, infoLines, planLines } from "../client/format.ts";
import { pack, route } from "./fixtures.ts";
import { arriveByDay, goalMet, type EndView } from "../shared/scoring.ts";

const names = (id: string) => (id === "p2" ? "Asha" : id);

describe("goalLine", () => {
  it("adds the last allowed day to an arrive-by goal, with the scoring's rounding", () => {
    expect(goalLine("Arrive a few days early.", { kind: "arrive-by", share: 0.9 }, names, 12)).toBe("Arrive a few days early. (by day 11)");
    expect(goalLine("Arrive a few days early.", { kind: "arrive-by", share: 0.9 }, names, 20)).toBe("Arrive a few days early. (by day 18)");
    expect(goalLine("Arrive many days early.", { kind: "arrive-by", share: 0.8 }, names, 32)).toBe("Arrive many days early. (by day 26)");
  });
  it("the day shown is the last day that meets the goal", () => {
    const end = (day: number): EndView => ({
      arrived: true, failedBy: null, day, deadline: 32, coins: 0, cargo: {}, endPrices: {}, grade: "fair", alive: {}, removed: [], visited: [], starved: false, deaths: 0,
    });
    const goal = { kind: "arrive-by", share: 0.9 } as const;
    const last = arriveByDay(goal.share, 32);
    expect(last).toBe(29);
    expect(goalMet(goal, end(last))).toBe(true);
    expect(goalMet(goal, end(last + 1))).toBe(false);
  });
  it("names the traveller on a protect goal, and leaves other goals alone", () => {
    expect(goalLine("Keep this traveller safe.", { kind: "protect", target: "p2" }, names, 20)).toBe("Keep this traveller safe. (Asha)");
    expect(goalLine("Nobody dies.", { kind: "nobody-dies" }, names, 20)).toBe("Nobody dies.");
  });
});

describe("infoLines at a fork", () => {
  it("names each way for the Guide and the Trader", () => {
    expect(infoLines({ job: "guide", nextLeg: null, fork: { stop: "b", ways: { c: 0, d: 2 } } }, pack, route, names)).toEqual([
      "Fork at B.",
      "The way by C looks calm.",
      "The way by D looks dangerous.",
    ]);
    expect(
      infoLines({ job: "trader", nextMarket: null, fork: { stop: "b", ways: { c: null, d: { stop: "d", prices: { silk: 12 } } } } }, pack, route, names),
    ).toEqual(["Fork at B.", "The way by C: no market ahead.", "The way by D: next market D. Silk 12."]);
    expect(infoLines({ job: "guide", nextLeg: 1, fork: null }, pack, route, names)).toEqual(["The next leg looks rough."]);
  });
});

describe("infoLines day counts", () => {
  it("say 1 day, not 1 days", () => {
    expect(infoLines({ job: "quartermaster", foodDays: 1, rations: "half", waterDays: 2 }, pack, route, names)).toEqual(["Food for 1 day on half rations. Water for 2 days."]);
    expect(infoLines({ job: "cook", foodDays: { full: 0, half: 1, none: 99 } }, pack, route, names)).toEqual(["Food lasts 0 days on full rations, or 1 day on half rations."]);
  });
});

describe("planLines", () => {
  const p = (o: object) => ({ pace: "steady", rations: "full", rest: false, fork: null, doses: [], trades: [], ...o }) as Parameters<typeof planLines>[0];
  it("reads naturally", () => {
    expect(planLines(p({ pace: "hard", rations: "none" }), pack, route, names)[0]).toBe("Hard pace. No food today.");
    expect(planLines(p({ rest: true, rations: "half" }), pack, route, names)[0]).toBe("Rest today. Half rations.");
    const buy = planLines(p({ trades: [{ item: "food", qty: 10 }, { item: "water", qty: 10 }, { item: "silk", qty: -2 }] }), pack, route, names);
    expect(buy).toContain("Buy 10 food and 10 water.");
    expect(buy).toContain("Sell 2 silk.");
  });
});
