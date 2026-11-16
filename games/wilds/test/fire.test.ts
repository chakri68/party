import { describe, expect, it } from "vitest";
import { seededRandomInt } from "@games/game-core";
import { burnDown, burning, light, rainOut, spreadFire } from "../server/fire.ts";
import type { Step } from "../shared/types.ts";
import { blankWorld } from "./helpers.ts";

describe("fire", () => {
  it("lights only forest or bridge", () => {
    const w = blankWorld({ "0,0": "forest" });
    const s: Step[] = [];
    expect(light(w, "1,0", null, s)).toBe(false);
    expect(light(w, "0,0", "a", s)).toBe(true);
    expect(w.tiles["0,0"]!.fire).toBe(2);
    expect(light(w, "0,0", "a", s)).toBe(false);
    expect(s).toEqual([{ t: "lit", tile: "0,0", by: "a" }]);
  });

  it("stops at the cap with fire-full", () => {
    const m: Record<string, "forest"> = {};
    for (const t of ["0,0", "1,0", "2,0", "0,1", "-1,1", "-1,0"]) m[t] = "forest";
    const w = blankWorld(m);
    const s: Step[] = [];
    for (const t of ["0,0", "1,0", "2,0", "0,1", "-1,1"]) expect(light(w, t, null, s)).toBe(true);
    const s2: Step[] = [];
    expect(light(w, "-1,0", null, s2)).toBe(false);
    expect(s2).toEqual([{ t: "fire-full" }]);
  });

  it("spreads to exactly one neighbour per burning tile", () => {
    const w = blankWorld({ "0,0": "forest", "1,0": "forest", "0,1": "forest", "-1,0": "forest" });
    light(w, "0,0", null, []);
    spreadFire(w, seededRandomInt(1), []);
    expect(burning(w)).toHaveLength(2);
    const lit = burning(w).filter((t) => w.tiles[t]!.litThisTurn);
    expect(lit).toHaveLength(1);
    // litThisTurn blocks burnDown, but a second pass spreads from it.
    burnDown(w, []);
    expect(w.tiles[lit[0]!]!.fire).toBe(2);
    expect(w.tiles["0,0"]!.fire).toBe(1);
    spreadFire(w, seededRandomInt(2), []);
    expect(burning(w).length).toBeGreaterThanOrEqual(3);
  });

  it("burns forest to ash and a bridge to broken", () => {
    const w = blankWorld({ "0,0": "forest", "1,0": "bridge" });
    light(w, "0,0", null, []);
    light(w, "1,0", null, []);
    const s: Step[] = [];
    burnDown(w, s);
    expect(w.tiles["0,0"]!.terrain).toBe("forest");
    burnDown(w, s);
    expect(w.tiles["0,0"]!.terrain).toBe("ash");
    expect(w.tiles["1,0"]!.terrain).toBe("broken");
    expect(s.filter((x) => x.t === "burnt")).toHaveLength(2);
    expect(burning(w)).toEqual([]);
  });

  it("rain puts fire out and leaves terrain", () => {
    const w = blankWorld({ "0,0": "forest" });
    light(w, "0,0", null, []);
    const s: Step[] = [];
    rainOut(w, s);
    expect(w.tiles["0,0"]!.fire).toBe(0);
    expect(w.tiles["0,0"]!.terrain).toBe("forest");
    expect(s).toEqual([{ t: "out", tiles: ["0,0"] }]);
  });
});
