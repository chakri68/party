import { describe, expect, it } from "vitest";
import { distance, neighbours } from "../shared/hex.ts";
import { ISLANDS, buildBoard, passable } from "../shared/maps.ts";
import type { RuinId, TileId } from "../shared/types.ts";

const ORDERS: [RuinId, RuinId][] = [["shrine", "tower"], ["tower", "shrine"]];

function reach(tiles: ReturnType<typeof buildBoard>["tiles"], from: TileId, broken?: TileId): Set<TileId> {
  const seen = new Set([from]);
  const queue = [from];
  while (queue.length) {
    const c = queue.shift()!;
    for (const n of neighbours(c)) {
      if (seen.has(n) || n === broken || !passable(tiles[n]!.terrain)) continue;
      seen.add(n);
      queue.push(n);
    }
  }
  return seen;
}

describe("islands", () => {
  it("have 7 rows of 4,5,6,7,6,5,4 letters", () => {
    for (const rows of ISLANDS) expect(rows.map((r) => r.length)).toEqual([4, 5, 6, 7, 6, 5, 4]);
  });
  for (let island = 0; island < ISLANDS.length; island++) {
    for (let turns = 0; turns < 6; turns++) {
      for (const order of ORDERS) {
        it(`island ${island}, turn ${turns}, ${order.join("/")}`, () => {
          const b = buildBoard(island, turns, order);
          const all = Object.values(b.tiles);
          expect(all).toHaveLength(37);
          expect(b.gate).toBe("0,0");
          expect(distance(b.camp, b.gate)).toBe(3);
          const ruins = Object.values(b.ruins);
          expect(ruins).toHaveLength(3);
          expect(new Set(Object.keys(b.ruins))).toEqual(new Set(["shrine", "tower", "cave"]));
          for (const t of ruins) {
            expect(b.tiles[t]!.terrain).toBe("ruin");
            expect(distance(t, b.camp)).toBeGreaterThanOrEqual(2);
          }
          for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) expect(distance(ruins[i]!, ruins[j]!)).toBeGreaterThanOrEqual(2);
          expect(all.filter((t) => t.nest)).toHaveLength(1);
          expect(b.tiles[b.nest]!.nest).toBe(true);
          expect(neighbours(b.nest)).toContain(b.ruins.cave);
          expect(all.filter((t) => t.cache)).toHaveLength(3);
          const bridges = all.filter((t) => t.terrain === "bridge");
          expect(bridges.length).toBeGreaterThanOrEqual(2);
          expect(all.every((t) => !t.open && t.fire === 0 && t.noise === 0)).toBe(true);
          const need = [b.gate, ...ruins];
          const base = reach(b.tiles, b.camp);
          for (const t of need) expect(base.has(t)).toBe(true);
          for (const br of bridges) {
            const r = reach(b.tiles, b.camp, br.id);
            for (const t of need) expect(r.has(t), `bridge ${br.id} broken, ${t}`).toBe(true);
          }
        });
      }
    }
  }
  it("gives the S spots the ruin order in TILE_ORDER order", () => {
    const b = buildBoard(0, 0, ["shrine", "tower"]);
    expect(b.ruins.shrine).toBe("3,-2");
    expect(b.ruins.tower).toBe("0,2");
    expect(b.ruins.cave).toBe("0,-1");
  });
});
