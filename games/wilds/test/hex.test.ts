import { describe, expect, it } from "vitest";
import { distance, neighbours, path, reachable, rotate, TILE_ORDER, within } from "../shared/hex.ts";

describe("hex", () => {
  it("has 37 unique tiles", () => {
    expect(TILE_ORDER.length).toBe(37);
    expect(new Set(TILE_ORDER).size).toBe(37);
  });
  it("counts neighbours", () => {
    expect(neighbours("0,0")).toHaveLength(6);
    expect(neighbours("3,-3")).toHaveLength(3);
  });
  it("measures distance", () => {
    expect(distance("0,0", "3,-3")).toBe(3);
    for (const a of TILE_ORDER) for (const b of TILE_ORDER) expect(distance(a, b)).toBe(distance(b, a));
  });
  it("rotates", () => {
    for (const t of TILE_ORDER) {
      expect(rotate(t, 6)).toBe(t);
      expect(distance(rotate(t, 1), "0,0")).toBe(distance(t, "0,0"));
    }
  });
  it("within lists tiles in order", () => {
    expect(within("0,0", 1)).toHaveLength(7);
    expect(within("3,-3", 1)).toHaveLength(4);
  });
  it("paths go round a block, or return null", () => {
    const p = path("-1,0", "1,0", (t) => t !== "0,0")!;
    expect(p[0]).toBe("-1,0");
    expect(p.at(-1)).toBe("1,0");
    expect(p).not.toContain("0,0");
    expect(p).toHaveLength(4);
    const wall = new Set(neighbours("0,0"));
    expect(path("0,0", "3,0", (t) => !wall.has(t))).toBeNull();
  });
  it("is deterministic on ties", () => {
    const a = path("-1,0", "1,0", (t) => t !== "0,0");
    const b = path("-1,0", "1,0", (t) => t !== "0,0");
    expect(a).toEqual(b);
  });
  it("does not pass through stopsAt tiles but may end on one", () => {
    const stop = (t: string) => t === "0,0";
    const p = path("-1,0", "1,0", () => true, stop)!;
    expect(p).not.toContain("0,0");
    expect(path("-1,0", "0,0", () => true, stop)).toEqual(["-1,0", "0,0"]);
    const r = reachable("-1,0", 3, () => true, stop);
    expect(r.has("0,0")).toBe(true);
    for (const pth of r.values()) expect(pth.slice(1, -1)).not.toContain("0,0");
  });
  it("reaches 19 tiles in 2 steps", () => {
    expect(reachable("0,0", 2, () => true).size).toBe(19);
  });
});
