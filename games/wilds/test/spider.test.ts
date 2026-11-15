import { describe, expect, it } from "vitest";
import { distance } from "../shared/hex.ts";
import { moveSpider, scare, spiderPlan } from "../server/spider.ts";
import { light } from "../server/fire.ts";
import { addNoise } from "../server/world.ts";
import type { Step } from "../shared/types.ts";
import { blankWorld } from "./helpers.ts";

const ex = (id: string, tile: string) => ({ id, tile, role: "runner" as const });

describe("spider plan", () => {
  it("still and rest do nothing", () => {
    const w = blankWorld({}, { explorers: [ex("a", "2,0")] });
    w.spider.still = true;
    expect(spiderPlan(w)).toEqual({ path: ["3,0"], why: "still", bites: [] });
    w.spider.still = false;
    w.spider.rest = true;
    expect(spiderPlan(w).why).toBe("rest");
  });

  it("goes to the loudest noise within 4, ties to the nearest then lower index", () => {
    const w = blankWorld({}, { spider: "0,0" });
    addNoise(w, "2,0", 2, []);
    addNoise(w, "-3,0", 3, []);
    expect(spiderPlan(w)).toMatchObject({ why: "noise", path: ["0,0", "-1,0", "-2,0"] });
    const t = blankWorld({}, { spider: "0,0" });
    addNoise(t, "0,2", 2, []); // distance 2
    addNoise(t, "2,0", 2, []); // same distance: "2,0" has the lower index
    expect(spiderPlan(t).path.at(-1)).toBe("2,0");
    const far = blankWorld({}, { spider: "-3,0" });
    addNoise(far, "2,0", 3, []); // too far (5)
    expect(spiderPlan(far).why).toBe("home");
  });

  it("hunts the nearest explorer within 2, lower seat on a tie, and stops next to them", () => {
    const w = blankWorld({}, { spider: "0,0", nest: "0,0", explorers: [ex("a", "0,2"), ex("b", "2,0")] });
    const p = spiderPlan(w);
    expect(p.why).toBe("hunt");
    expect(p.path[0]).toBe("0,0");
    expect(p.path.at(-1)).toBe("0,1"); // toward a (seat 0), next to a
    expect(p.path).toHaveLength(2);
    expect(p.bites).toEqual(["a"]);
  });

  it("goes home one step", () => {
    const w = blankWorld({}, { spider: "0,0", nest: "-2,0" });
    expect(spiderPlan(w)).toMatchObject({ why: "home", path: ["0,0", "-1,0"] });
  });

  it("is scared next to fire, moves away, no bites, then rests", () => {
    const w = blankWorld({ "1,0": "forest" }, { spider: "0,0", nest: "0,0", explorers: [ex("a", "-1,1")] });
    light(w, "1,0", null, []);
    const p = spiderPlan(w);
    expect(p.why).toBe("scared");
    expect(p.bites).toEqual([]);
    expect(p.path).toHaveLength(3);
    const s: Step[] = [];
    moveSpider(w, s);
    expect(w.spider.rest).toBe(true);
    expect(w.explorers[0]!.hearts).toBe(3);
    expect(spiderPlan(w).why).toBe("rest");
    moveSpider(w, []);
    expect(w.spider.rest).toBe(false);
    expect(spiderPlan(w).why).not.toBe("rest");
  });

  it("reeds do not stop it", () => {
    const u = blankWorld({ "1,0": "river", "0,1": "rock", "0,-1": "reeds" }, { spider: "0,0", nest: "0,-2" });
    expect(spiderPlan(u).path).toEqual(["0,0", "0,-1"]);
  });

  describe("never enters an obstacle on the direct route", () => {
    // Noise at the far end of a straight line; the middle tile is the obstacle.
    const detour = (w: ReturnType<typeof blankWorld>, from: string, to: string, bad: string) => {
      addNoise(w, to, 3, []);
      const p = spiderPlan(w);
      expect(p.why).toBe("noise");
      expect(p.path).not.toContain(bad);
      expect(p.path[0]).toBe(from);
      expect(p.path.length).toBeGreaterThan(1); // it detours, it does not give up
      for (let i = 1; i < p.path.length; i++) expect(distance(p.path[i - 1]!, p.path[i]!)).toBe(1);
      return p;
    };

    for (const terrain of ["river", "rock", "broken"] as const) {
      it(terrain, () => {
        const w = blankWorld({ "1,0": terrain }, { spider: "0,0" });
        const p = detour(w, "0,0", "2,0", "1,0");
        expect(p.path).toHaveLength(3); // full 2 steps along the detour
      });
    }

    it("burning tile", () => {
      const w = blankWorld({ "0,0": "forest" }, { spider: "-2,0", nest: "3,0" });
      light(w, "0,0", null, []);
      const p = detour(w, "-2,0", "2,0", "0,0");
      expect(p.path).toHaveLength(3);
    });

    it("explorer tile", () => {
      const w = blankWorld({}, { spider: "0,0", explorers: [ex("a", "1,0")] });
      const p = detour(w, "0,0", "2,0", "1,0");
      expect(p.path).toHaveLength(2); // stops next to the explorer
    });

    it("down explorer tile", () => {
      const w = blankWorld({}, { spider: "0,0", explorers: [ex("a", "1,0")] });
      w.explorers[0]!.down = true;
      const p = detour(w, "0,0", "2,0", "1,0");
      expect(p.path).toHaveLength(3);
    });
  });

  it("bites everyone on or next to its tile; shield blocks; down explorers are ignored", () => {
    const w = blankWorld({}, {
      spider: "0,0", nest: "0,0",
      explorers: [ex("a", "0,1"), ex("b", "-1,1"), ex("c", "1,-1"), ex("d", "-2,1")],
    });
    w.explorers[1]!.shield = true;
    w.explorers[2]!.down = true;
    const s: Step[] = [];
    moveSpider(w, s);
    expect(w.spider.tile).toBe("0,0");
    const dmg = s.filter((x) => x.t === "damage");
    expect(dmg).toEqual([
      { t: "damage", who: "a", by: "spider", blocked: false },
      { t: "damage", who: "b", by: "spider", blocked: true },
    ]);
    expect(w.explorers[2]!.hearts).toBe(3);
    expect(w.explorers[1]!.shield).toBe(false);
  });

  it("goes down at 0 hearts", () => {
    const w = blankWorld({}, { spider: "0,0", nest: "0,0", explorers: [ex("a", "0,1")] });
    w.explorers[0]!.hearts = 1;
    const s: Step[] = [];
    moveSpider(w, s);
    expect(w.explorers[0]).toMatchObject({ hearts: 0, down: true });
    expect(s.some((x) => x.t === "down")).toBe(true);
  });

  it("walled in by river and fire stays put without throwing", () => {
    const m: Record<string, "river" | "forest"> = {};
    for (const t of ["1,0", "1,-1", "0,-1"]) m[t] = "river";
    for (const t of ["-1,0", "-1,1", "0,1"]) m[t] = "forest";
    const w = blankWorld(m, { spider: "0,0", nest: "3,0" });
    for (const t of ["-1,0", "-1,1", "0,1"]) light(w, t, null, []);
    // not scared-flee-capable, and fire adjacent
    expect(spiderPlan(w).path).toEqual(["0,0"]);
    expect(() => moveSpider(w, [])).not.toThrow();
    const v = blankWorld({ "1,0": "river", "1,-1": "river", "0,-1": "river", "-1,0": "river", "-1,1": "river", "0,1": "river" },
      { spider: "0,0", nest: "3,0" });
    expect(spiderPlan(v).path).toEqual(["0,0"]);
    expect(() => moveSpider(v, [])).not.toThrow();
  });

  it("scare with nowhere to run stays and rests", () => {
    const m: Record<string, "river"> = {};
    for (const t of ["1,0", "1,-1", "0,-1", "-1,0", "-1,1", "0,1"]) m[t] = "river";
    const w = blankWorld(m, { spider: "0,0" });
    const s: Step[] = [];
    scare(w, "2,0", s);
    expect(w.spider.tile).toBe("0,0");
    expect(w.spider.rest).toBe(true);
    expect(spiderPlan(w).why).toBe("rest");
  });

  it("scare runs away from the torch", () => {
    const w = blankWorld({}, { spider: "0,0" });
    scare(w, "1,0", []);
    expect(w.spider.tile).toBe("0,-2");
    expect(w.spider.rest).toBe(true);
  });

  it("spiderPlan does not change the world", () => {
    const w = blankWorld({ "1,0": "forest" }, { spider: "0,0", explorers: [ex("a", "0,2")] });
    addNoise(w, "2,0", 1, []);
    const before = structuredClone(w);
    spiderPlan(w);
    expect(w).toEqual(before);
  });
});
