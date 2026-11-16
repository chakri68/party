import { describe, expect, it } from "vitest";
import { islandTurn } from "../server/island.ts";
import type { LiveEvent, PendingBargain, Step, Terrain, World } from "../shared/types.ts";
import { blankWorld } from "./helpers.ts";

const seq = (...v: number[]) => { let i = 0; return (_n: number) => v[i++ % v.length]!; };
const quiet: LiveEvent = { id: "quiet-morning", tiles: [] };
function turn(w: World, ev: LiveEvent = quiet, option: number | null = null, pending: PendingBargain | null = null) {
  const steps: Step[] = [];
  const r = islandTurn(w, ev, option, pending, seq(0), steps);
  return { ...r, steps };
}
const at = (steps: Step[], t: Step["t"]) => steps.findIndex((s) => s.t === t);
const ex = (id: string, tile: string) => ({ id, tile });

describe("the island turn", () => {
  it("lands the stone hand's noise when it is due, then forgets it", () => {
    const w = blankWorld({ "-3,0": "bridge" }, { explorers: [ex("a", "-3,3")] });
    w.round = 3;
    const r = turn(w, quiet, null, { tile: "-3,0", due: 3 });
    expect(r.pending).toBeNull();
    expect(w.tiles["-3,0"]!.noise).toBe(2); // 3, then down by 1 at step 5
    const early = turn(blankWorld({}, { explorers: [ex("a", "-3,3")] }), quiet, null, { tile: "-3,0", due: 4 });
    expect(early.pending).toEqual({ tile: "-3,0", due: 4 });
  });

  it("step 1: a Rotten bridge with an explorer on it does not break", () => {
    const w = blankWorld({ "-1,0": "bridge" }, { explorers: [ex("a", "-1,0")] });
    turn(w, { id: "rotten-bridge", tiles: ["-1,0"] });
    expect(w.tiles["-1,0"]!.terrain).toBe("bridge");
    const empty = blankWorld({ "-1,0": "bridge" }, { explorers: [ex("a", "-3,3")] });
    turn(empty, { id: "rotten-bridge", tiles: ["-1,0"] });
    expect(empty.tiles["-1,0"]!.terrain).toBe("broken");
  });

  it("step 2: fire lit in the beats spreads, and the spider moves after it", () => {
    // Fire on 1,0. Its only forest neighbour is 2,0, next to the spider on 3,0.
    const w = blankWorld({ "1,0": "forest", "2,0": "forest" }, { explorers: [ex("a", "-3,3")], tiles: { "1,0": { fire: 2 } } });
    const r = turn(w, { id: "old-camp", tiles: [] }); // no hidden cache: nothing happens, and the spider may move
    expect(w.tiles["2,0"]!.fire).toBeGreaterThan(0);
    expect(at(r.steps, "lit")).toBeGreaterThan(at(r.steps, "event"));
    // The spread put fire next to the spider before it moved: it ran.
    const spider = r.steps.find((s) => s.t === "spider") as Extract<Step, { t: "spider" }>;
    expect(spider.why).toBe("scared");
    expect(at(r.steps, "spider")).toBeGreaterThan(at(r.steps, "lit"));
  });

  it("dry wind spreads the fire two times", () => {
    const map: Partial<Record<string, Terrain>> = { "-3,0": "forest", "-2,0": "forest", "-1,0": "forest" };
    const w = blankWorld(map, { explorers: [ex("a", "-3,3")], tiles: { "-3,0": { fire: 2 } } });
    turn(w, { id: "dry-wind", tiles: [] });
    expect(w.tiles["-1,0"]!.fire).toBeGreaterThan(0);
    const once = blankWorld(map, { explorers: [ex("a", "-3,3")], tiles: { "-3,0": { fire: 2 } } });
    turn(once);
    expect(once.tiles["-1,0"]!.fire).toBe(0);
  });

  it("step 4: fire hurts after the spider, and a Guard blocks it", () => {
    const w = blankWorld({ "-2,0": "forest" }, { explorers: [ex("a", "-2,0"), ex("b", "-2,0")], tiles: { "-2,0": { fire: 2 } } });
    w.explorers[1]!.shield = true;
    const r = turn(w);
    expect(w.explorers[0]!.hearts).toBe(2);
    expect(w.explorers[1]!.hearts).toBe(3);
    const hits = r.steps.filter((s) => s.t === "damage");
    expect(hits).toEqual([
      { t: "damage", who: "a", by: "fire", blocked: false },
      { t: "damage", who: "b", by: "fire", blocked: true },
    ]);
    expect(at(r.steps, "damage")).toBeGreaterThan(at(r.steps, "spider"));
  });

  it("step 5: noise goes down by 1", () => {
    const w = blankWorld({}, { explorers: [ex("a", "-3,3")], tiles: { "-3,0": { noise: 2 }, "-2,0": { noise: 1 } } });
    turn(w);
    expect(w.tiles["-3,0"]!.noise).toBe(1);
    expect(w.tiles["-2,0"]!.noise).toBe(0);
  });

  it("clears shields, new fire marks, the speed bonus and the still spider", () => {
    // The explorer is in the spider's noise range (so Hungry spider applies), out of its hunt range.
    const w = blankWorld({ "-3,0": "forest", "-2,0": "forest" }, { explorers: [ex("a", "0,0")], tiles: { "-3,0": { fire: 2 } } });
    w.explorers[0]!.shield = true;
    const r = turn(w, { id: "hungry-spider", tiles: [] });
    expect(r.steps).toContainEqual({ t: "event", id: "hungry-spider", option: null, nothing: false });
    expect(w.explorers[0]!.shield).toBe(false);
    expect(w.speedBonus).toBe(0);
    expect(w.spider.still).toBe(false);
    expect(w.order.some((t) => w.tiles[t]!.litThisTurn)).toBe(false);
  });
});

describe("win and lose", () => {
  const gateWorld = () => {
    const w = blankWorld({ "0,0": "gate" }, { explorers: [ex("a", "0,0"), ex("b", "1,0")] });
    w.gateOpen = true;
    w.stones = ["shrine", "tower", "cave"];
    return w;
  };

  it("wins with everyone on the gate or next to it", () => {
    expect(turn(gateWorld()).result).toBe("win");
    const far = gateWorld();
    far.explorers[1]!.tile = "2,0";
    expect(turn(far).result).toBeNull();
    const shut = gateWorld();
    shut.gateOpen = false;
    expect(turn(shut).result).toBeNull();
  });

  it("a win on the last round is a win: the check comes before the sun", () => {
    const w = gateWorld();
    w.round = 10; w.sun = 9;
    expect(turn(w).result).toBe("win");
    const lost = gateWorld();
    lost.round = 10; lost.sun = 9;
    lost.explorers[1]!.tile = "-3,3";
    expect(turn(lost).result).toBe("sun");
    expect(lost.sun).toBe(10);
  });

  it("Force pushing the sun to the limit in the beats still lets the win check run", () => {
    const w = gateWorld();
    w.round = 9; w.sun = 10; // Force moved it on during the beats
    expect(turn(w).result).toBe("win");
  });

  it("a down player must be brought back up first", () => {
    const w = gateWorld();
    w.explorers[1]!.down = true; w.explorers[1]!.hearts = 0;
    expect(turn(w).result).toBeNull();
  });

  it("a player who left is not waited for", () => {
    const w = gateWorld();
    w.explorers[1]!.left = true; w.explorers[1]!.tile = "-3,3";
    expect(turn(w).result).toBe("win");
  });

  it("loses when everyone is down at the end of the round", () => {
    const w = blankWorld({}, { explorers: [ex("a", "-3,3"), ex("b", "-3,3")] });
    for (const e of w.explorers) { e.down = true; e.hearts = 0; }
    expect(turn(w).result).toBe("down");
    const one = blankWorld({}, { explorers: [ex("a", "-3,3"), ex("b", "-3,3")] });
    one.explorers[0]!.down = true;
    expect(turn(one).result).toBeNull();
  });

  it("the sun moves on by 1 each round", () => {
    const w = blankWorld({}, { explorers: [ex("a", "-3,3")] });
    w.sun = 4;
    expect(turn(w).result).toBeNull();
    expect(w.sun).toBe(5);
  });
});
