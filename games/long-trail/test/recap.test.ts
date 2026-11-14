import { describe, expect, it } from "vitest";
import type { SettingPack } from "../shared/pack.ts";
import { buildRecap, type DayLog } from "../shared/recap.ts";
import type { EndView } from "../shared/scoring.ts";
import type { JobId } from "../shared/types.ts";
import { pack as basePack, plan, route } from "./fixtures.ts";

const pack = { ...basePack, endLines: { arrived: { broke: ["b"], fair: ["f"], rich: ["r"], legendary: ["l"] }, failed: ["x"] } } as unknown as SettingPack;
const jobs: Record<string, JobId> = { p1: "guide", p2: "healer", p3: "trader" };
const names = { p1: "Asha", p2: "Ben", p3: "Cy" };
const votes = (...v: ("go" | "no-go")[]) => Object.fromEntries(v.map((x, i) => [`p${i + 1}`, x]));
const rep = (o: Partial<DayLog["report"]> = {}): DayLog["report"] => ({ km: 30, reached: null, healthChanges: [], stockDelta: {}, cargoDelta: {}, ...o });

const log: DayLog[] = [
  { day: 1, leader: "p1", plan: plan(), proposals: [{ by: "p1", votes: votes("go", "go", "go"), passed: true }], stayedCourse: false, event: null, report: rep({ reached: "b", stockDelta: { food: -6 } }), where: "B" },
  { day: 2, leader: "p2", plan: plan({ pace: "hard", rations: "half", fork: "c" }), proposals: [{ by: "p2", votes: votes("go", "go", "no-go"), passed: true }], stayedCourse: false, event: null, report: rep({ reached: "c", stockDelta: { food: -2 } }), where: "C" },
  { day: 3, leader: "p3", plan: plan({ rest: true }), proposals: [{ by: "p3", votes: votes("go", "go", "go"), passed: true }], stayedCourse: false, event: { id: "e1", text: "A storm hits.", choice: { votes: { p1: 0, p2: 0, p3: 1 }, picked: 0, label: "Wait it out" } }, report: rep({ km: 0, healthChanges: [{ playerId: "p3", from: 1, to: 0 }] }), where: "between C and E" },
  { day: 4, leader: "p1", plan: plan(), proposals: [{ by: "p1", votes: votes("go", "go", "go"), passed: true }], stayedCourse: false, event: null, report: rep({ reached: "e" }), where: "E" },
];
const end: EndView = {
  arrived: true, day: 4, deadline: 10, coins: 50, cargo: { silk: 3 }, endPrices: { silk: 20 }, grade: "fair",
  alive: { p1: true, p2: true, p3: false }, removed: [], visited: ["a", "b", "c", "e"], starved: false, deaths: 1,
};
const run = (e = end, l = log) => buildRecap(l, pack, route, e, jobs, { p1: { kind: "coins", atLeast: 10 }, p2: { kind: "nobody-dies" }, p3: { kind: "coins", atLeast: 10 } }, { p1: "Get coins", p2: "Nobody dies", p3: "More coins" }, () => 0, names);

describe("buildRecap", () => {
  it("lists stops in the order reached, with days", () => {
    expect(run().route).toEqual([
      { stop: "a", name: "A", day: 1 },
      { stop: "b", name: "B", day: 1 },
      { stop: "c", name: "C", day: 2 },
      { stop: "e", name: "E", day: 4 },
    ]);
  });
  it("orders big calls by margin, closest first, at most 3", () => {
    const calls = run().bigCalls;
    expect(calls).toHaveLength(3);
    expect(calls[0]).toMatchObject({ day: 3, question: "Wait it out", go: 2, noGo: 1 }); // 2-1, later day first
    expect(calls[1]).toMatchObject({ day: 2, question: "Hard pace, half rations, C", go: 2, noGo: 1, result: "Lost 2 food" });
    expect(calls[2]!.go - calls[2]!.noGo).toBe(3);
  });
  it("breaks equal margins by voters, then later day", () => {
    const l: DayLog[] = [
      { ...log[0]!, proposals: [{ by: "p1", votes: votes("go", "go", "go"), passed: true }] },
      { ...log[3]!, proposals: [{ by: "p1", votes: votes("go", "go", "go"), passed: true }] },
    ];
    expect(run(end, l).bigCalls.map((c) => c.day)).toEqual([4, 1]);
  });
  it("words plan questions and results", () => {
    const calls = run().bigCalls;
    expect(run(end, [log[0]!]).bigCalls[0]).toMatchObject({ question: "Steady pace, full rations", result: "Lost 6 food" });
    expect(calls.some((c) => c.result === "Ben died" || c.result === "Cy died")).toBe(true);
    expect(run(end, [log[3]!]).bigCalls[0]!.result).toBe("Moved 30 km");
  });
  it("finds the worst day", () => {
    expect(run().worstDay).toEqual({ day: 3, text: "A storm hits. Cy died." });
    expect(run(end, [log[3]!]).worstDay).toBeNull();
  });
  it("lists fates with the day and place of a death", () => {
    const f = run().fates;
    expect(f.find((x) => x.playerId === "p3")).toEqual({ playerId: "p3", alive: false, day: 3, where: "between C and E" });
    expect(f.find((x) => x.playerId === "p1")).toEqual({ playerId: "p1", alive: true });
  });
  it("reveals jobs and goals and checks them", () => {
    const r = run().reveals;
    expect(r.find((x) => x.playerId === "p1")).toEqual({ playerId: "p1", job: "guide", goal: "Get coins", met: true });
    expect(r.find((x) => x.playerId === "p2")?.met).toBe(false);
  });
  it("sums the haul and picks an end line", () => {
    const r = run();
    expect(r.haul).toEqual({ coins: 50, cargoSale: 60, wealth: 110, grade: "fair" });
    expect(r.line).toBe("f");
    expect(run({ ...end, arrived: false, grade: null }).line).toBe("x");
  });
  it("leaves removed players out", () => {
    const r = run({ ...end, removed: ["p2"] });
    expect(r.fates.map((x) => x.playerId)).toEqual(["p1", "p3"]);
    expect(r.reveals.map((x) => x.playerId)).toEqual(["p1", "p3"]);
  });
});
