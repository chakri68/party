import { describe, expect, it } from "vitest";
import { clickAction, islandView, mapToWorld, pickPin, visibleDots, worldToMap, type MapView } from "../client/map/overlays.ts";
import { generateLayout } from "../shared/generate.ts";
import { DOT_RANGE } from "../shared/world.ts";

const mini: MapView = { cx: 120, cz: -40, metresAcross: 300, w: 180, h: 180 };
const wide: MapView = { cx: 0, cz: 0, metresAcross: 1920, w: 640, h: 400 };

describe("worldToMap and mapToWorld", () => {
  it("worldToMap ∘ mapToWorld is identity", () => {
    for (const v of [mini, wide]) {
      for (const [px, py] of [[0, 0], [90, 90], [17.5, 163.25], [639, 1]]) {
        const w = mapToWorld({ px: px!, py: py! }, v);
        const back = worldToMap(w, v);
        expect(back.px).toBeCloseTo(px!, 9);
        expect(back.py).toBeCloseTo(py!, 9);
      }
    }
  });

  it("puts the centre in the middle and north up", () => {
    expect(worldToMap({ x: 120, z: -40 }, mini)).toEqual({ px: 90, py: 90 });
    // 30 m north (−Z) of the centre is a tenth of the way up.
    expect(worldToMap({ x: 120, z: -70 }, mini)).toEqual({ px: 90, py: 72 });
    expect(worldToMap({ x: 150, z: -40 }, mini)).toEqual({ px: 108, py: 90 });
  });

  it("fits the island's metres to the short side", () => {
    const l = generateLayout(1);
    const v = islandView(l, 500);
    expect(v).toEqual({ cx: 0, cz: 0, metresAcross: 1920, w: 500, h: 500 });
    const nw = worldToMap({ x: -960, z: -960 }, v);
    const se = worldToMap({ x: 960, z: 960 }, v);
    expect([nw.px, nw.py, se.px, se.py].map((n) => Math.round(n * 1e6) / 1e6 + 0)).toEqual([0, 0, 500, 500]);
  });
});

describe("visibleDots", () => {
  const teamOf = (id: string) => ({ me: 1, mate: 1, foe: 2, near: 2, spec: 3 } as Record<string, number>)[id] ?? null;
  const me = { x: 0, z: 0 };

  it("visibleDots hides a far other-team player and keeps a far teammate", () => {
    const others = new Map([
      ["mate", { x: 900, z: 0 }],
      ["foe", { x: DOT_RANGE + 1, z: 0 }],
      ["near", { x: 0, z: -(DOT_RANGE - 1) }],
    ]);
    const dots = visibleDots(me, others, teamOf, 1);
    expect(dots.map((d) => d.id).sort()).toEqual(["mate", "near"]);
    expect(dots.find((d) => d.id === "mate")).toMatchObject({ team: 1, mate: true, x: 900, z: 0 });
    expect(dots.find((d) => d.id === "near")).toMatchObject({ team: 2, mate: false });
  });

  it("measures range in XZ only, and shows nobody else before I have a position", () => {
    const others = new Map([["near", { x: 100, z: 100 }], ["mate", { x: 5, z: 5 }]]);
    expect(visibleDots(me, others, teamOf, 1).map((d) => d.id).sort()).toEqual(["mate", "near"]);
    expect(visibleDots(null, others, teamOf, 1).map((d) => d.id)).toEqual(["mate"]);
  });

  it("skips me and anyone without a team", () => {
    const others = new Map([["me", { x: 0, z: 0 }], ["ghost", { x: 1, z: 1 }], ["spec", { x: 2, z: 2 }]]);
    expect(visibleDots(me, others, teamOf, 1, "me").map((d) => d.id)).toEqual(["spec"]);
  });
});

describe("clicks on the full map", () => {
  const v: MapView = { cx: 0, cz: 0, metresAcross: 1000, w: 500, h: 500 };
  // 2 m per px: (100, 0) is at px 300, py 250.
  const pins = [{ id: "q1", x: 100, z: 0 }, { id: "q2", x: -100, z: 0 }];

  it("click near own pin → unpin, elsewhere → pin", () => {
    expect(clickAction({ px: 309, py: 254 }, pins, v)).toEqual({ type: "unpin", pinId: "q1" });
    expect(clickAction({ px: 250, py: 250 }, pins, v)).toEqual({ type: "pin", x: 0, z: 0 });
    expect(clickAction({ px: 320, py: 250 }, pins, v)).toEqual({ type: "pin", x: 140, z: 0 });
  });

  it("pickPin takes the nearest within 12 px, else null", () => {
    expect(pickPin({ px: 300, py: 262 }, pins, v)).toBe("q1");
    expect(pickPin({ px: 300, py: 262.5 }, pins, v)).toBeNull();
    const close = [{ id: "a", x: 0, z: 0 }, { id: "b", x: 10, z: 0 }];
    expect(pickPin({ px: 254, py: 250 }, close, v)).toBe("b");
    expect(pickPin({ px: 250, py: 250 }, [], v)).toBeNull();
  });
});
