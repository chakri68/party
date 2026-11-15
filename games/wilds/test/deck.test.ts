import { describe, expect, it } from "vitest";
import { seededRandomInt } from "@games/game-core";
import { EVENTS } from "../shared/events.ts";
import type { EventId, Step } from "../shared/types.ts";
import { applyEvent, canApply, draw, newDeck, pickTiles } from "../server/deck.ts";
import { blankWorld } from "./helpers.ts";

const ids = Object.keys(EVENTS) as EventId[];
const run = (w: ReturnType<typeof blankWorld>, id: EventId, option: number | null, tiles?: string[], seed = 1) => {
  const steps: Step[] = [];
  const rnd = seededRandomInt(seed);
  const p = applyEvent(w, { id, tiles: tiles ?? pickTiles(w, id, rnd) }, option, null, rnd, steps);
  return { steps, p };
};

describe("deck", () => {
  it("has 12 cards with plain copy", () => {
    expect(ids).toHaveLength(12);
    for (const id of ids) expect(EVENTS[id].title.split(" ").length).toBeLessThanOrEqual(3 + 1);
  });

  it("draws only calm cards in rounds 1 and 2", () => {
    for (let seed = 1; seed <= 50; seed++) {
      const rnd = seededRandomInt(seed);
      const w = blankWorld({}, { explorers: [{ id: "a", tile: "2,0" }] });
      const deck = newDeck(rnd);
      for (const round of [1, 2]) expect(EVENTS[draw(deck, w, round, null, null, rnd)].kind).toBe("calm");
    }
  });

  it("never draws harm after harm, or a bargain while one waits", () => {
    for (let seed = 1; seed <= 50; seed++) {
      const rnd = seededRandomInt(seed);
      const w = blankWorld({ "1,0": "bridge", "0,1": "broken", "-1,0": "reeds" }, { explorers: [{ id: "a", tile: "2,0" }] });
      w.explorers[0]!.hearts = 1;
      w.tiles["0,0"]!.fire = 2;
      const deck = newDeck(rnd);
      let last = "";
      for (let r = 3; r < 20; r++) {
        const id = draw(deck, w, r, { tile: "0,1", due: 9 }, null, rnd);
        const k = EVENTS[id].kind;
        expect(k).not.toBe("bargain");
        if (last === "harm") expect(k).not.toBe("harm");
        last = k;
      }
    }
  });

  it("removes the drawn card, skips the current one and refills", () => {
    const rnd = seededRandomInt(3);
    const w = blankWorld();
    const deck = newDeck(rnd);
    const id = draw(deck, w, 1, null, null, rnd);
    expect(deck.pile).not.toContain(id);
    expect(deck.pile).toHaveLength(11);
    deck.pile = [];
    expect(draw(deck, w, 1, null, id, rnd)).not.toBe(id);
    expect(deck.pile.length).toBeGreaterThan(5);
  });

  it("falls back to quiet-morning", () => {
    const rnd = seededRandomInt(1);
    const w = blankWorld();
    const deck = { pile: ["rain" as EventId], lastKind: null };
    expect(draw(deck, w, 1, null, null, rnd)).toBe("quiet-morning");
    expect(deck.pile).toEqual(["rain"]);
  });

  it("canApply", () => {
    const w = blankWorld({}, { explorers: [{ id: "a", tile: "0,0" }] });
    expect(canApply(w, "rain", null)).toBe(false);
    expect(canApply(w, "rotten-bridge", null)).toBe(false);
    expect(canApply(w, "stone-hand", null)).toBe(false);
    expect(canApply(w, "warm-spring", null)).toBe(false);
    expect(canApply(w, "old-camp", null)).toBe(false);
    w.tiles["1,0"]!.terrain = "forest";
    w.tiles["1,0"]!.fire = 2;
    w.tiles["0,1"]!.terrain = "bridge";
    w.tiles["-1,1"]!.terrain = "broken";
    w.explorers[0]!.hearts = 2;
    expect(canApply(w, "rain", null)).toBe(true);
    expect(canApply(w, "dry-wind", null)).toBe(true);
    expect(canApply(w, "rotten-bridge", null)).toBe(true);
    expect(canApply(w, "stone-hand", null)).toBe(true);
    expect(canApply(w, "warm-spring", null)).toBe(true);
    expect(canApply(w, "stone-hand", { tile: "x", due: 5 })).toBe(false);
  });

  it("bridge and reeds events need an open tile, and mark only open ones", () => {
    const rnd = seededRandomInt(1);
    const w = blankWorld({ "1,0": "bridge", "0,1": "broken", "-1,0": "reeds" }, { explorers: [{ id: "a", tile: "2,0" }] });
    for (const t of ["1,0", "0,1", "-1,0"]) w.tiles[t]!.open = false;
    expect(canApply(w, "rotten-bridge", null)).toBe(false);
    expect(canApply(w, "echo-reeds", null)).toBe(false);
    expect(canApply(w, "stone-hand", null)).toBe(false);
    // A second of each, in the open.
    w.tiles["-2,0"]!.terrain = "bridge";
    w.tiles["-2,1"]!.terrain = "broken";
    w.tiles["-3,0"]!.terrain = "reeds";
    expect(canApply(w, "rotten-bridge", null)).toBe(true);
    expect(canApply(w, "echo-reeds", null)).toBe(true);
    expect(canApply(w, "stone-hand", null)).toBe(true);
    for (let i = 0; i < 20; i++) {
      expect(pickTiles(w, "rotten-bridge", rnd)).toEqual(["-2,0"]);
      expect(pickTiles(w, "echo-reeds", rnd)).toEqual(["-3,0"]);
      expect(pickTiles(w, "stone-hand", rnd)).toEqual(["-2,1"]);
    }
  });

  it("a bargain does nothing while another one waits", () => {
    const w = blankWorld({ "1,0": "broken" }, { explorers: [{ id: "a", tile: "0,0" }] });
    const steps: Step[] = [];
    const p = applyEvent(w, { id: "stone-hand", tiles: ["1,0"] }, 0, { tile: "0,1", due: 9 }, seededRandomInt(1), steps);
    expect(p).toBeNull();
    expect(steps).toEqual([{ t: "event", id: "stone-hand", option: 0, nothing: true }]);
    expect(w.tiles["1,0"]!.terrain).toBe("broken");
  });

  it("rotten bridge breaks, unless an explorer stands on it", () => {
    const w = blankWorld({ "1,0": "bridge" }, { explorers: [{ id: "a", tile: "0,0" }] });
    run(w, "rotten-bridge", null, ["1,0"]);
    expect(w.tiles["1,0"]!.terrain).toBe("broken");
    const w2 = blankWorld({ "1,0": "bridge" }, { explorers: [{ id: "a", tile: "1,0" }] });
    run(w2, "rotten-bridge", null, ["1,0"]);
    expect(w2.tiles["1,0"]!.terrain).toBe("bridge");
  });

  it("falling rocks hurt only that tile, and a Guard blocks it", () => {
    const w = blankWorld({}, { explorers: [{ id: "a", tile: "1,0" }, { id: "b", tile: "0,0" }, { id: "c", tile: "-1,0" }] });
    w.explorers[2]!.tile = "1,0";
    w.explorers[2]!.shield = true;
    const picked = pickTiles(w, "falling-rocks", seededRandomInt(2));
    expect(picked).toHaveLength(1);
    run(w, "falling-rocks", null, ["1,0"]);
    expect(w.explorers.map((e) => e.hearts)).toEqual([2, 3, 3]);
    expect(w.explorers[2]!.shield).toBe(false);
  });

  it("falling rocks land next to an explorer", () => {
    const w = blankWorld({}, { explorers: [{ id: "a", tile: "0,0" }] });
    const t = pickTiles(w, "falling-rocks", seededRandomInt(5))[0]!;
    expect(["1,0", "-1,0", "0,1", "0,-1", "1,-1", "-1,1"]).toContain(t);
  });

  it("echo, camp, birds, rain, quiet, hungry", () => {
    const w = blankWorld({ "1,0": "reeds" }, { explorers: [{ id: "a", tile: "0,0" }] });
    run(w, "echo-reeds", null, ["1,0"]);
    expect(w.tiles["1,0"]!.noise).toBe(2);
    w.tiles["3,0"]!.fire = 1;
    run(w, "rain", null);
    expect(w.tiles["3,0"]!.fire).toBe(0);
    run(w, "quiet-morning", null);
    expect(w.spider.still).toBe(true);
    run(w, "hungry-spider", null);
    expect(w.speedBonus).toBe(1);

    const c = blankWorld({}, { explorers: [{ id: "a", tile: "0,0" }] });
    for (const t of Object.values(c.tiles)) t.open = false;
    c.tiles["0,0"]!.open = true;
    c.tiles["-3,3"]!.cache = true;
    const picked = pickTiles(c, "old-camp", seededRandomInt(1));
    expect(picked).toEqual(["-3,3"]);
    run(c, "old-camp", null, picked);
    expect(c.tiles["-3,3"]!.open && c.tiles["-2,2"]!.open).toBe(true);
    const b = pickTiles(c, "bird-calls", seededRandomInt(1));
    expect(b).toHaveLength(3);
    run(c, "bird-calls", null, b);
    for (const t of b) expect(c.tiles[t]!.open).toBe(true);
  });

  it("clear sky opens by choice", () => {
    const w = blankWorld({ "0,0": "gate", "3,-3": "ruin" }, { explorers: [{ id: "a", tile: "2,-2" }] });
    w.tiles["3,-3"]!.ruin = "tower";
    for (const t of Object.values(w.tiles)) t.open = false;
    const tiles = pickTiles(w, "clear-sky", seededRandomInt(1));
    expect(tiles).toEqual(["0,0", "3,-3"]);
    const w2 = structuredClone(w);
    run(w, "clear-sky", 1, tiles);
    expect(w.tiles["3,-3"]!.open).toBe(true);
    expect(w.tiles["0,0"]!.open).toBe(false);
    run(w2, "clear-sky", 0, tiles);
    expect(w2.tiles["0,0"]!.open).toBe(true);
  });

  it("stone hand accept fixes every broken bridge and returns a bargain", () => {
    const mk = () => blankWorld({ "1,0": "broken", "0,1": "broken" }, { explorers: [{ id: "a", tile: "0,0" }] });
    const w = mk();
    w.round = 4;
    const { p } = run(w, "stone-hand", 0, ["1,0"]);
    expect(w.tiles["1,0"]!.terrain).toBe("bridge");
    expect(w.tiles["0,1"]!.terrain).toBe("bridge");
    expect(p).toEqual({ tile: "1,0", due: 6 });
    const r = mk();
    expect(run(r, "stone-hand", 1, ["1,0"]).p).toBeNull();
    expect(r.tiles["1,0"]!.terrain).toBe("broken");
    expect(run(mk(), "stone-hand", null, ["1,0"]).p).toBeNull();
  });

  it("warm spring accept heals, raises the down and moves the sun", () => {
    const mk = () => {
      const w = blankWorld({}, { explorers: [{ id: "a", tile: "0,0" }, { id: "b", tile: "1,0" }, { id: "c", tile: "2,0" }] });
      w.explorers[0]!.hearts = 2;
      w.explorers[1]!.hearts = 0;
      w.explorers[1]!.down = true;
      return w;
    };
    const w = mk();
    run(w, "warm-spring", 0);
    expect(w.explorers.map((e) => e.hearts)).toEqual([3, 1, 3]);
    expect(w.explorers[1]!.down).toBe(false);
    expect(w.sun).toBe(1);
    const r = mk();
    run(r, "warm-spring", 1);
    expect(r.sun).toBe(0);
    expect(r.explorers[1]!.down).toBe(true);
  });

  it("a card that no longer applies logs nothing and changes nothing", () => {
    const w = blankWorld({}, { explorers: [{ id: "a", tile: "0,0" }] });
    const before = structuredClone(w);
    const { steps, p } = run(w, "rain", null, []);
    expect(steps).toEqual([{ t: "event", id: "rain", option: null, nothing: true }]);
    expect(p).toBeNull();
    expect(w).toEqual(before);
    run(w, "warm-spring", 0, []);
    expect(w).toEqual(before);
  });
});
