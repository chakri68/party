import { describe, expect, it } from "vitest";
import type { Art } from "../client/scene/art.ts";
import { drawBackdrop, type View } from "../client/scene/backdrop.ts";
import type { Terrain } from "../client/scene/model.ts";
import {
  drawCamel,
  drawFire,
  drawGate,
  drawHouse,
  drawRider,
  drawStall,
  drawTent,
  drawTraveller,
} from "../client/scene/sprites.ts";
import type { Health } from "../shared/types.ts";
import { fakeCtx } from "./scene-fake-ctx.ts";

const art: Art = { far: {}, clouds: [] };
const view: View = { w: 400, h: 100, ground: 78, s: 100 / 150 };
const TERRAINS: Terrain[] = ["desert", "mountain", "river", "plain", "town", "market", "gate"];
const FRAMES = [0, 0.5, 0.99];

describe("scene drawing", () => {
  it("every terrain draws", () => {
    for (const terrain of TERRAINS)
      for (const fork of [true, false])
        for (const night of [true, false])
          for (const scroll of [0, 10_000]) {
            const f = fakeCtx();
            expect(() => drawBackdrop(f.ctx, art, view, terrain, scroll, { fork, night })).not.toThrow();
            expect(f.count("fill"), `${terrain} fork=${fork} scroll=${scroll}`).toBeGreaterThan(0);
          }
  });

  it("every sprite draws", () => {
    const f = fakeCtx();
    const c = f.ctx;
    for (const frame of FRAMES) {
      for (const load of ["normal", "high", "none"] as const) drawCamel(c, 50, 80, 1, frame, load);
      for (const health of [1, 2, 3] as Health[])
        for (const riding of [true, false])
          drawTraveller(c, 50, 80, 1, frame, { color: "#c0392b", health, riding, alpha: 0.5 });
      drawTent(c, 50, 80, 1);
      drawFire(c, 50, 80, 1, frame);
      drawStall(c, 50, 80, 1, 30);
      drawHouse(c, 50, 80, 1);
      drawGate(c, 50, 80, 1);
      drawRider(c, 50, 80, 1, frame, 1);
      drawRider(c, 50, 80, 1, frame, -1);
    }
    expect(f.count("fill")).toBeGreaterThan(0);
  });

  it("save and restore stay paired", () => {
    const f = fakeCtx();
    drawBackdrop(f.ctx, art, view, "river", 123, { fork: true, night: false });
    drawTraveller(f.ctx, 50, 80, 1, 0.3, { color: "#123456", health: 1, riding: false, alpha: 1 });
    drawCamel(f.ctx, 50, 80, 1, 0.3, "high");
    drawRider(f.ctx, 50, 80, 1, 0.3, -1);
    expect(f.count("save")).toBe(f.count("restore"));
  });
});
