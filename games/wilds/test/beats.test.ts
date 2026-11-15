import { describe, expect, it } from "vitest";
import type { PartyStats } from "@games/game-core";
import { planProblem, playBeats, turnOrder } from "../server/beats.ts";
import { light } from "../server/fire.ts";
import type { Card, Plan, Step } from "../shared/types.ts";
import { blankWorld } from "./helpers.ts";

const G: Card = { kind: "guard" };
const seq = (...v: number[]) => { let i = 0; return (_n: number) => v[i++ % v.length]!; };
const ex = (id: string, tile: string, role: "runner" | "fixer" | "protector" | "guide" = "fixer") => ({ id, tile, role });
function run(w: ReturnType<typeof blankWorld>, plans: Record<string, Plan>, rnd = seq(0)) {
  const steps: Step[] = []; const stats: PartyStats = {};
  playBeats(w, plans, rnd, stats, steps);
  return { steps, stats };
}
const guards = (s: Step[]) => s.filter((x) => x.t === "guard") as Extract<Step, { t: "guard" }>[];
const ruinWorld = (extra = {}) => blankWorld({}, { explorers: [ex("a", "0,0", "runner"), ex("b", "0,0", "protector")], tiles: { "1,0": { ruin: "shrine" } }, ...extra });
// dice: rnd(6) → 0..5 gives die 1..6
const pass = [5, 5], fail = [0, 0];

describe("turn order", () => {
  it("rotates and skips left", () => {
    const w = blankWorld({}, { explorers: [ex("a", "0,0"), ex("b", "0,0"), ex("c", "0,0")] });
    expect(turnOrder(w)).toEqual(["a", "b", "c"]);
    w.round = 2;
    expect(turnOrder(w)).toEqual(["b", "c", "a"]);
    w.explorers[1]!.left = true;
    expect(turnOrder(w)).toEqual(["c", "a"]);
  });
});

describe("move", () => {
  const mv = (to: string): Plan => [{ kind: "move", to }, G];
  it("reeds stop you; opens only around the end", () => {
    const w = blankWorld({ "1,0": "reeds" }, { explorers: [ex("a", "0,0")] });
    for (const t of Object.values(w.tiles)) t.open = false;
    w.tiles["0,0"]!.open = true; w.tiles["1,0"]!.open = true; w.tiles["2,0"]!.open = true;
    const { steps } = run(w, { a: mv("2,0") });
    expect(guards(steps)[0]!.why).toBe("The way is blocked.");
    run(w, { a: mv("1,0") });
    expect(w.explorers[0]!.tile).toBe("1,0");
    expect(w.tiles["1,1"]!.open).toBe(true);
    expect(w.tiles["3,0"]!.open).toBe(false);
  });
  it("blocked by fire, spider, river, fog; runner reaches 3", () => {
    const w = blankWorld({ "1,0": "river" }, { explorers: [ex("a", "0,0", "runner")], spider: "0,-1" });
    expect(guards(run(w, { a: mv("0,-1") }).steps)[0]!.why).toBe("The way is blocked.");
    expect(guards(run(w, { a: mv("1,0") }).steps)[0]!.why).toBe("The way is blocked.");
    w.tiles["-2,0"]!.open = false;
    expect(guards(run(w, { a: mv("-2,0") }).steps)[0]!.why).toBe("You can't reach that.");
    w.tiles["0,1"]!.fire = 2;
    expect(guards(run(w, { a: mv("0,1") }).steps)[0]!.why).toBe("The way is blocked.");
    w.tiles["-2,0"]!.open = true;
    run(w, { a: mv("-3,0") });
    expect(w.explorers[0]!.tile).toBe("-3,0");
    const f = blankWorld({}, { explorers: [ex("a", "0,0", "fixer")] });
    expect(guards(run(f, { a: mv("-3,0") }).steps)[0]!.why).toBe("You can't reach that.");
  });
  it("bridge fixed earlier in the same beat is walkable; the other order is blocked", () => {
    const mk = () => blankWorld({ "1,0": "broken" }, { explorers: [ex("a", "0,0", "fixer"), ex("b", "-1,0", "runner")] });
    const fixer: Plan = [{ kind: "act", at: "1,0" }, G];
    const go: Plan = [{ kind: "move", to: "1,0" }, G];
    const w = mk(); w.explorers[1]!.tile = "0,1";
    const r = run(w, { a: fixer, b: go });
    expect(w.tiles["1,0"]!.terrain).toBe("bridge");
    expect(r.steps.some((s) => s.t === "bridge" && s.fixed)).toBe(true);
    expect(w.explorers[1]!.tile).toBe("1,0");
    const w2 = mk(); w2.explorers[1]!.tile = "0,1"; w2.round = 2; // order b, a
    const r2 = run(w2, { a: fixer, b: go });
    expect(guards(r2.steps).some((g) => g.who === "b" && g.why === "The way is blocked.")).toBe(true);
  });
});

describe("help", () => {
  const act: Plan = [{ kind: "act", at: "1,0", approach: 1 }, G];
  it("adds 1 once, with helpers", () => {
    const w = blankWorld({}, { explorers: [ex("a", "0,0", "protector"), ex("b", "0,0"), ex("c", "-1,0")], tiles: { "1,0": { ruin: "shrine" } } });
    const h: Plan = [{ kind: "help", who: "a" }, G];
    const r = run(w, { a: act, b: h, c: h }, seq(...pass));
    const roll = r.steps.find((s) => s.t === "roll") as Extract<Step, { t: "roll" }>;
    expect(roll.bonus).toBe(3); expect(roll.helpers).toEqual(["b", "c"]);
  });
  it("a far helper does nothing and gets help-nothing when target did not roll", () => {
    const w = blankWorld({}, { explorers: [ex("a", "0,0"), ex("b", "3,-3")] });
    const r = run(w, { a: [G, G], b: [{ kind: "help", who: "a" }, G] });
    expect(r.steps).toContainEqual({ t: "help-nothing", who: "b", target: "a" });
    const w2 = blankWorld({}, { explorers: [ex("a", "0,0"), ex("b", "0,0")] });
    const r2 = run(w2, { a: [G, G], b: [{ kind: "help", who: "a" }, G] });
    expect(r2.steps.filter((s) => s.t === "help-nothing")).toEqual([{ t: "help-nothing", who: "b", target: "a" }, { t: "help-nothing", who: "b", target: "a" }].slice(0, 1));
  });
  it("a far helper adds no bonus to the roll", () => {
    const w = blankWorld({}, { explorers: [ex("a", "0,0", "protector"), ex("b", "3,-3")], tiles: { "1,0": { ruin: "shrine" } } });
    const r = run(w, { a: [{ kind: "act", at: "1,0", approach: 1 }, G], b: [{ kind: "help", who: "a" }, G] }, seq(...pass));
    const roll = r.steps.find((s) => s.t === "roll") as Extract<Step, { t: "roll" }>;
    expect(roll.bonus).toBe(2); expect(roll.helpers).toEqual([]);
    expect(r.steps).toContainEqual({ t: "help-nothing", who: "b", target: "a" });
  });
  it("down at round start, rescued in beat 1: guards in beat 2", () => {
    const w = blankWorld({}, { explorers: [ex("a", "0,0"), ex("b", "0,0")] });
    w.explorers[0]!.down = true; w.explorers[0]!.hearts = 0;
    const r = run(w, { a: [{ kind: "look" }, { kind: "look" }], b: [{ kind: "help", who: "a" }, G] });
    expect(w.explorers[0]!.shield).toBe(true);
    expect(r.steps).toContainEqual({ t: "guard", who: "a", why: null });
  });
  it("gets a down player up and counts rescues", () => {
    const w = blankWorld({}, { explorers: [ex("a", "0,0"), ex("b", "0,0")] });
    w.explorers[0]!.down = true; w.explorers[0]!.hearts = 0;
    const r = run(w, { b: [{ kind: "help", who: "a" }, G] });
    expect(w.explorers[0]!.down).toBe(false); expect(w.explorers[0]!.hearts).toBe(1);
    expect(r.stats.b?.rescues).toBe(1);
    expect(r.steps).toContainEqual({ t: "up", who: "a", by: "b" });
  });
});

describe("ruins", () => {
  const A = (approach: 0 | 1 | "force", way?: "careful" | "bold"): Plan => [{ kind: "act", at: "1,0", approach, way }, G];
  it("pass gives the stone; bold adds noise on your tile", () => {
    const w = ruinWorld();
    const r = run(w, { a: A(0, "bold") }, seq(...pass));
    expect(w.stones).toEqual(["shrine"]);
    expect(r.steps).toContainEqual({ t: "stone", who: "a", ruin: "shrine", how: "roll" });
    expect(w.tiles["0,0"]!.noise).toBe(1);
  });
  it("fail costs then half; half opens with no roll for anyone", () => {
    const w = ruinWorld();
    const r = run(w, { a: A(1) }, seq(...fail));
    expect(w.explorers[0]!.hearts).toBe(2); expect(w.half).toEqual(["shrine"]);
    expect(r.steps.some((s) => s.t === "half")).toBe(true);
    const r2 = run(w, { b: A(0) }, seq(...fail));
    expect(r2.steps.some((s) => s.t === "roll")).toBe(false);
    expect(r2.steps).toContainEqual({ t: "stone", who: "b", ruin: "shrine", how: "half" });
    expect(w.stones).toEqual(["shrine"]);
  });
  it("careful lowers the cost", () => {
    const w = ruinWorld();
    run(w, { a: A(1, "careful") }, seq(...fail));
    expect(w.explorers[0]!.hearts).toBe(3); expect(w.tiles["1,0"]!.noise).toBe(1);
  });
  it("force adds sun and noise", () => {
    const w = ruinWorld();
    run(w, { a: A("force") });
    expect(w.sun).toBe(1); expect(w.tiles["1,0"]!.noise).toBe(3); expect(w.stones).toEqual(["shrine"]);
  });
  it("two acts on one ruin: the second is Guard", () => {
    const w = ruinWorld();
    const r = run(w, { a: A("force"), b: A(0) });
    expect(guards(r.steps).some((g) => g.who === "b" && g.why === "Someone got the key stone first.")).toBe(true);
  });
});

describe("items and caches", () => {
  it("torch scares the spider and lights its forest", () => {
    const w = blankWorld({ "1,0": "forest" }, { explorers: [ex("a", "0,0")], spider: "1,0" });
    w.explorers[0]!.items = ["torch"];
    const r = run(w, { a: [{ kind: "item", item: "torch", at: "1,0" }, G] });
    expect(w.tiles["1,0"]!.fire).toBeGreaterThan(0);
    expect(w.spider.tile).not.toBe("1,0");
    expect(r.stats.a?.firesLit).toBe(1);
    expect(w.explorers[0]!.items).toEqual(["torch"]);
  });
  it("torch at the cap counts nothing", () => {
    const w = blankWorld({ "1,0": "forest", "-3,0": "forest", "-3,1": "forest", "-3,2": "forest", "-3,3": "forest", "-2,-1": "forest" }, { explorers: [ex("a", "0,0")] });
    for (const t of ["-3,0", "-3,1", "-3,2", "-3,3", "-2,-1"]) light(w, t, null, []);
    w.explorers[0]!.items = ["torch"];
    const r = run(w, { a: [{ kind: "item", item: "torch", at: "1,0" }, G] });
    expect(w.tiles["1,0"]!.fire).toBe(0);
    expect(r.stats.a?.firesLit).toBeUndefined();
  });
  it("planks, medkit, lure", () => {
    const w = blankWorld({ "1,0": "river" }, { explorers: [ex("a", "0,0"), ex("b", "0,1", "runner")], });
    w.explorers[0]!.items = ["planks", "lure"]; w.explorers[1]!.hearts = 2; w.explorers[1]!.items = ["medkit"];
    run(w, { a: [{ kind: "item", item: "planks", at: "1,0" }, { kind: "item", item: "lure", at: "-2,0" }], b: [{ kind: "item", item: "medkit", who: "b" }, G] });
    expect(w.tiles["1,0"]!.terrain).toBe("bridge");
    expect(w.tiles["-2,0"]!.noise).toBe(3);
    expect(w.explorers[0]!.items).toEqual([]);
    expect(w.explorers[1]!.hearts).toBe(3);
  });
  it("two cache acts: the second is empty; full bag guards", () => {
    const w = blankWorld({}, { explorers: [ex("a", "0,0"), ex("b", "0,0")], tiles: { "1,0": { cache: true } } });
    const r = run(w, { a: [{ kind: "act", at: "1,0" }, G], b: [{ kind: "act", at: "1,0" }, G] }, seq(0));
    expect(w.explorers[0]!.items).toEqual(["planks"]);
    expect(guards(r.steps).some((g) => g.who === "b" && g.why === "The cache is empty.")).toBe(true);
    const w2 = blankWorld({}, { explorers: [{ ...ex("a", "0,0"), items: ["torch", "lure"] }], tiles: { "1,0": { cache: true } } });
    const r2 = run(w2, { a: [{ kind: "act", at: "1,0" }, G] });
    expect(guards(r2.steps)[0]!.why).toBe("Your bag is full."); expect(w2.tiles["1,0"]!.cache).toBe(true);
  });
  it("planks and a fixer on one bridge: the second is Guard", () => {
    const w = blankWorld({ "1,0": "broken" }, { explorers: [{ ...ex("a", "0,0", "fixer") }, { ...ex("b", "0,0"), items: ["planks"] }] });
    w.explorers[1]!.items = ["planks"];
    const r = run(w, { a: [{ kind: "act", at: "1,0" }, G], b: [{ kind: "item", item: "planks", at: "1,0" }, G] });
    expect(guards(r.steps).some((g) => g.who === "b" && g.why === "The bridge is already fixed.")).toBe(true);
    expect(w.explorers[1]!.items).toEqual(["planks"]);
  });
});

describe("guard", () => {
  const fail1: Plan = [{ kind: "act", at: "1,0", approach: 1 }, G];
  it("blocks 1; twice still blocks 1", () => {
    const w = ruinWorld();
    const r = run(w, { a: [G, G] , b: fail1 });
    expect(w.explorers[0]!.shield).toBe(true);
    const w2 = blankWorld({}, { explorers: [ex("a", "0,0", "runner")], tiles: { "1,0": { ruin: "shrine" } } });
    const r2 = run(w2, { a: [G, { kind: "act", at: "1,0", approach: 1 }] }, seq(...fail));
    expect(w2.explorers[0]!.hearts).toBe(3);
    expect(r2.steps).toContainEqual({ t: "damage", who: "a", by: "ruin", blocked: true });
    void r;
  });
  it("protector covers allies on their tile", () => {
    const w = blankWorld({}, { explorers: [ex("a", "0,0", "protector"), ex("b", "0,0"), ex("c", "1,0")] });
    run(w, { a: [G, G], c: [{ kind: "look" }, { kind: "look" }] });
    expect(w.explorers.map((e) => e.shield)).toEqual([true, true, false]);
  });
});

describe("going down", () => {
  it("a player hurt to 0 in beat 1 plays no beat 2 card; a help gets them up but they stay out", () => {
    const w = ruinWorld();
    w.explorers[0]!.hearts = 1;
    const r = run(w, {
      a: [{ kind: "act", at: "1,0", approach: 1 }, { kind: "move", to: "-1,0" }],
      b: [G, { kind: "help", who: "a" }],
    }, seq(...fail));
    expect(w.explorers[0]!.tile).toBe("0,0");
    expect(w.explorers[0]!.down).toBe(false);
    expect(r.steps.filter((s) => s.t === "move")).toEqual([]);
  });
});

describe("planProblem", () => {
  const w = blankWorld({}, { explorers: [ex("a", "0,0"), ex("b", "0,0")], tiles: { "1,0": { ruin: "cave" } } });
  it("flags bad cards", () => {
    expect(planProblem(w, "a", { kind: "help", who: "a" })).not.toBeNull();
    expect(planProblem(w, "a", { kind: "help", who: "zz" })).not.toBeNull();
    expect(planProblem(w, "a", { kind: "help", who: "b" })).toBeNull();
    expect(planProblem(w, "a", { kind: "item", item: "torch", at: "1,0" })).not.toBeNull();
    expect(planProblem(w, "a", { kind: "act", at: "0,1", approach: 0 })).not.toBeNull();
    expect(planProblem(w, "a", { kind: "act", at: "1,0", approach: 0 })).toBeNull();
    expect(planProblem(w, "a", { kind: "move", to: "9,9" })).not.toBeNull();
    expect(planProblem(w, "a", { kind: "nope" } as unknown as Card)).not.toBeNull();
  });
});
