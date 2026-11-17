// Water found: a spring (a well in the desert, the river's edge on a river)
// glints, and the travellers crouch to fill the water bags. A situation shows
// the water glinting. The glint changes three times a second at most.
import { ell, inBand, poly, ramp, ticks } from "./fx.ts";
import type { EventScene, Stagehand } from "./index.ts";

const where = (h: Stagehand) => inBand(h, h.caravan.x1 + 26 * h.v.s, 26 * h.v.s);
const filled = (h: Stagehand) => (h.loop ? 0 : ramp(h.t, 0.3, 0.75));

function source(h: Stagehand): number {
  const { c, v } = h;
  const s = v.s;
  const x = where(h);
  const y = v.ground - 11 * s;
  if (h.terrain === "river") return y - 6 * s; // the river is already drawn
  if (h.terrain === "desert") {
    // A well: a stone ring with a wooden frame.
    c.fillStyle = "#7a5235";
    c.fillRect(x - 9 * s, y - 16 * s, 1.6 * s, 16 * s);
    c.fillRect(x + 7.4 * s, y - 16 * s, 1.6 * s, 16 * s);
    c.fillRect(x - 10 * s, y - 17 * s, 20 * s, 1.6 * s);
    c.fillStyle = "#b9a58a";
    c.fillRect(x - 10 * s, y - 6 * s, 20 * s, 7 * s);
    ell(c, x, y - 6 * s, 10 * s, 2.4 * s, "#4f9fb8");
    return y - 7 * s;
  }
  ell(c, x, y, 19 * s, 4.6 * s, "#86c9da");
  ell(c, x, y + 0.6 * s, 17 * s, 3.6 * s, "#4f9fb8");
  for (const dx of [-17, -9, 12, 18]) ell(c, x + dx * s, y + 2.5 * s, 2.2 * s, 1.4 * s, "#a59487");
  return y - 1 * s;
}

function glint(h: Stagehand, gy: number): void {
  const { v } = h;
  const s = v.s;
  const r = [2.4, 3.6, 2.8, 4][ticks(h) % 4]! * s;
  const x = where(h) + 4 * s;
  const w = r * 0.28;
  poly(h.c, [[x, gy - r], [x + w, gy - w], [x + r, gy], [x + w, gy + w], [x, gy + r], [x - w, gy + w], [x - r, gy], [x - w, gy - w]], "#fffbe8");
}

export const waterFound: EventScene = {
  still: 0.6,
  pose: (h) => ({ crouch: !h.loop && h.t > 0.25 && h.t < 0.78 }),
  back(h) {
    glint(h, source(h));
  },
  front(h) {
    const { c, v } = h;
    const s = v.s;
    const f = filled(h);
    // Two water bags, filling.
    for (const dx of [-14, -6]) {
      const x = where(h) + dx * s;
      ell(c, x, v.ground + 6 * s - (2 + 2 * f) * s, (2.4 + 1.4 * f) * s, (2 + 2 * f) * s, "#7a5a3a");
      ell(c, x, v.ground + 6 * s - (4 + 4 * f) * s, 1 * s, 0.8 * s, "#5a3e2c");
    }
  },
};
