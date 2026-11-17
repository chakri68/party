// Rocks: rocks roll down onto the path ahead. The caravan stops and bends to
// clear them, then goes on. A situation shows the rocks lying on the path.
import { ell, env, lerp, poly, puff, ramp } from "./fx.ts";
import type { EventScene, Stagehand } from "./index.ts";

const ROCKS = [6.5, 4.5, 5.5, 3.5];

function rock(h: Stagehand, x: number, y: number, r: number, turn: number): void {
  const pts: [number, number][] = [];
  for (let i = 0; i < 6; i++) {
    const a = turn + (i * Math.PI) / 3;
    const rr = r * (i % 2 ? 0.85 : 1.05);
    pts.push([x + Math.cos(a) * rr, y - r * 0.9 + Math.sin(a) * rr * 0.85]);
  }
  poly(h.c, pts, "#8a7c70");
  ell(h.c, x - r * 0.2, y - r * 1.25, r * 0.5, r * 0.25, "#a59487");
}

function fall(h: Stagehand): void {
  const { v } = h;
  const s = v.s;
  const x0 = Math.min(h.caravan.x1 + 28 * s, v.w - 30 * s);
  ROCKS.forEach((r, i) => {
    const lx = x0 + i * 9 * s;
    const ly = v.ground + (i % 2 ? 2 : -1) * s;
    if (h.loop) return rock(h, lx, ly, r * s, i);
    const a = i * 0.05;
    const k = ramp(h.t, a, a + 0.25);
    const bounce = Math.abs(Math.sin(k * Math.PI * 2)) * 7 * s * (1 - k);
    let x = lerp(lx + 30 * s, lx, k);
    let y = lerp(v.ground - 36 * s, ly, k) - bounce;
    // Cleared: pushed off the path to the near side.
    const off = ramp(h.t, 0.58 + i * 0.04, 0.72 + i * 0.04);
    x += off * 4 * s;
    y += off * 10 * s;
    rock(h, x, y, r * s, i + k * 6);
    puff(h.c, lx, ly - 2 * s, 7 * s, "#cdb99c", env(h.t, a + 0.22, a + 0.26, a + 0.3, a + 0.45) * 0.7);
  });
}

export const rocks: EventScene = {
  still: 0.45,
  pose: (h) => ({ crouch: !h.loop && h.t > 0.55 && h.t < 0.85 }),
  back: fall,
};
