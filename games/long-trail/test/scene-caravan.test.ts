import { describe, expect, it } from "vitest";
import type { View } from "../client/scene/backdrop.ts";
import { drawCaravan, layoutCaravan, MAX_CAMELS, type CaravanWalker } from "../client/scene/caravan.ts";
import type { Health } from "../shared/types.ts";
import { fakeCtx } from "./scene-fake-ctx.ts";

const view: View = { w: 358, h: 143, ground: 0.78 * 143, s: 143 / 150 }; // a phone band, 5:2
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
    expect(lay.camelX).toHaveLength(MAX_CAMELS);
    expect(lay.x1).toBeLessThan(view.w * 0.75);
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
