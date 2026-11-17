import { describe, expect, it } from "vitest";
import type { View } from "../client/scene/backdrop.ts";
import { drawCaravan, layoutCaravan, MAX_CAMELS, type CaravanLayout, type CaravanWalker } from "../client/scene/caravan.ts";
import { TRAVELLER } from "../client/scene/sprites.ts";
import type { Health } from "../shared/types.ts";
import { fakeCtx } from "./scene-fake-ctx.ts";

const view: View = { w: 358, h: 143, ground: 0.78 * 143, s: 143 / 150 }; // a phone band, 5:2
/** A walker's hips, the widest part of the body, at s = 1. */
const BODY = 12 * TRAVELLER;
/** How far a camel's muzzle reaches in front of its feet, and a walker's head behind theirs, at s = 1. */
const CAMEL_NOSE = 31;
const HEAD = 3.6 * TRAVELLER;
const walker = (id: string, health: Health = 3, riding = false): CaravanWalker => ({ id, color: "#c0392b", health, riding, alpha: 1 });

describe("caravan layout", () => {
  it("camels at the rear, the first traveller leads", () => {
    const lay = layoutCaravan(view, [walker("a"), walker("b"), walker("c")], 2);
    expect(lay.camelX).toHaveLength(2);
    expect(lay.camelX[0]!).toBeGreaterThan(lay.camelX[1]!); // index 0 = lead camel, to the right
    expect(lay.footX.get("a")!).toBeGreaterThan(lay.footX.get("c")!);
    expect(lay.footX.get("c")!).toBeGreaterThan(lay.camelX[0]!);
    expect(lay.x0).toBe(lay.camelX[1]);
    expect(lay.x1).toBe(lay.footX.get("a"));
  });

  it("riders sit on camels from the rear, and leave the line", () => {
    const lay = layoutCaravan(view, [walker("a", 1, true), walker("b"), walker("c", 1, true)], 3);
    expect(lay.seat.get("a")).toBe(2);
    expect(lay.seat.get("c")).toBe(1);
    expect([...lay.footX.keys()]).toEqual(["b"]);
  });

  it("no camels and no one left still lays out", () => {
    const lay = layoutCaravan(view, [], 0);
    expect(lay.camelX).toEqual([]);
    expect(Number.isFinite(lay.x0) && Number.isFinite(lay.x1)).toBe(true);
  });

  it("a big caravan stays in the left part of the band", () => {
    const many = Array.from({ length: 8 }, (_, i) => walker(`p${i}`));
    const lay = layoutCaravan(view, many, 20);
    expect(lay.camelX.length).toBeLessThanOrEqual(MAX_CAMELS);
    expect(lay.x1).toBeLessThan(view.w * 0.75);
  });

  /** Travellers on foot stand at least a body's width apart, and clear of the lead camel. */
  function expectRoomy(lay: CaravanLayout) {
    expect(lay.spacing).toBeGreaterThanOrEqual(0.85);
    const xs = [...lay.footX.values()].sort((a, b) => a - b);
    const body = BODY * view.s * lay.size;
    for (let i = 1; i < xs.length; i++) expect(xs[i]! - xs[i - 1]!).toBeGreaterThanOrEqual(body);
    if (lay.camelX.length && xs.length) expect(xs[0]! - lay.camelX[0]!).toBeGreaterThanOrEqual((CAMEL_NOSE + HEAD) * view.s * lay.size);
  }

  it("8 travellers and 6 camels: fewer camels, nobody squashed", () => {
    const many = Array.from({ length: 8 }, (_, i) => walker(`p${i}`));
    const lay = layoutCaravan(view, many, 6);
    expect(lay.camelX.length).toBeGreaterThanOrEqual(1);
    expect(lay.camelX.length).toBeLessThan(6);
    expect(lay.footX.size).toBe(8); // nobody dropped
    expectRoomy(lay);
    expect(lay.x1).toBeLessThan(view.w * 0.75);
  });

  it("3 travellers and 6 camels fit too", () => {
    const lay = layoutCaravan(view, [walker("a"), walker("b"), walker("c")], 6);
    expect(lay.camelX.length).toBeGreaterThanOrEqual(1);
    expect(lay.footX.size).toBe(3);
    expectRoomy(lay);
  });

  it("riders keep their camels when the caravan is cut down", () => {
    const ws = Array.from({ length: 8 }, (_, i) => walker(`p${i}`, i < 3 ? 1 : 3, i < 3));
    const lay = layoutCaravan(view, ws, 6);
    expect(lay.camelX.length).toBeGreaterThanOrEqual(3);
    expect(lay.seat.size).toBe(3);
    expect(lay.seat.size + lay.footX.size).toBe(8);
    expectRoomy(lay);
  });

  it("a caravan that still does not fit draws smaller, not below 0.85", () => {
    const ws = Array.from({ length: 8 }, (_, i) => walker(`p${i}`, 1, i < 6));
    const lay = layoutCaravan(view, ws, 6);
    expect(lay.camelX).toHaveLength(6);
    expect(lay.size).toBeGreaterThanOrEqual(0.85);
    expect(lay.size).toBeLessThanOrEqual(1);
    expect(lay.seat.size + lay.footX.size).toBe(8);
  });

  it("a small caravan keeps full size and spacing", () => {
    const lay = layoutCaravan(view, [walker("a"), walker("b")], 2);
    expect(lay.camelX).toHaveLength(2);
    expect(lay.spacing).toBe(1);
    expect(lay.size).toBe(1);
  });

  it("draws with every pose", () => {
    const ws = [walker("a", 1, true), walker("b", 2), walker("c")];
    const lay = layoutCaravan(view, ws, 1);
    const poses = [{}, { facing: -1 as const, dx: -5, crouch: true }, { hideCamel: 0 }, { down: "a" }, { down: "b" }, { move: { id: "c", x: 10, facing: -1 as const, crouch: true } }];
    for (const pose of poses) {
      const f = fakeCtx();
      drawCaravan(f.ctx, view, ws, lay, pose, 0.3, "high");
      expect(f.count("save")).toBe(f.count("restore"));
      expect(f.count("fill")).toBeGreaterThan(0);
    }
  });
});
